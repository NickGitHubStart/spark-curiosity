import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "undici";
import type { ChatRequest, ChatResponse, EventIngest } from "@spark/shared";
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
  currentProvider,
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
  type ClientLog
} from "./state.js";
import { renderCuratedPage } from "./ui/curated-ui.js";
import { renderDebugUi } from "./ui/debug-ui.js";
import { renderDesktopSetupUi } from "./ui/desktop-setup-ui.js";
import { renderQuotePage } from "./ui/quote-ui.js";
import { renderSparkChatUi } from "./ui/spark-chat-ui.js";
import { initCuratedGatePolicy } from "./curated-gate.js";

const curatedCache = new Map<string, { items: Array<{ title: string; url: string }>; updatedAt: number }>();

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

async function runXaiTranscription(audioBase64: string, sampleRate = 16000): Promise<string> {
  const apiKey = currentGrokApiKey();
  if (!apiKey) throw new Error("grok_api_key_missing");

  return await new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://api.x.ai/v1/realtime", {
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      }
    });
    let done = false;
    let transcript = "";
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      try { ws.close(); } catch { /* ignore */ }
      reject(new Error("stt_timeout"));
    }, 25000);

    function finish(result: string | Error) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try { ws.close(); } catch { /* ignore */ }
      if (result instanceof Error) reject(result);
      else resolve(result);
    }

    ws.addEventListener("open", () => {
      console.log("[spark:stt] ws connected, sending session.update");
      ws.send(JSON.stringify({
        type: "session.update",
        session: {
          instructions: "Transcribe the user's spoken audio to text. Output only the transcription.",
          turn_detection: null,
          audio: {
            input: { format: { type: "audio/pcm", rate: sampleRate } },
            output: { format: { type: "audio/pcm", rate: sampleRate } }
          }
        }
      }));
    });

    ws.addEventListener("message", (event: any) => {
      try {
        const msg = JSON.parse(String(event.data));
        console.log("[spark:stt] ws event:", msg.type);

        if (msg.type === "session.updated") {
          ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: audioBase64 }));
          ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          ws.send(JSON.stringify({ type: "response.create" }));
        }

        if (msg.type === "conversation.item.input_audio_transcription.completed") {
          transcript = typeof msg.transcript === "string" ? msg.transcript.trim() : "";
          finish(transcript);
        }

        if (msg.type === "response.text.done") {
          if (!transcript) {
            const text = typeof msg.text === "string" ? msg.text.trim() : "";
            if (text) finish(text);
          }
        }

        if (msg.type === "response.done") {
          if (!done) finish(transcript);
        }

        if (msg.type === "error") {
          const errMsg = msg.error?.message || msg.error?.code || "stt_error";
          console.error("[spark:stt] ws error event:", errMsg);
          finish(new Error(errMsg));
        }
      } catch (err) {
        finish(err as Error);
      }
    });

    ws.addEventListener("error", (e: any) => {
      console.error("[spark:stt] ws connection error:", e.message || e);
      finish(new Error("stt_ws_error"));
    });

    ws.addEventListener("close", () => {
      if (!done) finish(new Error("stt_ws_closed_unexpectedly"));
    });
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
    const newBody = applyMemoryOps(memoryBody, memoryOps);
    writeMemoryFile(newBody, onboardingComplete);
  }

  const memoryUpdated = Boolean(memoryMarkdown || memoryOps?.length);
  const safeOpenUrl = wantsOpen ? openUrl : undefined;
  ringPush(chatLog, { at: new Date().toISOString(), userMessage: req.message, reply, memoryUpdated, openUrl: safeOpenUrl }, 200);
  return { reply, memoryUpdated, openUrl: safeOpenUrl };
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
      dataDir: DATA_DIR
    });
  }
  if (req.method === "GET" && url.pathname === "/memory") return json(res, 200, loadMemory());
  if (req.method === "GET" && url.pathname === "/memory/insights") {
    const { body, onboardingComplete } = readMemoryFile();
    const text = `---\nonboardingComplete: ${onboardingComplete}\n---\n\n${body}`;
    return json(res, 200, { text });
  }
  if (req.method === "GET" && url.pathname === "/debug/stats") return json(res, 200, stats);
  if (req.method === "GET" && url.pathname === "/debug/client-logs") {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 20)));
    return json(res, 200, { logs: clientLogs.slice(-limit).reverse() });
  }
  if (req.method === "GET" && url.pathname === "/debug/traces") {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 20)));
    return json(res, 200, { traces: lastDecisions.slice(-limit).reverse() });
  }
  if (req.method === "GET" && url.pathname === "/debug/feedback-traces") {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 20)));
    return json(res, 200, { traces: feedbackLog.slice(-limit).reverse() });
  }
  if (req.method === "GET" && url.pathname === "/debug/chat-log") {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 20)));
    return json(res, 200, { chats: chatLog.slice(-limit).reverse() });
  }
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
    const cacheKey = site || "__all__";
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
      const body = await parseBody<{ audioBase64?: string; sampleRate?: number }>(req);
      const audioBase64 = (body.audioBase64 || "").trim();
      if (!audioBase64) return json(res, 400, { error: "audio_required" });
      const text = await runXaiTranscription(audioBase64, Math.max(8000, Math.min(48000, Number(body.sampleRate) || 16000)));
      return json(res, 200, { text });
    } catch (error) {
      return json(res, 500, { error: String(error) });
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

if (process.env.SPARK_SKIP_AUTOSTART !== "1") {
  startCompanionServer();
}
