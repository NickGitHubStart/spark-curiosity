import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventDecisionResponse, EventIngest, FeedbackEvent, FeedbackResponse, MemorySnapshot, Platform } from "@spark/shared";

const HOST = process.env.SPARK_COMPANION_HOST || "0.0.0.0";
const PORT = Number(process.env.SPARK_COMPANION_PORT || 4343);
const PROVIDER = (process.env.SPARK_AI_PROVIDER || "none").toLowerCase();
const MODEL = process.env.SPARK_LOCAL_LLM_MODEL || "phi3:mini";
const BUILD_ID = "spark-minimal-rewrite-2026-02-20";
const RUNTIME_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SPARK_DATA_DIR || join(__dirname, "..", "data");
const MEMORY_PATH = join(DATA_DIR, "memory.json");
const INSIGHTS_PATH = join(DATA_DIR, "memory-insights.md");

interface ClientLog {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
}

const clientLogs: ClientLog[] = [];
const lastDecisions: Array<Record<string, unknown>> = [];
const feedbackLog: Array<Record<string, unknown>> = [];

const prompts = new Map<string, { platform: Platform; url: string; text: string }>();
const lastPromptAt = new Map<Platform, number>();

const stats = {
  eventsReceived: 0,
  feedbackReceived: 0,
  lastEventAt: "",
  lastFeedbackAt: ""
};

function defaultMemory(): MemorySnapshot {
  return {
    totalEvents: 0,
    totalPrompts: 0,
    totalFeedback: 0,
    platformCounts: {},
    recentEvents: [],
    notes: ["Memory initialized"]
  };
}

function ensureFiles(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  try {
    readFileSync(MEMORY_PATH, "utf8");
  } catch {
    writeFileSync(MEMORY_PATH, JSON.stringify(defaultMemory(), null, 2));
  }
  try {
    readFileSync(INSIGHTS_PATH, "utf8");
  } catch {
    writeFileSync(INSIGHTS_PATH, "# Memory Insights\n\n- initialized\n");
  }
}

function loadMemory(): MemorySnapshot {
  try {
    return JSON.parse(readFileSync(MEMORY_PATH, "utf8")) as MemorySnapshot;
  } catch {
    return defaultMemory();
  }
}

function saveMemory(memory: MemorySnapshot): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2));
}

function appendInsight(line: string): void {
  writeFileSync(INSIGHTS_PATH, `- ${new Date().toISOString()} ${line}\n`, { flag: "a" });
}

function addClientLog(log: ClientLog): void {
  clientLogs.push(log);
  if (clientLogs.length > 300) clientLogs.shift();
}

function addDecision(decision: Record<string, unknown>): void {
  lastDecisions.push(decision);
  if (lastDecisions.length > 300) lastDecisions.shift();
}

function addFeedback(entry: Record<string, unknown>): void {
  feedbackLog.push(entry);
  if (feedbackLog.length > 300) feedbackLog.shift();
}

function classify(event: EventIngest): { score: number; reason: string } {
  let score = 0;
  if (event.platform === "youtube" && event.contentMode === "shorts") score += 4;
  if (event.contentMode === "feed") score += 2;
  if (event.scrollCount > 40) score += 2;
  if (event.sessionSeconds > 120) score += 1;
  if (event.sessionSeconds > 300) score += 1;
  return { score, reason: `score=${score}` };
}

function shouldPrompt(event: EventIngest, score: number): boolean {
  if (event.platform === "other") return false;
  const now = Date.now();
  const last = lastPromptAt.get(event.platform) || 0;
  const cooldownMs = 45000;
  if (now - last < cooldownMs) return false;
  return score >= 4;
}

function decide(event: EventIngest): EventDecisionResponse {
  const memory = loadMemory();
  const { score, reason } = classify(event);

  memory.totalEvents += 1;
  memory.platformCounts[event.platform] = (memory.platformCounts[event.platform] || 0) + 1;
  memory.recentEvents.push(event);
  memory.recentEvents = memory.recentEvents.slice(-50);

  const prompt = shouldPrompt(event, score);
  let response: EventDecisionResponse;
  if (prompt) {
    const promptId = `p-${Date.now()}`;
    const promptText = event.platform === "youtube"
      ? "Wirklich jetzt weiterscrollen oder lieber kurz zu deinem Task zurück?"
      : "Wirklich jetzt weiter im Feed oder kurz Fokus zurückholen?";

    prompts.set(promptId, { platform: event.platform, url: event.url, text: promptText });
    lastPromptAt.set(event.platform, Date.now());
    memory.totalPrompts += 1;
    memory.notes.push(`prompt:${event.platform}`);
    memory.notes = memory.notes.slice(-30);

    response = {
      shouldPrompt: true,
      promptId,
      promptText,
      reason
    };
  } else {
    response = {
      shouldPrompt: false,
      reason
    };
  }

  saveMemory(memory);
  addDecision({ at: new Date().toISOString(), event, response });
  return response;
}

function onFeedback(payload: FeedbackEvent): FeedbackResponse {
  const memory = loadMemory();
  memory.totalFeedback += 1;

  const prompt = prompts.get(payload.promptId);
  let redirectUrl: string | undefined;

  if (prompt && payload.feedback === "down") {
    if (prompt.platform === "youtube") {
      redirectUrl = "https://todoist.com/app";
      appendInsight("YouTube intervention triggered redirect");
      memory.notes.push("youtube_redirect");
    } else if (prompt.platform === "x") {
      redirectUrl = "https://todoist.com/app";
      appendInsight("X intervention triggered redirect");
      memory.notes.push("x_redirect");
    }
  }

  memory.notes = memory.notes.slice(-30);
  saveMemory(memory);
  addFeedback({ at: new Date().toISOString(), payload, redirectUrl });

  return { accepted: true, redirectUrl };
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function html(res: ServerResponse, payload: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(payload);
}

function renderDebugUi(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Spark Debug</title><style>body{font-family:Segoe UI,sans-serif;background:#0b1020;color:#eaf0ff;margin:0;padding:16px}pre{white-space:pre-wrap;background:#10172b;padding:12px;border-radius:8px;max-height:280px;overflow:auto}section{margin-bottom:14px}button{padding:8px 10px}</style></head><body><h1>Spark Debug UI</h1><button id="r">Refresh</button><section><h3>Runtime</h3><pre id="rt"></pre></section><section><h3>Stats</h3><pre id="s"></pre></section><section><h3>Client Logs</h3><pre id="l"></pre></section><section><h3>Decisions</h3><pre id="d"></pre></section><section><h3>Feedback</h3><pre id="f"></pre></section><section><h3>Memory</h3><pre id="m"></pre></section><section><h3>Insights</h3><pre id="i"></pre></section><script>const q=id=>document.getElementById(id);async function j(u){const r=await fetch(u);return r.json()}async function r(){q('rt').textContent=JSON.stringify(await j('/debug/runtime'),null,2);q('s').textContent=JSON.stringify(await j('/debug/stats'),null,2);q('l').textContent=JSON.stringify(await j('/debug/client-logs?limit=20'),null,2);q('d').textContent=JSON.stringify(await j('/debug/traces?limit=20'),null,2);q('f').textContent=JSON.stringify(await j('/debug/feedback-traces?limit=20'),null,2);q('m').textContent=JSON.stringify(await j('/memory'),null,2);q('i').textContent=(await j('/memory/insights')).text}q('r').onclick=r;r();setInterval(r,5000);</script></body></html>`;
}

async function parseBody<T>(req: IncomingMessage): Promise<T> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return JSON.parse(body) as T;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, host: HOST, port: PORT, provider: PROVIDER, model: MODEL, buildId: BUILD_ID, runtimeId: RUNTIME_ID });
  }

  if (req.method === "GET" && url.pathname === "/debug/runtime") {
    return json(res, 200, { buildId: BUILD_ID, runtimeId: RUNTIME_ID, pid: process.pid });
  }

  if (req.method === "GET" && url.pathname === "/memory") {
    return json(res, 200, loadMemory());
  }

  if (req.method === "GET" && url.pathname === "/memory/insights") {
    const text = readFileSync(INSIGHTS_PATH, "utf8");
    return json(res, 200, { text });
  }

  if (req.method === "GET" && url.pathname === "/debug/stats") {
    return json(res, 200, stats);
  }

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

  if (req.method === "GET" && url.pathname === "/debug/ui") {
    return html(res, renderDebugUi());
  }

  if (req.method === "POST" && url.pathname === "/debug/client-log") {
    try {
      const payload = await parseBody<ClientLog>(req);
      addClientLog({
        at: payload.at || new Date().toISOString(),
        level: payload.level || "info",
        message: payload.message || "unknown",
        context: payload.context
      });
      return json(res, 202, { accepted: true });
    } catch {
      return json(res, 400, { accepted: false });
    }
  }

  if (req.method === "POST" && url.pathname === "/event") {
    try {
      const event = await parseBody<EventIngest>(req);
      stats.eventsReceived += 1;
      stats.lastEventAt = new Date().toISOString();
      return json(res, 200, decide(event));
    } catch (error) {
      return json(res, 400, { shouldPrompt: false, reason: `bad_event:${String(error)}` });
    }
  }

  if (req.method === "POST" && url.pathname === "/feedback") {
    try {
      const payload = await parseBody<FeedbackEvent>(req);
      stats.feedbackReceived += 1;
      stats.lastFeedbackAt = new Date().toISOString();
      return json(res, 202, onFeedback(payload));
    } catch {
      return json(res, 400, { accepted: false });
    }
  }

  return json(res, 404, { error: "not_found" });
}

export function createCompanionServer() {
  return createServer((req, res) => {
    void handle(req, res);
  });
}

export function startCompanionServer(port = PORT, host = HOST) {
  ensureFiles();
  const server = createCompanionServer();
  server.listen(port, host, () => {
    console.log(`Spark companion running on http://${host}:${port}`);
  });
  return server;
}

if (process.env.SPARK_SKIP_AUTOSTART !== "1") {
  startCompanionServer();
}
