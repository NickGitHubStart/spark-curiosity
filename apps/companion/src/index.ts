import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import { spawn } from "node:child_process";
import type { ChatRequest, ChatResponse, EventIngest, MemoryOp } from "@spark/shared";
import {
  AI_TIMEOUT_MS,
  BUILD_ID,
  CLOUD_PROXY_URL,
  CLOUD_REGISTER_SECRET,
  DATA_DIR,
  currentGrokBaseUrl,
  isDirectApiKey,
  GROK_INPUT_USD_PER_1M,
  GROK_OUTPUT_USD_PER_1M,
  HOST,
  PORT,
  RUNTIME_CONFIG_PATH,
  RUNTIME_ID,
  currentGrokApiKey,
  currentGrokModel,
  currentModel,
  currentOpenAiApiKey,
  compareVersions,
  readCurrentVersion,
  resolveUpdateManifestUrl,
  DISCORD_BUG_WEBHOOK_URL,
  currentLang
} from "./config.js";
import {
  applyMemoryOps,
  applyOnboardingTemplate,
  consumeWelcome,
  ensureFiles,
  listOnboardingTemplates,
  loadMemory,
  readMemoryFile,
  registerCloudToken,
  writeMemoryFile,
  writeRuntimeConfig
} from "./memory.js";
import {
  runAiChat,
  runAiCuratedRecommendations,
  runAiCuratedSearch,
  runAiVideoSummary,
  setTestForcedAiJson
} from "./ai.js";
import { decide, invalidateDecisionCache } from "./decision.js";
import {
  clientLogs,
  feedbackLog,
  chatLog,
  lastDecisions,
  recentAgentThoughts,
  ringPush,
  stats,
  extensionStatus,
  type ClientLog
} from "./state.js";
import { renderCuratedPage } from "./ui/curated-ui.js";
import { renderDebugUi } from "./ui/debug-ui.js";
import { renderOnboardPage } from "./ui/onboard-ui.js";
import { renderPairPage } from "./ui/pair-ui.js";
import { renderQuotePage } from "./ui/quote-ui.js";
import { initCuratedGatePolicy, curatedGateMatches, getCuratedGatePolicy, isFeedPath, applyCuratedGateUpdate, type CuratedGateUpdate } from "./curated-gate.js";
import { getBlockStats, updateSessionDurations } from "./block-stats.js";
import { captureVaultEntry, getVaultStatus, initializeVault, listVaultEntries } from "./obsidian-vault.js";
import { renderBrainUi } from "./ui/brain-ui.js";
import { runAiBrainClassification, runAiBrainCompression } from "./ai.js";

const curatedCache = new Map<string, { items: Array<{ title: string; url: string; summary?: string; thumbnail?: string }>; updatedAt: number }>();

/** Nur Loopback: simuliert native Popups (Windows). */
function isLoopbackRequest(req: IncomingMessage): boolean {
  const a = req.socket?.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a.endsWith("127.0.0.1");
}

/** Gleiche Auflösung wie Desktop-Agent: Installer-Layout `native\\` oder Dev-Build unter apps/desktop-native/... */
function resolveWindowsNativeExePath(): string | null {
  if (process.platform !== "win32") return null;
  const explicit = (process.env.SPARK_WINDOWS_NATIVE_EXE || "").trim();
  if (explicit) {
    const p = pathResolve(explicit);
    if (existsSync(p)) return p;
  }
  const root = process.env.SPARK_ROOT_DIR || process.cwd();
  const candidates = [
    pathResolve(root, "native", "ActiveWindowWatcher.exe"),
    pathResolve(root, "apps", "desktop-native", "windows", "ActiveWindowWatcher", "bin", "Release", "net6.0-windows", "win-x64", "publish", "ActiveWindowWatcher.exe"),
    pathResolve(root, "apps", "desktop-native", "windows", "ActiveWindowWatcher", "bin", "Release", "net6.0-windows", "win-x64", "ActiveWindowWatcher.exe"),
    pathResolve(root, "apps", "desktop-native", "windows", "ActiveWindowWatcher", "bin", "Release", "net6.0-windows", "ActiveWindowWatcher.exe")
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function fireWindowsNativePopup(kind: "quote", text: string, author?: string): { ok: boolean; error?: string; exe?: string } {
  const exe = resolveWindowsNativeExePath();
  if (!exe) return { ok: false, error: "native_exe_not_found" };
  const root = process.env.SPARK_ROOT_DIR || process.cwd();
  const iconPath = join(DATA_DIR, "assets", "icon_round.jpg");
  const args = ["--quote", text.slice(0, 260), ...(author?.trim() ? ["--author", author.trim().slice(0, 120)] : [])];
  try {
    const child = spawn(exe, args, {
      cwd: root,
      stdio: "ignore",
      detached: true,
      windowsHide: false,
      env: {
        ...process.env,
        SPARK_COMPANION_URL: process.env.SPARK_COMPANION_URL || `http://127.0.0.1:${PORT}`,
        ...(existsSync(iconPath) ? { SPARK_ICON_PATH: iconPath } : {})
      }
    });
    child.once("error", err => {
      console.warn("[spark:simulate-popup] spawn error:", err?.message || err);
    });
    child.unref();
  } catch (e) {
    return { ok: false, error: String(e), exe };
  }
  return { ok: true, exe };
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(payload));
}

function html(res: ServerResponse, payload: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(payload);
}

async function parseBody<T>(req: IncomingMessage): Promise<T> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return JSON.parse(body) as T;
}

function paginatedJson(res: ServerResponse, data: unknown[], key: string, url: URL): void {
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 20)));
  json(res, 200, { [key]: data.slice(-limit).reverse() });
}

/** Wrap raw PCM (16-bit mono) in a minimal WAV header for Whisper. */
function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);   // PCM
  header.writeUInt16LE(1, 22);   // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header.buffer, header.byteOffset, 44), 0);
  wav.set(pcm, 44);
  return wav;
}

/**
 * STT via OpenAI Whisper (whisper-1).
 * Accepts:
 * - WebM/Opus from browser
 * - Raw PCM from native overlay (wrapped in WAV header first)
 */
async function runStt(audioBase64: string, mimeType: string, sampleRate?: number): Promise<string> {
  // Route STT through cloud proxy only with proxy tokens, not direct vendor keys
  const proxyKey = currentGrokApiKey();
  const directKey = currentOpenAiApiKey();
  const useProxy = CLOUD_PROXY_URL && proxyKey && !isDirectApiKey();
  const apiKey = useProxy ? proxyKey : directKey;
  if (!apiKey) throw new Error("stt_no_api_key: Set SPARK_OPENAI_API_KEY or configure cloud proxy");

  let buf: Uint8Array = Buffer.from(audioBase64, "base64");
  const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Whisper limit
  if (buf.length > MAX_AUDIO_BYTES) throw new Error("audio_too_large: max 25MB");
  let ext = "webm";
  let type = mimeType;

  if (mimeType.includes("pcm")) {
    buf = pcmToWav(buf, sampleRate || 16000);
    ext = "wav";
    type = "audio/wav";
  } else if (mimeType.includes("wav")) {
    ext = "wav";
  }

  // Detect language from user memory (onboarding template), default to "de"
  const { body: memBody } = readMemoryFile();
  const langMatch = memBody.match(/(?:^|\n)##?\s*Language\s*[:=]\s*(\w+)/im);
  const lang = langMatch?.[1]?.toLowerCase().slice(0, 2) || "de";

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type }), `audio.${ext}`);
  form.append("model", "whisper-1");
  form.append("language", lang);
  form.append("response_format", "json");

  console.log("[spark:stt] Whisper request, bytes:", buf.length, "type:", type, "lang:", lang);

  const sttBaseUrl = useProxy ? currentGrokBaseUrl() : "https://api.openai.com/v1";
  const res = await fetch(`${sttBaseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form as unknown as BodyInit
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`whisper_stt_error: ${res.status} ${errText.slice(0, 200)}`);
  }

  const json = (await res.json()) as { text?: string };
  const text = typeof json?.text === "string" ? json.text.trim() : "";
  console.log("[spark:stt] Whisper OK, text:", text.slice(0, 80));
  return text;
}

function buildMemorySummary(ops: MemoryOp[] | undefined, hasMarkdown: boolean): string[] | undefined {
  if (hasMarkdown) return ["Memory vollständig aktualisiert"];
  if (!ops?.length) return undefined;
  return ops.map(op => {
    const sec = op.section.replace("-Term", "");
    if (op.op === "remove") return `${sec}: "${(op.old || "").slice(0, 60)}" entfernt`;
    if (op.op === "update") return `${sec}: "${(op.new || "").slice(0, 60)}"`;
    return `${sec}: "${(op.entry || "").slice(0, 60)}"`;
  });
}

async function onChat(req: ChatRequest): Promise<ChatResponse> {
  const { body: memoryBody, onboardingComplete } = readMemoryFile();
  stats.chatMessages += 1;
  stats.lastChatAt = new Date().toISOString();

  const { reply, memoryMarkdown, memoryOps, openUrl, toolCalls } = await runAiChat(req.message, memoryBody);
  const userMsg = req.message.toLowerCase();
  const wantsOpen = /\b(oeffne|öffne|open|go to|geh zu|zeige mir|öffnen)\b/.test(userMsg);
  if (memoryMarkdown) {
    writeMemoryFile(memoryMarkdown, onboardingComplete);
  } else if (memoryOps?.length) {
    writeMemoryFile(applyMemoryOps(memoryBody, memoryOps), onboardingComplete);
  }

  // Execute tool calls from chat (e.g. set_curated_gate to temporarily allow a blocked site)
  if (toolCalls?.length) {
    for (const call of toolCalls) {
      if (call.tool === "set_curated_gate") {
        const args = call.args as { mode?: string; rules?: unknown[]; ruleIds?: string[]; note?: string };
        const validModes: CuratedGateUpdate["mode"][] = ["set", "add", "remove", "disable"];
        if (args?.mode && validModes.includes(args.mode as CuratedGateUpdate["mode"])) {
          applyCuratedGateUpdate({
            mode: args.mode as CuratedGateUpdate["mode"],
            rules: Array.isArray(args.rules) ? args.rules as CuratedGateUpdate["rules"] : undefined,
            ruleIds: args.ruleIds,
            note: typeof args.note === "string" ? args.note : undefined
          });
        }
      }
    }
  }

  const memoryUpdated = Boolean(memoryMarkdown || memoryOps?.length);
  // Invalidate decision cache when memory changes or tools were called
  if (memoryUpdated || toolCalls?.length) {
    invalidateDecisionCache();
  }
  const memorySummary = buildMemorySummary(memoryOps, Boolean(memoryMarkdown));
  const safeOpenUrl = wantsOpen ? openUrl : undefined;
  ringPush(chatLog, { at: new Date().toISOString(), userMessage: req.message, reply, memoryUpdated, openUrl: safeOpenUrl }, 200);
  return { reply, memoryUpdated, memorySummary, openUrl: safeOpenUrl };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
    return void res.end();
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, host: HOST, port: PORT, provider: "grok", model: currentModel(), buildId: BUILD_ID, runtimeId: RUNTIME_ID });
  }
  if (req.method === "GET" && url.pathname === "/debug/runtime") {
    const proxyKey = currentGrokApiKey();
    const directOpenAi = currentOpenAiApiKey();
    const useSttProxy = Boolean(CLOUD_PROXY_URL && proxyKey && !isDirectApiKey());
    const sttReady = Boolean(useSttProxy ? proxyKey : directOpenAi);
    return json(res, 200, {
      buildId: BUILD_ID,
      runtimeId: RUNTIME_ID,
      pid: process.pid,
      provider: "grok",
      model: currentModel(),
      aiTimeoutMs: AI_TIMEOUT_MS,
      grokInputUsdPer1m: GROK_INPUT_USD_PER_1M,
      grokOutputUsdPer1m: GROK_OUTPUT_USD_PER_1M,
      grokBaseUrl: currentGrokBaseUrl(),
      cloudProxyUrl: CLOUD_PROXY_URL || null,
      runtimeConfigPath: RUNTIME_CONFIG_PATH || null,
      grokKeyPresent: Boolean(currentGrokApiKey()),
      openAiKeyPresent: Boolean(currentOpenAiApiKey()),
      /** True when STT can run (OpenAI key direct, or Grok key via cloud proxy — same as runStt). */
      sttReady,
      sttViaProxy: useSttProxy,
      dataDir: DATA_DIR,
      windowsNativeExe: resolveWindowsNativeExePath()
    });
  }
  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/debug/simulate-popup") {
    if (!isLoopbackRequest(req)) return json(res, 403, { ok: false, error: "localhost_only" });
    if (process.platform !== "win32") return json(res, 400, { ok: false, error: "windows_only" });
    let text = "";
    let author: string | undefined;
    if (req.method === "GET") {
      text = (url.searchParams.get("text") || "").trim() || "Test – Popup simuliert von Spark Debug.";
      author = url.searchParams.get("author")?.trim() || undefined;
    } else {
      try {
        const body = await parseBody<{ text?: string; author?: string }>(req);
        text = (body.text || "").trim() || "Test – Popup simuliert von Spark Debug.";
        author = body.author?.trim() || undefined;
      } catch {
        return json(res, 400, { ok: false, error: "bad_json" });
      }
    }
    const r = fireWindowsNativePopup("quote", text, author);
    return json(res, r.ok ? 200 : 503, { ok: r.ok, error: r.error, exe: r.exe });
  }
  if (req.method === "GET" && url.pathname === "/extension/decide") {
    const target = url.searchParams.get("url") || "";
    if (!target) return json(res, 200, { action: "none" });
    extensionStatus.lastSeen = new Date().toISOString();
    extensionStatus.lastUrl = target;
    const policy = getCuratedGatePolicy();
    if (!policy.enabled) return json(res, 200, { action: "none" });
    if (!curatedGateMatches(target)) return json(res, 200, { action: "none" });
    if (!isFeedPath(target, "other")) return json(res, 200, { action: "none" });
    // Track that extension is handling this redirect (prevents desktop-agent double-redirect)
    try { extensionStatus.lastRedirectHost = new URL(target).hostname; } catch { extensionStatus.lastRedirectHost = target; }
    extensionStatus.lastRedirectAt = Date.now();
    const curatedUrl = `http://127.0.0.1:${PORT}/curated?from=${encodeURIComponent(target)}`;
    return json(res, 200, { action: "close", openUrl: curatedUrl });
  }
  if (req.method === "POST" && url.pathname === "/extension/ping") {
    extensionStatus.lastSeen = new Date().toISOString();
    try {
      const body = await parseBody<{ url?: string }>(req);
      if (body?.url) extensionStatus.lastUrl = body.url;
    } catch { /* ignore */ }
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/extension/status") {
    return json(res, 200, { lastSeen: extensionStatus.lastSeen, lastUrl: extensionStatus.lastUrl });
  }
  // Returns the extension directory path for the onboarding UI copy field
  if (req.method === "GET" && url.pathname === "/desktop/ext-path") {
    const base = process.env.LOCALAPPDATA || "";
    if (!base) return json(res, 400, { path: null, error: "missing_localappdata" });
    const extDir = join(base, "SparkCuriosity", "extension");
    return json(res, 200, { path: extDir, exists: existsSync(extDir) });
  }
  if (req.method === "POST" && url.pathname === "/desktop/start-overlay") {
    const exe = resolveWindowsNativeExePath();
    if (!exe) return json(res, 400, { ok: false, error: "native_exe_not_found" });
    try {
      const root = process.env.SPARK_ROOT_DIR || process.cwd();
      const iconPath = join(DATA_DIR, "assets", "icon_round.jpg");
      const child = spawn(exe, ["--overlay"], {
        cwd: root,
        stdio: "ignore",
        detached: true,
        windowsHide: false,
        env: {
          ...process.env,
          SPARK_COMPANION_URL: `http://127.0.0.1:${PORT}`,
          ...(existsSync(iconPath) ? { SPARK_ICON_PATH: iconPath } : {})
        }
      });
      child.once("error", err => console.warn("[spark:start-overlay] spawn error:", err?.message || err));
      child.unref();
      return json(res, 200, { ok: true, exe });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e) });
    }
  }
  if (req.method === "GET" && url.pathname === "/memory") return json(res, 200, loadMemory());
  if (req.method === "GET" && url.pathname === "/brain") return html(res, renderBrainUi());
  if (req.method === "GET" && url.pathname === "/brain/status") return json(res, 200, getVaultStatus());
  if (req.method === "GET" && url.pathname === "/brain/entries") {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));
    return json(res, 200, { entries: listVaultEntries(undefined, limit) });
  }
  if (req.method === "POST" && url.pathname === "/brain/init") {
    try {
      const body = await parseBody<{ importCurrentMemory?: boolean }>(req).catch(() => ({ importCurrentMemory: false }));
      const memory = body.importCurrentMemory ? readMemoryFile().body : "";
      return json(res, 200, initializeVault({ importCurrentMemory: memory }));
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error) });
    }
  }
  if (req.method === "POST" && url.pathname === "/brain/compress-preview") {
    try {
      const body = await parseBody<{ content?: string }>(req);
      const content = await runAiBrainCompression(body.content || "");
      return json(res, 200, { content, model: currentModel() });
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error) });
    }
  }
  if (req.method === "POST" && url.pathname === "/brain/classify") {
    try {
      const body = await parseBody<{ content?: string; preferredType?: string }>(req);
      const content = (body.content || "").trim();
      if (!content) return json(res, 400, { ok: false, error: "brain_content_required" });
      const classification = await runAiBrainClassification(content, listVaultEntries(undefined, 300), body.preferredType);
      return json(res, 200, classification);
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error) });
    }
  }
  if (req.method === "POST" && url.pathname === "/brain/save") {
    try {
      const body = await parseBody<{
        content?: string;
        title?: string;
        type?: "thought" | "knowledge" | "mental_model" | "principle" | "maxim" | "log" | "limiting_step";
        source?: string;
        themenpfad?: string;
        parentIndex?: string;
        relatedIndices?: string[];
        originalSource?: string;
        userNotes?: string;
        aiModel?: string;
      }>(req);
      return json(res, 200, captureVaultEntry({
        content: body.content || "",
        title: body.title,
        type: body.type,
        source: body.source || "brain",
        themenpfad: body.themenpfad,
        parentIndex: body.parentIndex,
        relatedIndices: body.relatedIndices,
        originalSource: body.originalSource,
        userNotes: body.userNotes,
        aiModel: body.aiModel,
      }));
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error) });
    }
  }
  if (req.method === "GET" && url.pathname === "/vault/status") {
    return json(res, 200, getVaultStatus());
  }
  if (req.method === "POST" && url.pathname === "/vault/init") {
    try {
      const body = await parseBody<{ importCurrentMemory?: boolean }>(req).catch(() => ({ importCurrentMemory: false }));
      const memory = body.importCurrentMemory ? readMemoryFile().body : "";
      return json(res, 200, initializeVault({ importCurrentMemory: memory }));
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error) });
    }
  }
  if (req.method === "POST" && url.pathname === "/vault/capture") {
    try {
      const body = await parseBody<{
        content?: string;
        title?: string;
        type?: "thought" | "knowledge" | "mental_model" | "principle" | "maxim" | "log" | "limiting_step";
        source?: string;
        themenpfad?: string;
        parentIndex?: string;
        relatedIndices?: string[];
        originalSource?: string;
        userNotes?: string;
        aiModel?: string;
      }>(req);
      return json(res, 200, captureVaultEntry({
        content: body.content || "",
        title: body.title,
        type: body.type,
        source: body.source,
        themenpfad: body.themenpfad,
        parentIndex: body.parentIndex,
        relatedIndices: body.relatedIndices,
        originalSource: body.originalSource,
        userNotes: body.userNotes,
        aiModel: body.aiModel,
      }));
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error) });
    }
  }
  if (req.method === "GET" && url.pathname === "/memory/insights") {
    const { body, onboardingComplete } = readMemoryFile();
    const text = `---\nonboardingComplete: ${onboardingComplete}\n---\n\n${body}`;
    return json(res, 200, { text });
  }
  if (req.method === "GET" && url.pathname === "/debug/stats") return json(res, 200, stats);
  if (req.method === "GET" && url.pathname === "/stats") {
    const range = (url.searchParams.get("range") || "total") as "today" | "week" | "total";
    return json(res, 200, getBlockStats(range));
  }
  if (req.method === "POST" && url.pathname === "/stats/session-durations") {
    try {
      const body = await parseBody<Record<string, number>>(req);
      const updated = updateSessionDurations(body);
      return json(res, 200, { ok: true, sessionDurations: updated });
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error) });
    }
  }
  if (req.method === "GET" && url.pathname === "/debug/client-logs") return paginatedJson(res, clientLogs, "logs", url);
  if (req.method === "GET" && url.pathname === "/debug/traces") return paginatedJson(res, lastDecisions, "traces", url);
  if (req.method === "GET" && url.pathname === "/debug/feedback-traces") return paginatedJson(res, feedbackLog, "traces", url);
  if (req.method === "GET" && url.pathname === "/debug/chat-log") return paginatedJson(res, chatLog, "chats", url);
  if (req.method === "GET" && url.pathname === "/debug/ui") return html(res, renderDebugUi());
  // Serve static assets (onboarding images etc.)
  if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
    const safePath = url.pathname.replace(/\.\./g, "").slice("/assets/".length);
    const filePath = join(DATA_DIR, "assets", safePath);
    if (existsSync(filePath)) {
      const ext = filePath.split(".").pop()?.toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
      res.writeHead(200, { "content-type": mime, "cache-control": "public, max-age=86400" });
      return void res.end(readFileSync(filePath));
    }
    return json(res, 404, { error: "not_found" });
  }
  if (req.method === "GET" && url.pathname === "/pair") return html(res, await renderPairPage());
  if (req.method === "GET" && url.pathname === "/setup") { res.writeHead(302, { location: "/onboard" }); return void res.end(); }
  if (req.method === "GET" && url.pathname === "/onboard") return html(res, renderOnboardPage(currentLang()));
  if (req.method === "GET" && url.pathname === "/curated") return html(res, renderCuratedPage(currentLang()));
  if (req.method === "GET" && url.pathname === "/quote") return html(res, renderQuotePage(url.searchParams, currentLang()));
  if (req.method === "POST" && url.pathname === "/quote/feedback") {
    try {
      const body = await parseBody<{ text?: string; author?: string; feedback?: string }>(req);
      const rating = body.feedback === "down" ? "down" : "up";
      const text = (body.text || "").trim().slice(0, 260);
      const author = (body.author || "").trim().slice(0, 120);
      const entry = `Quote-Feedback (${rating}): "${text}"${author ? ` - ${author}` : ""}`;
      const { body: memoryBody, onboardingComplete } = readMemoryFile();
      const newBody = applyMemoryOps(memoryBody, [{ op: "add", section: "Short-Term", entry }]);
      writeMemoryFile(newBody, onboardingComplete);
      stats.feedbackReceived += 1;
      stats.lastFeedbackAt = new Date().toISOString();
      ringPush(feedbackLog, { at: new Date().toISOString(), payload: { feedback: "quote", rating, text, author } }, 500);
      return json(res, 202, { accepted: true });
    } catch (error) {
      return json(res, 400, { accepted: false, error: String(error) });
    }
  }

  if (req.method === "GET" && url.pathname === "/curated/recommendations") {
    const site = url.searchParams.get("site") || "";
    const limit = Math.max(1, Math.min(12, Number(url.searchParams.get("limit") || 10)));
    const cacheKey = `${site || "__all__"}:${limit}`;
    const cached = curatedCache.get(cacheKey);
    if (cached && Date.now() - cached.updatedAt < 5 * 60 * 1000) {
      return json(res, 200, { items: cached.items });
    }
    try {
      const { body } = readMemoryFile();
      const items = await runAiCuratedRecommendations(site, body, limit);
      curatedCache.set(cacheKey, { items, updatedAt: Date.now() });
      return json(res, 200, { items });
    } catch (error) {
      return json(res, 200, { items: [], error: String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/curated/search") {
    try {
      const body = await parseBody<{ query: string; site?: string }>(req);
      const query = body.query?.trim();
      if (!query) return json(res, 400, { error: "query_required" });
      const { body: memoryBody } = readMemoryFile();
      const items = await runAiCuratedSearch(body.site || "", query, memoryBody, 5);
      return json(res, 200, { ok: true, items });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/curated/summarize") {
    try {
      const body = await parseBody<{ url?: string; title?: string }>(req);
      const target = (body.url || "").trim();
      if (!target || !target.startsWith("http")) return json(res, 400, { ok: false, error: "url_required" });
      const { body: memoryBody } = readMemoryFile();
      const summary = await runAiVideoSummary(target, body.title || "", memoryBody);
      if (!summary) return json(res, 200, { ok: false, error: "no_summary" });
      return json(res, 200, { ok: true, summary });
    } catch (error) {
      return json(res, 200, { ok: false, error: String(error) });
    }
  }

  if (req.method === "GET" && url.pathname === "/desktop/config") {
    return json(res, 200, {
      provider: "grok",
      grokModel: currentGrokModel(),
      grokKeyPresent: Boolean(currentGrokApiKey()),
      runtimeConfigPath: RUNTIME_CONFIG_PATH || null
    });
  }

  if (req.method === "GET" && url.pathname === "/desktop/update-check") {
    const currentVersion = readCurrentVersion();
    const manifestUrl = resolveUpdateManifestUrl();
    if (!manifestUrl) {
      return json(res, 200, { currentVersion, updateAvailable: false, reason: "no_manifest" });
    }
    try {
      const resManifest = await fetch(manifestUrl, { signal: AbortSignal.timeout(3000) });
      if (!resManifest.ok) return json(res, 200, { currentVersion, updateAvailable: false, reason: `http_${resManifest.status}` });
      const data = await resManifest.json() as { version?: string; asset?: string };
      const latestVersion = typeof data.version === "string" ? data.version : "";
      if (!latestVersion) return json(res, 200, { currentVersion, updateAvailable: false, reason: "no_version" });
      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
      return json(res, 200, {
        currentVersion,
        latestVersion,
        updateAvailable,
        manifestUrl
      });
    } catch (error) {
      return json(res, 200, { currentVersion, updateAvailable: false, reason: String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/desktop/setup") {
    try {
      const body = await parseBody<{ grokApiKey?: string; grokModel?: string; templateId?: string; customNotes?: string }>(req);
      // API key is optional — if not provided, keep the baked-in key from runtime.env
      if (body.grokApiKey?.trim()) {
        const writeResult = writeRuntimeConfig({
          grokApiKey: body.grokApiKey.trim(),
          grokModel: (body.grokModel || "grok-4-1-fast").trim()
        });
        if (!writeResult.ok) return json(res, 500, { error: writeResult.error });
      }

      if (body.templateId?.trim()) {
        const applied = applyOnboardingTemplate(body.templateId.trim(), body.customNotes);
        if (!applied.ok) return json(res, 400, { error: applied.error });
        return json(res, 200, { ok: true, templateId: applied.templateId });
      }
      return json(res, 200, { ok: true, templateId: null });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/debug/client-log") {
    try {
      const p = await parseBody<ClientLog>(req);
      ringPush(clientLogs, { at: p.at || new Date().toISOString(), level: p.level || "info", message: p.message || "unknown", context: p.context }, 500);
      return json(res, 202, { accepted: true });
    } catch { return json(res, 400, { accepted: false }); }
  }
  if (req.method === "POST" && url.pathname === "/event") {
    try {
      const event = await parseBody<EventIngest>(req);
      stats.eventsReceived += 1;
      stats.lastEventAt = new Date().toISOString();
      return json(res, 200, await decide(event));
    } catch (error) {
      return json(res, 400, { reason: `bad_event:${String(error)}`, agentSkipped: true });
    }
  }
  if (req.method === "POST" && url.pathname === "/chat") {
    try {
      const p = await parseBody<ChatRequest>(req);
      return json(res, 200, await onChat(p));
    } catch (error) {
      return json(res, 400, { reply: `Fehler: ${String(error)}`, memoryUpdated: false });
    }
  }
  if (req.method === "POST" && url.pathname === "/stt") {
    try {
      const body = await parseBody<{ audioBase64?: string; mimeType?: string; sampleRate?: number }>(req);
      const audioBase64 = (body.audioBase64 || "").trim();
      if (!audioBase64) return json(res, 400, { error: "audio_required" });
      const text = await runStt(audioBase64, body.mimeType || "audio/webm", body.sampleRate);
      return json(res, 200, { text: text || "" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[spark:stt] failed:", msg);
      const status = msg.includes("stt_no_api_key") || msg.includes("audio_required") ? 400 : 502;
      return json(res, status, { error: msg });
    }
  }

  // -- Bug reports --
  if (req.method === "POST" && url.pathname === "/bug-report") {
    try {
      const body = await parseBody<{ description?: string; context?: string }>(req);
      const desc = (body.description || "").trim();
      if (!desc) return json(res, 400, { ok: false, error: "description_required" });
      const entry = { at: new Date().toISOString(), description: desc, context: (body.context || "").trim() || undefined };

      // Local backup
      const reportFile = join(DATA_DIR, "bug-reports.json");
      let reports: unknown[] = [];
      try { if (existsSync(reportFile)) reports = JSON.parse(readFileSync(reportFile, "utf-8")); } catch { reports = []; }
      reports.push(entry);
      writeFileSync(reportFile, JSON.stringify(reports, null, 2), "utf-8");

      // Discord webhook
      if (DISCORD_BUG_WEBHOOK_URL) {
        try {
          const embed = {
            title: "🐛 Bug Report",
            description: desc.slice(0, 2000),
            color: 0xfbbf24, // amber
            timestamp: entry.at,
            fields: entry.context ? [{ name: "Kontext", value: entry.context.slice(0, 500) }] : [],
            footer: { text: `Spark ${BUILD_ID} · PID ${process.pid}` }
          };
          const discordBody = JSON.stringify({ embeds: [embed] });
          await fetch(DISCORD_BUG_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: discordBody
          });
        } catch (e) {
          console.error("[spark:bug-report] discord webhook failed:", e);
        }
      }

      return json(res, 201, { ok: true });
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error) });
    }
  }
  if (req.method === "GET" && url.pathname === "/debug/bug-reports") {
    const reportFile = join(DATA_DIR, "bug-reports.json");
    let reports: unknown[] = [];
    try { if (existsSync(reportFile)) reports = JSON.parse(readFileSync(reportFile, "utf-8")); } catch { reports = []; }
    return json(res, 200, { reports });
  }

  if (req.method === "GET" && url.pathname === "/onboarding/status") {
    const memory = loadMemory();
    return json(res, 200, { onboardingComplete: Boolean(memory.onboardingComplete) });
  }

  if (req.method === "GET" && url.pathname === "/onboarding/templates") {
    return json(res, 200, { templates: listOnboardingTemplates() });
  }

  if (req.method === "POST" && url.pathname === "/onboarding/select") {
    try {
      const body = await parseBody<{ templateId: string; customNotes?: string }>(req);
      const result = applyOnboardingTemplate(body.templateId, body.customNotes);
      if (!result.ok) return json(res, 404, { error: result.error });

      // Auto-register cloud token if proxy is configured and no API key yet
      let cloudRegistered = false;
      let cloudError: string | undefined;
      if (CLOUD_PROXY_URL && !currentGrokApiKey()) {
        console.log(`[spark:onboarding] registering cloud token at ${CLOUD_PROXY_URL}`);
        const reg = await registerCloudToken(CLOUD_PROXY_URL, CLOUD_REGISTER_SECRET || undefined);
        if (reg.ok) {
          const writeResult = writeRuntimeConfig({ grokApiKey: reg.token, grokModel: currentGrokModel() });
          if (writeResult.ok) {
            cloudRegistered = true;
            console.log("[spark:onboarding] cloud token registered and saved");
          } else {
            cloudError = `token_obtained_but_write_failed: ${writeResult.error}`;
            console.error("[spark:onboarding]", cloudError);
          }
        } else {
          cloudError = reg.error;
          console.error("[spark:onboarding] cloud token registration failed:", reg.error);
        }
      } else if (!CLOUD_PROXY_URL) {
        console.warn("[spark:onboarding] SPARK_CLOUD_PROXY_URL not set — skipping cloud registration");
      }

      return json(res, 200, { ok: true, templateId: result.templateId, cloudRegistered, cloudError });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
  }

  if (req.method === "GET" && url.pathname === "/overlay/init") {
    const welcome = consumeWelcome();
    return json(res, 200, { welcome });
  }

  if (req.method === "POST" && url.pathname === "/onboarding/skip") {
    const { body, onboardingComplete: _ } = readMemoryFile();
    writeMemoryFile(body, true);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "not_found" });
}

export function createCompanionServer() {
  return createServer((req, res) => { void handle(req, res); });
}

/** Auto-register cloud proxy token if proxy is configured but no API key is present.
 *  Handles: fresh install without onboarding, lost config, upgrade with wiped runtime.env. */
async function ensureCloudToken(): Promise<void> {
  if (!CLOUD_PROXY_URL) return;
  if (currentGrokApiKey()) return; // already have a key
  console.log(`[spark:startup] No API key found but cloud proxy configured — auto-registering token at ${CLOUD_PROXY_URL}`);
  try {
    const reg = await registerCloudToken(CLOUD_PROXY_URL, CLOUD_REGISTER_SECRET || undefined);
    if (!reg.ok) {
      console.error("[spark:startup] cloud token registration failed:", reg.error);
      return;
    }
    const writeResult = writeRuntimeConfig({ grokApiKey: reg.token, grokModel: currentGrokModel() });
    if (writeResult.ok) {
      console.log("[spark:startup] cloud token auto-registered and saved to runtime.env");
    } else {
      console.error("[spark:startup] token obtained but write failed:", writeResult.error);
    }
  } catch (err) {
    console.error("[spark:startup] cloud token auto-registration error:", err);
  }
}

export function startCompanionServer(port = PORT, host = HOST) {
  ensureFiles();
  initCuratedGatePolicy();
  const server = createCompanionServer();
  server.listen(port, host, () => {
    const model = currentModel();
    console.log(`Spark companion running on http://${host}:${port}`);
    console.log(`[spark] AI: Grok (${model}) — Timeout: ${AI_TIMEOUT_MS}ms`);
    // One-shot encrypted memory migration if user provided a SPARK_INSTALL_TOKEN
    void (async () => {
      const installToken = process.env.SPARK_INSTALL_TOKEN;
      if (!installToken) return;
      try {
        const { migrateLocalMemoryToCloud } = await import("./cloud-memory.js");
        const r = await migrateLocalMemoryToCloud(installToken);
        if (r.ok && r.reason !== "already_migrated") {
          console.log("[spark:cloud-memory] local memory pushed to cloud (encrypted)");
        } else if (!r.ok) {
          console.warn("[spark:cloud-memory] migration skipped:", r.reason);
        }
      } catch (e) {
        console.warn("[spark:cloud-memory] migration error:", e);
      }
    })();
    // Auto-register cloud token if missing (fire-and-forget, non-blocking)
    void ensureCloudToken().then(() => {
      const grokApiKey = currentGrokApiKey();
      if (grokApiKey) {
        console.log(`[spark] Grok aktiv: ${currentGrokBaseUrl()}`);
      } else {
        console.warn("[spark] WARN: SPARK_GROK_API_KEY fehlt. Agent-Entscheidungen werden fehlschlagen.");
      }
    });
  });
  return server;
}

export { setTestForcedAiJson };

if (process.env.SPARK_SKIP_AUTOSTART !== "1") {
  startCompanionServer();
}
