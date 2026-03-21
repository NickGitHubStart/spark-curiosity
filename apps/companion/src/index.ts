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
  resolveUpdateManifestUrl
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
import { decide } from "./decision.js";
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
import { renderDesktopSetupUi } from "./ui/desktop-setup-ui.js";
import { renderOnboardPage } from "./ui/onboard-ui.js";
import { renderQuotePage } from "./ui/quote-ui.js";
import { initCuratedGatePolicy, curatedGateMatches, getCuratedGatePolicy, isFeedPath } from "./curated-gate.js";

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
      windowsHide: true,
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
  // Use cloud proxy token if available, fall back to direct OpenAI key
  const proxyKey = currentGrokApiKey();
  const directKey = currentOpenAiApiKey();
  const apiKey = (CLOUD_PROXY_URL && proxyKey) ? proxyKey : directKey;
  if (!apiKey) throw new Error("stt_no_api_key: Set SPARK_OPENAI_API_KEY or configure cloud proxy");

  let buf: Uint8Array = Buffer.from(audioBase64, "base64");
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

  const sttBaseUrl = (CLOUD_PROXY_URL && proxyKey) ? currentGrokBaseUrl() : "https://api.openai.com/v1";
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

  const { reply, memoryMarkdown, memoryOps, openUrl } = await runAiChat(req.message, memoryBody);
  const userMsg = req.message.toLowerCase();
  const wantsOpen = /\b(oeffne|öffne|open|go to|geh zu|zeige mir|öffnen)\b/.test(userMsg);
  if (memoryMarkdown) {
    writeMemoryFile(memoryMarkdown, onboardingComplete);
  } else if (memoryOps?.length) {
    writeMemoryFile(applyMemoryOps(memoryBody, memoryOps), onboardingComplete);
  }

  const memoryUpdated = Boolean(memoryMarkdown || memoryOps?.length);
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
  if (req.method === "GET" && url.pathname === "/extension/update.xml") {
    const info = extensionInstallInfo();
    if (!info.id || !info.version || !info.crxPath) {
      res.writeHead(404, { "content-type": "text/plain" });
      return void res.end("missing_extension");
    }
    const codebase = `http://127.0.0.1:${PORT}/extension/spark-extension.crx`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>` +
      `<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">` +
      `<app appid="${info.id}"><updatecheck codebase="${codebase}" version="${info.version}"/></app>` +
      `</gupdate>`;
    res.writeHead(200, { "content-type": "text/xml" });
    return void res.end(xml);
  }
  if (req.method === "GET" && url.pathname === "/extension/spark-extension.crx") {
    const info = extensionInstallInfo();
    if (!info.crxPath || !existsSync(info.crxPath)) {
      res.writeHead(404, { "content-type": "text/plain" });
      return void res.end("missing_crx");
    }
    const buffer = readFileSync(info.crxPath);
    res.writeHead(200, { "content-type": "application/x-chrome-extension" });
    return void res.end(buffer);
  }
  if (req.method === "POST" && url.pathname === "/admin/enable-extension") {
    const result = triggerAdminExtensionInstall();
    if (!result.ok) return json(res, 400, { ok: false, error: result.reason });
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/desktop/extension-assist") {
    const result = triggerExtensionAssist();
    if (!result.ok) return json(res, 400, { ok: false, error: result.reason });
    return json(res, 200, { ok: true });
  }
  if (req.method === "GET" && url.pathname === "/memory") return json(res, 200, loadMemory());
  if (req.method === "GET" && url.pathname === "/memory/insights") {
    const { body, onboardingComplete } = readMemoryFile();
    const text = `---\nonboardingComplete: ${onboardingComplete}\n---\n\n${body}`;
    return json(res, 200, { text });
  }
  if (req.method === "GET" && url.pathname === "/debug/stats") return json(res, 200, stats);
  if (req.method === "GET" && url.pathname === "/debug/client-logs") return paginatedJson(res, clientLogs, "logs", url);
  if (req.method === "GET" && url.pathname === "/debug/traces") return paginatedJson(res, lastDecisions, "traces", url);
  if (req.method === "GET" && url.pathname === "/debug/feedback-traces") return paginatedJson(res, feedbackLog, "traces", url);
  if (req.method === "GET" && url.pathname === "/debug/chat-log") return paginatedJson(res, chatLog, "chats", url);
  if (req.method === "GET" && url.pathname === "/debug/ui") return html(res, renderDebugUi());
  if (req.method === "GET" && url.pathname === "/setup") return html(res, renderDesktopSetupUi());
  if (req.method === "GET" && url.pathname === "/onboard") return html(res, renderOnboardPage());
  if (req.method === "GET" && url.pathname === "/curated") return html(res, renderCuratedPage());
  if (req.method === "GET" && url.pathname === "/quote") return html(res, renderQuotePage(url.searchParams));
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
      return json(res, 200, { error: msg });
    }
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

export function startCompanionServer(port = PORT, host = HOST) {
  ensureFiles();
  initCuratedGatePolicy();
  const server = createCompanionServer();
  server.listen(port, host, () => {
    const model = currentModel();
    const grokApiKey = currentGrokApiKey();
    console.log(`Spark companion running on http://${host}:${port}`);
    console.log(`[spark] AI: Grok (${model}) ? Timeout: ${AI_TIMEOUT_MS}ms`);
    if (grokApiKey) {
      console.log(`[spark] Grok aktiv: ${currentGrokBaseUrl()}`);
    } else {
      console.warn("[spark] WARN: SPARK_GROK_API_KEY fehlt. Agent-Entscheidungen werden fehlschlagen.");
    }
  });
  return server;
}

export { setTestForcedAiJson };

function extensionInstallInfo(): { id?: string; version?: string; crxPath?: string } {
  try {
    const base = process.env.LOCALAPPDATA || "";
    const path = base ? join(base, "SparkCuriosity", "extension", "install.json") : "";
    if (!path || !existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as { id?: string; version?: string; crxPath?: string };
  } catch {
    return {};
  }
}

function triggerAdminExtensionInstall(): { ok: boolean; reason?: string } {
  if (process.platform !== "win32") return { ok: false, reason: "unsupported_platform" };
  const info = extensionInstallInfo();
  if (!info.id) return { ok: false, reason: "missing_install_info" };
  const updateUrl = `http://127.0.0.1:${PORT}/extension/update.xml`;
  const source = "http://127.0.0.1:4343/*";
  const extSettings = JSON.stringify({
    [info.id]: {
      installation_mode: "force_installed",
      update_url: updateUrl
    }
  }).replace(/"/g, '\\"');
  const localAppData = process.env.LOCALAPPDATA || "";
  const scriptPath = localAppData
    ? join(localAppData, "SparkCuriosity", "enable-extension-admin.ps1")
    : join(DATA_DIR, "enable-extension-admin.ps1");
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `reg add "HKLM\\Software\\Policies\\Google\\Chrome\\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "${info.id};${updateUrl}" /f`,
    `reg add "HKLM\\Software\\Policies\\Google\\Chrome\\ExtensionInstallSources" /v 1 /t REG_SZ /d "${source}" /f`,
    `reg add "HKLM\\Software\\Policies\\Google\\Chrome\\ExtensionAllowedInstallSources" /v 1 /t REG_SZ /d "${source}" /f`,
    `reg add "HKLM\\Software\\Policies\\Google\\Chrome\\ExtensionInstallAllowlist" /v 1 /t REG_SZ /d "${info.id}" /f`,
    `reg add "HKLM\\Software\\Policies\\Google\\Chrome\\ExtensionSettings" /v ExtensionSettings /t REG_SZ /d "${extSettings}" /f`,
    `reg add "HKLM\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "${info.id};${updateUrl}" /f`,
    `reg add "HKLM\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallSources" /v 1 /t REG_SZ /d "${source}" /f`,
    `reg add "HKLM\\Software\\Policies\\Microsoft\\Edge\\ExtensionAllowedInstallSources" /v 1 /t REG_SZ /d "${source}" /f`,
    `reg add "HKLM\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallAllowlist" /v 1 /t REG_SZ /d "${info.id}" /f`,
    `reg add "HKLM\\Software\\Policies\\Microsoft\\Edge\\ExtensionSettings" /v ExtensionSettings /t REG_SZ /d "${extSettings}" /f`
  ];
  try {
    if (localAppData) {
      try { writeFileSync(join(localAppData, "SparkCuriosity", ".keep"), ""); } catch { /* ignore */ }
    }
    writeFileSync(scriptPath, lines.join("\r\n"), "utf8");
  } catch {
    return { ok: false, reason: "script_write_failed" };
  }
  try {
    const runAs = `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath}'`;
    const child = spawn("cmd", ["/c", "start", "", "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", runAs], {
      windowsHide: false,
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return { ok: true };
  } catch {
    return { ok: false, reason: "spawn_failed" };
  }
}

function triggerExtensionAssist(): { ok: boolean; reason?: string } {
  if (process.platform !== "win32") return { ok: false, reason: "unsupported_platform" };
  const base = process.env.LOCALAPPDATA || "";
  if (!base) return { ok: false, reason: "missing_localappdata" };
  const extDir = join(base, "SparkCuriosity", "extension");
  if (!existsSync(extDir)) return { ok: false, reason: "extension_dir_missing" };
  try {
    const chromeExe = resolveChromeExe();
    if (chromeExe) {
      spawn(chromeExe, ["chrome://extensions"], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    } else {
      spawn("cmd", ["/c", "start", "", "chrome://extensions"], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    }
    spawn("explorer.exe", [extDir], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return { ok: true };
  } catch {
    return { ok: false, reason: "spawn_failed" };
  }
}

// NOTE: duplicated in desktop-agent/chrome-cdp.ts — unify when these packages share code
function resolveChromeExe(): string | null {
  const env = process.env.CHROME_PATH || process.env.SPARK_CHROME_PATH;
  if (env && existsSync(env)) return env;
  const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const candidates = [
    join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

if (process.env.SPARK_SKIP_AUTOSTART !== "1") {
  startCompanionServer();
}
