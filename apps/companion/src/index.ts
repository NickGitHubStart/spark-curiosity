import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { ChatRequest, ChatResponse, EventIngest, MemoryOp } from "@spark/shared";
import {
  AI_TIMEOUT_MS,
  BUILD_ID,
  DATA_DIR,
  GROK_BASE_URL,
  GROK_INPUT_USD_PER_1M,
  GROK_OUTPUT_USD_PER_1M,
  HOST,
  OLLAMA_BASE_URL,
  PORT,
  RUNTIME_CONFIG_PATH,
  RUNTIME_ID,
  currentGrokApiKey,
  currentGrokModel,
  currentModel,
  currentOpenAiApiKey,
  currentProvider,
  readRuntimeSetting,
  compareVersions,
  readCurrentVersion,
  resolveUpdateManifestUrl
} from "./config.js";
import {
  applyMemoryOps,
  applyOnboardingTemplate,
  ensureFiles,
  listOnboardingTemplates,
  loadMemory,
  readMemoryFile,
  writeMemoryFile,
  writeRuntimeConfig
} from "./memory.js";
import {
  checkOllamaHealth,
  runAiChat,
  runAiCuratedRecommendations,
  runAiCuratedSearch,
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
import { renderQuotePage } from "./ui/quote-ui.js";
import { renderSparkChatUi } from "./ui/spark-chat-ui.js";
import { initCuratedGatePolicy, curatedGateMatches, getCuratedGatePolicy, isFeedPath } from "./curated-gate.js";

const curatedCache = new Map<string, { items: Array<{ title: string; url: string; summary?: string; thumbnail?: string }>; updatedAt: number }>();

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(payload));
}

function html(res: ServerResponse, payload: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(payload);
}

function image(res: ServerResponse, buffer: Buffer, contentType: string): void {
  res.writeHead(200, { "content-type": contentType, "cache-control": "public, max-age=3600" });
  res.end(buffer);
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

function splitCliArgs(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: "'" | "\"" | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

async function runSummarizeCli(url: string): Promise<string> {
  const cmdRaw = readRuntimeSetting("SPARK_SUMMARIZE_CMD") || "summarize --youtube auto";
  const parts = splitCliArgs(cmdRaw);
  if (!parts.length) throw new Error("summarize_cmd_invalid");
  const timeoutMs = Math.max(10_000, Number(readRuntimeSetting("SPARK_SUMMARIZE_TIMEOUT_MS") || 120_000));

  return await new Promise((resolve, reject) => {
    const child = spawn(parts[0], [...parts.slice(1), url], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error(`summarize_timeout:${timeoutMs}`));
    }, timeoutMs);
    child.stdout?.on("data", chunk => { stdout += String(chunk); });
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    child.on("error", err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`summarize_failed:${code}:${stderr.slice(0, 200)}`));
      }
      const text = stdout.trim();
      if (!text) return reject(new Error("summarize_empty_output"));
      try {
        const parsed = JSON.parse(text) as { summary?: string; text?: string };
        const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
        const alt = typeof parsed.text === "string" ? parsed.text.trim() : "";
        if (summary) return resolve(summary);
        if (alt) return resolve(alt);
      } catch { /* ignore */ }
      return resolve(text);
    });
  });
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
 * STT via OpenAI Whisper. Accepts:
 * - WebM/Opus from browser (sent directly — Whisper supports WebM natively)
 * - Raw PCM from native overlay (wrapped in WAV header first)
 */
async function runStt(audioBase64: string, mimeType: string, sampleRate?: number): Promise<string> {
  const apiKey = currentOpenAiApiKey();
  if (!apiKey) throw new Error("stt_no_api_key: Set SPARK_OPENAI_API_KEY or OPENAI_API_KEY in .env");

  let buf: Uint8Array = Buffer.from(audioBase64, "base64");
  let ext = "webm";
  let type = mimeType;

  // Native overlay sends raw PCM — wrap in WAV for Whisper
  if (mimeType.includes("pcm")) {
    buf = pcmToWav(buf, sampleRate || 16000);
    ext = "wav";
    type = "audio/wav";
  } else if (mimeType.includes("wav")) {
    ext = "wav";
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type }), `audio.${ext}`);
  form.append("model", "whisper-1");
  form.append("language", "de");
  form.append("response_format", "json");

  console.log("[spark:stt] Whisper request, bytes:", buf.length, "type:", type);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form as unknown as BodyInit
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`whisper_api_error: ${res.status} ${errText.slice(0, 200)}`);
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
    return json(res, 200, { ok: true, host: HOST, port: PORT, provider: currentProvider(), model: currentModel(), buildId: BUILD_ID, runtimeId: RUNTIME_ID });
  }
  if (req.method === "GET" && url.pathname === "/debug/runtime") {
    return json(res, 200, {
      buildId: BUILD_ID,
      runtimeId: RUNTIME_ID,
      pid: process.pid,
      provider: currentProvider(),
      model: currentModel(),
      aiTimeoutMs: AI_TIMEOUT_MS,
      grokInputUsdPer1m: GROK_INPUT_USD_PER_1M,
      grokOutputUsdPer1m: GROK_OUTPUT_USD_PER_1M,
      ollamaBaseUrl: OLLAMA_BASE_URL,
      grokBaseUrl: GROK_BASE_URL,
      grokKeyPresent: Boolean(currentGrokApiKey()),
      openAiKeyPresent: Boolean(currentOpenAiApiKey()),
      dataDir: DATA_DIR
    });
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
  if (req.method === "GET" && url.pathname === "/curated") return html(res, renderCuratedPage());
  if (req.method === "GET" && url.pathname === "/spark") return html(res, renderSparkChatUi());
  if (req.method === "GET" && url.pathname === "/spark/icon") {
    const iconPath = join(DATA_DIR, "assets", "icon_round.jpg");
    if (!existsSync(iconPath)) return json(res, 404, { error: "icon_not_found" });
    const buf = readFileSync(iconPath);
    return image(res, buf, "image/jpeg");
  }
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
      const result = await runAiCuratedSearch(body.site || "", query, memoryBody);
      if (!result) return json(res, 200, { ok: false });
      return json(res, 200, { ok: true, ...result });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/curated/summarize") {
    try {
      const body = await parseBody<{ url?: string }>(req);
      const target = (body.url || "").trim();
      if (!target || !target.startsWith("http")) return json(res, 400, { ok: false, error: "url_required" });
      const summary = await runSummarizeCli(target);
      return json(res, 200, { ok: true, summary });
    } catch (error) {
      return json(res, 200, { ok: false, error: String(error) });
    }
  }

  if (req.method === "GET" && url.pathname === "/desktop/config") {
    return json(res, 200, {
      provider: currentProvider(),
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
      const body = await parseBody<{ grokApiKey: string; grokModel?: string; templateId?: string; customNotes?: string }>(req);
      if (!body.grokApiKey?.trim()) return json(res, 400, { error: "grok_api_key_required" });
      const writeResult = writeRuntimeConfig({
        provider: "grok",
        grokApiKey: body.grokApiKey.trim(),
        grokModel: (body.grokModel || "grok-4-1-fast-reasoning").trim()
      });
      if (!writeResult.ok) return json(res, 500, { error: writeResult.error });

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
      return json(res, 200, { ok: true, templateId: result.templateId });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
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
  server.listen(port, host, async () => {
    const provider = currentProvider();
    const model = currentModel();
    const grokApiKey = currentGrokApiKey();
    console.log(`Spark companion running on http://${host}:${port}`);
    console.log(`[spark] AI provider: ${provider} ? Modell: ${model} ? Timeout: ${AI_TIMEOUT_MS}ms`);
    if (provider === "grok") {
      if (grokApiKey) {
        console.log(`[spark] Grok aktiv: ${GROK_BASE_URL}`);
      } else {
        console.warn("[spark] WARN: Grok gewaehlt, aber SPARK_GROK_API_KEY fehlt.");
        console.warn("[spark]   Agent-Entscheidungen werden mit \"grok_missing_api_key\" beantwortet.");
      }
      return;
    }

    const ollamaOk = await checkOllamaHealth();
    if (ollamaOk) {
      console.log(`[spark] Ollama erreichbar: ${OLLAMA_BASE_URL} ? Modell: ${model}`);
    } else {
      console.warn(`[spark] WARN: Ollama NICHT erreichbar unter ${OLLAMA_BASE_URL}`);
      console.warn("[spark]   Agent-Entscheidungen werden mit \"ollama_unavailable\" beantwortet.");
      console.warn(`[spark]   Fix: Ollama installieren + starten + Modell pullen: ollama pull ${model}`);
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
