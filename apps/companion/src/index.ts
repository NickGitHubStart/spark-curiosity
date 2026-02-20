import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ChatRequest, ChatResponse, EventDecisionResponse, EventIngest,
  FeedbackEvent, FeedbackResponse, GoalFeedbackEvent, MemorySnapshot,
  MemoryWrite, MotivationalMedia, Platform, UserGoal
} from "@spark/shared";

const HOST = process.env.SPARK_COMPANION_HOST || "0.0.0.0";
const PORT = Number(process.env.SPARK_COMPANION_PORT || 4343);
const PROVIDER = (process.env.SPARK_AI_PROVIDER || "none").toLowerCase();
const MODEL = process.env.SPARK_LOCAL_LLM_MODEL || "phi3:mini";
const OLLAMA_BASE_URL = process.env.SPARK_OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const BUILD_ID = "spark-goals-chat-v3-2026-02-20";
const RUNTIME_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DATA_DIR = process.env.SPARK_DATA_DIR || join(process.cwd(), "apps", "companion", "data");
const MEMORY_PATH = join(DATA_DIR, "memory.json");
const INSIGHTS_PATH = join(DATA_DIR, "memory-insights.md");
const PROMPT_DIR = process.env.SPARK_PROMPT_DIR || join(process.cwd(), "apps", "companion", "prompts");
const SYSTEM_PROMPT_PATH = join(PROMPT_DIR, "agent-system-prompt.md");

interface ClientLog { at: string; level: "info" | "warn" | "error"; message: string; context?: Record<string, unknown> }
interface AiDecisionResult {
  used: boolean;
  shouldPrompt?: boolean;
  promptText?: string;
  reason?: string;
  thought: string;
  goalQuestion?: string;
  goalOptions?: string[];
  suggestMedia?: string;
  memoryWrites?: MemoryWrite[];
}

const clientLogs: ClientLog[] = [];
const lastDecisions: Array<Record<string, unknown>> = [];
const feedbackLog: Array<Record<string, unknown>> = [];
const chatLog: Array<Record<string, unknown>> = [];
const prompts = new Map<string, { platform: Platform; url: string; text: string }>();
const lastPromptAt = new Map<Platform, number>();

const stats = { eventsReceived: 0, feedbackReceived: 0, chatMessages: 0, lastEventAt: "", lastFeedbackAt: "", lastChatAt: "" };

function defaultMemory(): MemorySnapshot {
  return {
    totalEvents: 0, totalPrompts: 0, totalFeedback: 0,
    platformCounts: {}, recentEvents: [], notes: ["Memory initialized"],
    goals: [], motivationalMedia: [], llmInsights: [], userPreferences: {}
  };
}

function ensureFiles(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(MEMORY_PATH)) writeFileSync(MEMORY_PATH, JSON.stringify(defaultMemory(), null, 2));
  if (!existsSync(INSIGHTS_PATH)) writeFileSync(INSIGHTS_PATH, "# Memory Insights\n\n- initialized\n");
}

function loadMemory(): MemorySnapshot {
  try {
    const raw = JSON.parse(readFileSync(MEMORY_PATH, "utf8")) as Record<string, unknown>;
    const base = defaultMemory();
    return {
      totalEvents: typeof raw.totalEvents === "number" ? raw.totalEvents : base.totalEvents,
      totalPrompts: typeof raw.totalPrompts === "number" ? raw.totalPrompts : base.totalPrompts,
      totalFeedback: typeof raw.totalFeedback === "number" ? raw.totalFeedback : base.totalFeedback,
      platformCounts: (raw.platformCounts as Record<string, number>) || base.platformCounts,
      recentEvents: Array.isArray(raw.recentEvents) ? raw.recentEvents as EventIngest[] : base.recentEvents,
      notes: Array.isArray(raw.notes) ? raw.notes as string[] : base.notes,
      goals: Array.isArray(raw.goals) ? raw.goals as UserGoal[] : base.goals,
      motivationalMedia: Array.isArray(raw.motivationalMedia) ? raw.motivationalMedia as MotivationalMedia[] : base.motivationalMedia,
      llmInsights: Array.isArray(raw.llmInsights) ? raw.llmInsights as string[] : base.llmInsights,
      userPreferences: (raw.userPreferences as Record<string, string>) || base.userPreferences,
    };
  } catch {
    return defaultMemory();
  }
}

function saveMemory(m: MemorySnapshot): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MEMORY_PATH, JSON.stringify(m, null, 2));
}

function appendInsight(line: string): void {
  writeFileSync(INSIGHTS_PATH, `- ${new Date().toISOString()} ${line}\n`, { flag: "a" });
}

function loadSystemPrompt(): string {
  try {
    return readFileSync(SYSTEM_PROMPT_PATH, "utf8");
  } catch {
    return "Du bist Spark, ein freundlicher AI-Begleiter für digitale Achtsamkeit. Antworte immer in validem JSON.";
  }
}

function ringPush<T>(arr: T[], item: T, max: number): void {
  arr.push(item);
  if (arr.length > max) arr.shift();
}

// --- Memory Write Processing ---

function processMemoryWrites(writes: MemoryWrite[], memory: MemorySnapshot): void {
  for (const w of writes) {
    if (w.type === "insight" && w.text) {
      ringPush(memory.llmInsights, w.text, 50);
      appendInsight(`[AI] ${w.text}`);
    }
    if (w.type === "goal" && w.platform && w.intention) {
      const existing = memory.goals.findIndex(g => g.platform === w.platform);
      const goal: UserGoal = {
        platform: w.platform,
        intention: w.intention,
        dailyLimitMinutes: w.dailyLimitMinutes,
        context: w.context,
        setAt: new Date().toISOString()
      };
      if (existing >= 0) {
        memory.goals[existing] = goal;
      } else {
        memory.goals.push(goal);
      }
      appendInsight(`[GOAL] ${w.platform}: ${w.intention}${w.dailyLimitMinutes ? ` (${w.dailyLimitMinutes}min/Tag)` : ""}`);
    }
    if (w.type === "media" && w.url) {
      const media: MotivationalMedia = {
        url: w.url,
        title: w.title || "Unbenannt",
        context: w.context,
        addedAt: new Date().toISOString(),
        feedbackScore: 0
      };
      memory.motivationalMedia.push(media);
      if (memory.motivationalMedia.length > 20) memory.motivationalMedia.shift();
      appendInsight(`[MEDIA] ${media.title}: ${media.url}`);
    }
    if (w.type === "preference" && w.key && w.value) {
      memory.userPreferences[w.key] = w.value;
      appendInsight(`[PREF] ${w.key} = ${w.value}`);
    }
  }
}

// --- Heuristics ---

function classify(event: EventIngest, memory: MemorySnapshot): { score: number; reason: string } {
  let score = 0;
  const goal = memory.goals.find(g => g.platform === event.platform);

  if (goal?.intention === "avoid") score += 5;
  if (goal?.intention === "reduce") score += 2;

  if (event.platform === "youtube" && event.contentMode === "shorts") score += 3;
  if (event.platform === "x" && event.contentMode === "feed") score += 2;
  if (event.contentMode === "feed") score += 1;
  if (event.scrollCount > 30) score += 1;
  if (event.scrollCount > 90) score += 1;
  if (event.sessionSeconds > 120) score += 1;
  if (event.sessionSeconds > 300) score += 1;

  if (goal?.intention === "reduce" && goal.dailyLimitMinutes) {
    const todayPlatformSeconds = memory.recentEvents
      .filter(e => e.platform === event.platform && e.timestamp.startsWith(new Date().toISOString().slice(0, 10)))
      .reduce((sum, e) => sum + (e.sessionSeconds || 0), 0);
    if (todayPlatformSeconds / 60 > goal.dailyLimitMinutes) score += 3;
  }

  const freqPref = memory.userPreferences.interventionFrequency;
  if (freqPref === "less") score -= 2;
  if (freqPref === "more") score += 1;

  return { score: Math.max(0, score), reason: `heuristic_score=${score}${goal ? ` goal=${goal.intention}` : ""}` };
}

function shouldPromptWithCooldown(platform: Platform, score: number, memory: MemorySnapshot): boolean {
  const now = Date.now();
  const last = lastPromptAt.get(platform) || 0;
  const freqPref = memory.userPreferences.interventionFrequency;
  const cooldownMs = freqPref === "less" ? 120000 : freqPref === "more" ? 20000 : 45000;
  if (now - last < cooldownMs) return false;
  const goal = memory.goals.find(g => g.platform === platform);
  if (goal?.intention === "avoid") return score >= 3;
  return score >= 4;
}

// --- LLM ---

function parseLooseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed) as Record<string, unknown>; } catch { /* continue */ }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>; } catch { return null; }
  }
  return null;
}

function buildMemoryContext(memory: MemorySnapshot): string {
  const parts: string[] = [];
  if (memory.goals.length) {
    parts.push("Nutzerziele:");
    for (const g of memory.goals) {
      parts.push(`  - ${g.platform}: ${g.intention}${g.dailyLimitMinutes ? ` (max ${g.dailyLimitMinutes} min/Tag)` : ""}${g.context ? ` — ${g.context}` : ""}`);
    }
  }
  if (memory.motivationalMedia.length) {
    parts.push("Motivationale Medien:");
    for (const m of memory.motivationalMedia.slice(-5)) {
      parts.push(`  - ${m.title}: ${m.url}`);
    }
  }
  if (memory.llmInsights.length) {
    parts.push("Letzte Erkenntnisse:");
    for (const i of memory.llmInsights.slice(-5)) {
      parts.push(`  - ${i}`);
    }
  }
  if (Object.keys(memory.userPreferences).length) {
    parts.push("Nutzerpräferenzen:");
    for (const [k, v] of Object.entries(memory.userPreferences)) {
      parts.push(`  - ${k}: ${v}`);
    }
  }
  parts.push(`Stats: ${memory.totalEvents} Events, ${memory.totalPrompts} Prompts, ${memory.totalFeedback} Feedback`);
  return parts.join("\n");
}

async function callOllama(prompt: string, system: string): Promise<{ raw: string; parsed: Record<string, unknown> | null }> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, prompt, system, stream: false, options: { temperature: 0.3 } })
    });
    if (!response.ok) return { raw: `http_${response.status}`, parsed: null };
    const payload = await response.json() as { response?: string };
    const raw = payload.response || "";
    return { raw, parsed: parseLooseJson(raw) };
  } catch (error) {
    return { raw: `error:${String(error)}`, parsed: null };
  }
}

function extractMemoryWrites(parsed: Record<string, unknown>): MemoryWrite[] {
  if (!Array.isArray(parsed.memoryWrites)) return [];
  return (parsed.memoryWrites as MemoryWrite[]).filter(w => w && typeof w.type === "string");
}

async function runAiDecision(event: EventIngest, heuristic: { score: number; reason: string }, memory: MemorySnapshot): Promise<AiDecisionResult> {
  if (PROVIDER !== "local") return { used: false, thought: `provider_${PROVIDER}` };

  const system = loadSystemPrompt();
  const prompt = [
    "Interaktionstyp: EVENT_DECISION",
    "",
    buildMemoryContext(memory),
    "",
    `Aktueller Kontext:`,
    `  Plattform: ${event.platform}`,
    `  Modus: ${event.contentMode}`,
    `  URL: ${event.url}`,
    `  Titel: ${event.title || "(kein Titel)"}`,
    `  Session: ${event.sessionSeconds}s`,
    `  Scroll: ${event.scrollCount}`,
    `  Heuristik-Score: ${heuristic.score}`,
    "",
    "Antworte als JSON mit den Feldern: shouldPrompt, promptText, reason, goalQuestion (optional), goalOptions (optional), suggestMedia (optional), memoryWrites (optional)."
  ].join("\n");

  const { raw, parsed } = await callOllama(prompt, system);
  if (!parsed) return { used: false, thought: `invalid_json: ${raw.slice(0, 100)}` };

  return {
    used: true,
    shouldPrompt: Boolean(parsed.shouldPrompt),
    promptText: typeof parsed.promptText === "string" ? parsed.promptText : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    goalQuestion: typeof parsed.goalQuestion === "string" ? parsed.goalQuestion : undefined,
    goalOptions: Array.isArray(parsed.goalOptions) ? parsed.goalOptions as string[] : undefined,
    suggestMedia: typeof parsed.suggestMedia === "string" ? parsed.suggestMedia : undefined,
    memoryWrites: extractMemoryWrites(parsed),
    thought: typeof parsed.reason === "string" ? parsed.reason : "ai_ok"
  };
}

async function runAiChat(message: string, memory: MemorySnapshot): Promise<{ reply: string; memoryWrites: MemoryWrite[] }> {
  if (PROVIDER !== "local") {
    return { reply: "AI-Provider ist nicht aktiv. Starte mit SPARK_AI_PROVIDER=local für Chat-Funktion.", memoryWrites: [] };
  }

  const system = loadSystemPrompt();
  const prompt = [
    "Interaktionstyp: CHAT",
    "",
    buildMemoryContext(memory),
    "",
    `Nutzer-Nachricht: ${message}`,
    "",
    "Antworte als JSON mit den Feldern: reply (string), memoryWrites (optional array)."
  ].join("\n");

  const { raw, parsed } = await callOllama(prompt, system);
  if (!parsed) return { reply: raw || "Entschuldigung, ich konnte deine Nachricht nicht verarbeiten.", memoryWrites: [] };

  return {
    reply: typeof parsed.reply === "string" ? parsed.reply : "Nachricht erhalten.",
    memoryWrites: extractMemoryWrites(parsed)
  };
}

// --- Decision Logic ---

function defaultPromptText(event: EventIngest, memory: MemorySnapshot): string {
  const goal = memory.goals.find(g => g.platform === event.platform);
  if (goal?.intention === "avoid") {
    if (event.platform === "youtube") return "Du wolltest YouTube vermeiden. Soll ich dich zu deinen Todos bringen?";
    if (event.platform === "x") return "Du wolltest X vermeiden. Zurück zum Fokus?";
    return "Du wolltest das hier eigentlich vermeiden. Zurück zum Fokus?";
  }
  if (goal?.intention === "reduce") {
    return `Du wolltest ${event.platform === "youtube" ? "YouTube" : event.platform} reduzieren. Schon ${Math.round(event.sessionSeconds / 60)} Minuten hier.`;
  }
  if (event.platform === "youtube" && event.contentMode === "shorts") return "YouTube Shorts — wirklich jetzt, oder zurück zum Fokus?";
  if (event.platform === "x") return "X-Feed — wirklich jetzt, oder Fokus zurückholen?";
  return "Wirklich jetzt weitermachen, oder kurz prüfen was dein Ziel war?";
}

function shouldSuggestGoal(event: EventIngest, memory: MemorySnapshot): boolean {
  if (event.platform === "other") return false;
  if (memory.goals.some(g => g.platform === event.platform)) return false;
  const platformCount = memory.platformCounts[event.platform] || 0;
  return platformCount > 15 && platformCount % 20 === 0;
}

async function decide(event: EventIngest): Promise<EventDecisionResponse> {
  const memory = loadMemory();
  const heuristic = classify(event, memory);

  memory.totalEvents += 1;
  memory.platformCounts[event.platform] = (memory.platformCounts[event.platform] || 0) + 1;
  ringPush(memory.recentEvents, event, 100);

  const ai = await runAiDecision(event, heuristic, memory);
  if (ai.memoryWrites?.length) processMemoryWrites(ai.memoryWrites, memory);

  const aiWantsPrompt = ai.used ? Boolean(ai.shouldPrompt) : false;
  const heuristicPrompt = shouldPromptWithCooldown(event.platform, heuristic.score, memory);
  const finalPrompt = aiWantsPrompt || (!ai.used && heuristicPrompt);

  let response: EventDecisionResponse;

  if (finalPrompt) {
    const promptId = `p-${Date.now()}`;
    const text = ai.promptText || defaultPromptText(event, memory);
    prompts.set(promptId, { platform: event.platform, url: event.url, text });
    lastPromptAt.set(event.platform, Date.now());
    memory.totalPrompts += 1;
    ringPush(memory.notes, `prompt:${event.platform}`, 40);

    response = {
      shouldPrompt: true, promptId, promptText: text.slice(0, 250),
      reason: ai.used ? `ai:${ai.reason || ai.thought}` : heuristic.reason,
      goalQuestion: ai.goalQuestion, goalOptions: ai.goalOptions, suggestMedia: ai.suggestMedia,
      ai: { provider: PROVIDER, model: MODEL, used: ai.used, thought: ai.thought }
    };
  } else {
    const suggestGoal = !ai.used && shouldSuggestGoal(event, memory);
    response = {
      shouldPrompt: suggestGoal,
      promptId: suggestGoal ? `goal-${Date.now()}` : undefined,
      reason: ai.used ? `ai:${ai.reason || ai.thought}` : heuristic.reason,
      goalQuestion: suggestGoal
        ? `Mir fällt auf, dass du oft ${event.platform === "youtube" ? "YouTube" : "X"} nutzt. Willst du das anpassen?`
        : ai.goalQuestion,
      goalOptions: suggestGoal ? ["Vermeiden", "Reduzieren", "Passt so"] : ai.goalOptions,
      ai: { provider: PROVIDER, model: MODEL, used: ai.used, thought: ai.thought }
    };
  }

  saveMemory(memory);
  ringPush(lastDecisions, { at: new Date().toISOString(), event, response, heuristic, aiUsed: ai.used }, 500);
  return response;
}

// --- Feedback & Chat ---

function onFeedback(payload: FeedbackEvent): FeedbackResponse {
  const memory = loadMemory();
  memory.totalFeedback += 1;
  const prompt = prompts.get(payload.promptId);
  let redirectUrl: string | undefined;

  if (prompt && payload.feedback === "down") {
    const goal = memory.goals.find(g => g.platform === prompt.platform);
    if (goal?.intention === "avoid" || goal?.intention === "reduce") {
      redirectUrl = "https://todoist.com/app";
      appendInsight(`${prompt.platform} intervention → redirect (Ziel: ${goal.intention})`);
    } else {
      redirectUrl = "https://todoist.com/app";
      appendInsight(`${prompt.platform} intervention → redirect`);
    }
    ringPush(memory.notes, `redirect:${prompt.platform}`, 40);
  }
  if (prompt && payload.feedback === "up") {
    ringPush(memory.notes, `accepted:${prompt.platform}`, 40);
  }

  saveMemory(memory);
  ringPush(feedbackLog, { at: new Date().toISOString(), payload, redirectUrl }, 500);
  return { accepted: true, redirectUrl };
}

function onGoalFeedback(payload: GoalFeedbackEvent): void {
  const memory = loadMemory();
  const intentionMap: Record<string, "avoid" | "reduce" | "keep"> = {
    "Vermeiden": "avoid", "vermeiden": "avoid", "avoid": "avoid",
    "Reduzieren": "reduce", "reduzieren": "reduce", "reduce": "reduce",
    "Passt so": "keep", "passt so": "keep", "keep": "keep", "Beibehalten": "keep"
  };
  const intention = intentionMap[payload.selectedOption] || "keep";
  const goal: UserGoal = {
    platform: payload.platform,
    intention,
    setAt: new Date().toISOString(),
    context: `Nutzer hat '${payload.selectedOption}' gewählt`
  };
  const idx = memory.goals.findIndex(g => g.platform === payload.platform);
  if (idx >= 0) memory.goals[idx] = goal;
  else memory.goals.push(goal);

  appendInsight(`[GOAL] Nutzer setzt Ziel für ${payload.platform}: ${intention}`);
  ringPush(memory.notes, `goal_set:${payload.platform}:${intention}`, 40);
  saveMemory(memory);
}

async function onChat(req: ChatRequest): Promise<ChatResponse> {
  const memory = loadMemory();
  stats.chatMessages += 1;
  stats.lastChatAt = new Date().toISOString();

  const { reply, memoryWrites } = await runAiChat(req.message, memory);
  if (memoryWrites.length) {
    processMemoryWrites(memoryWrites, memory);
    saveMemory(memory);
  }

  ringPush(chatLog, { at: new Date().toISOString(), userMessage: req.message, reply, memoryUpdated: memoryWrites.length > 0 }, 200);
  return { reply, memoryUpdated: memoryWrites.length > 0 };
}

// --- HTTP ---

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

function renderDebugUi(): string {
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Debug</title>
<style>
*{box-sizing:border-box;margin:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0e1a;color:#d8e0f0;padding:20px}
h1{font-size:22px;color:#7eb8ff;margin-bottom:4px}
.sub{font-size:13px;color:#5a6a8a;margin-bottom:16px}
.toolbar{display:flex;gap:8px;margin-bottom:16px;align-items:center}
.toolbar button{background:#1a2240;color:#7eb8ff;border:1px solid #2a3a5a;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px}
.toolbar button:hover{background:#243060}
.status{font-size:12px;color:#4a5a7a}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
@media(max-width:1100px){.grid{grid-template-columns:1fr 1fr}}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
.card{background:#10172a;border:1px solid #1a2545;border-radius:10px;overflow:hidden}
.card.span2{grid-column:span 2}
@media(max-width:1100px){.card.span2{grid-column:span 1}}
.card-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#131c33;border-bottom:1px solid #1a2545}
.card-head h3{font-size:14px;color:#8ab4e8;font-weight:600}
.badge{font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600}
.badge-green{background:#0d3320;color:#34d399}
.badge-blue{background:#0d2640;color:#60a5fa}
.badge-yellow{background:#332d0d;color:#fbbf24}
.badge-red{background:#330d0d;color:#f87171}
.card-body{padding:12px 14px;max-height:320px;overflow-y:auto}
.card-body.tall{max-height:480px}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.stat-item{background:#0d1225;border-radius:8px;padding:10px}
.stat-val{font-size:22px;font-weight:700;color:#fff}
.stat-label{font-size:11px;color:#5a6a8a;margin-top:2px}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;color:#a0b0d0;margin:0}
.decision-card{background:#0d1225;border-radius:8px;padding:10px;margin-bottom:8px;border-left:3px solid #2a3a5a}
.decision-card.prompted{border-left-color:#34d399}
.decision-card .meta{font-size:11px;color:#5a6a8a;margin-bottom:4px}
.decision-card .reason{font-size:13px;color:#c0d0e8}
.decision-card .ai-thought{font-size:12px;color:#8090b0;margin-top:4px;font-style:italic}
.insight-line{padding:4px 0;border-bottom:1px solid #151f35;font-size:13px;line-height:1.5}
.log-entry{padding:4px 0;border-bottom:1px solid #151f35;font-size:12px}
.log-entry .ts{color:#4a5a7a;font-size:11px}
.log-entry.error{color:#f87171}
.log-entry.warn{color:#fbbf24}
.mem-section{margin-bottom:10px}
.mem-section h4{font-size:12px;color:#5a6a8a;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px}
.mem-tag{display:inline-block;background:#1a2545;color:#8ab4e8;padding:2px 8px;border-radius:4px;margin:2px;font-size:12px}
.platform-bar{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}
.platform-chip{padding:4px 10px;border-radius:6px;font-size:13px;font-weight:600}
.platform-chip.youtube{background:#1a0d0d;color:#ff6b6b}
.platform-chip.x{background:#0d1a2a;color:#60a5fa}
.platform-chip.other{background:#1a1a0d;color:#9a9a6a}
.goal-card{background:#0d1a25;border:1px solid #1a3545;border-radius:8px;padding:8px 10px;margin-bottom:6px}
.goal-card .label{font-size:11px;color:#5a7a8a;text-transform:uppercase}
.goal-card .val{font-size:14px;color:#60d0a0;font-weight:600}
.media-card{background:#1a0d25;border-radius:8px;padding:6px 10px;margin-bottom:4px;font-size:12px}
.media-card a{color:#a080d0;text-decoration:none}
.chat-entry{margin-bottom:8px}
.chat-entry .user{color:#7eb8ff;font-weight:600}
.chat-entry .ai{color:#34d399;font-weight:600}
.chat-entry .msg{font-size:13px;margin-top:2px}
</style>
</head><body>
<h1>Spark Curiosity — Debug Dashboard</h1>
<div class="sub" id="runtime-info"></div>
<div class="toolbar">
  <button onclick="refresh()">Aktualisieren</button>
  <button onclick="clearView()">Logs leeren</button>
  <span class="status" id="refresh-status"></span>
</div>
<div class="grid">
  <div class="card">
    <div class="card-head"><h3>Stats</h3><span class="badge badge-green" id="stats-badge">-</span></div>
    <div class="card-body"><div class="stat-grid" id="stats"></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Ziele & Pr\u00e4ferenzen</h3><span class="badge badge-green" id="goals-badge">-</span></div>
    <div class="card-body" id="goals"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Memory</h3><span class="badge badge-blue" id="mem-badge">-</span></div>
    <div class="card-body" id="memory"></div>
  </div>
  <div class="card span2">
    <div class="card-head"><h3>Letzte Entscheidungen</h3><span class="badge badge-yellow" id="dec-badge">-</span></div>
    <div class="card-body tall" id="decisions"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Insights & AI-Notizen</h3></div>
    <div class="card-body tall" id="insights"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Chat-Verlauf</h3><span class="badge badge-blue" id="chat-badge">-</span></div>
    <div class="card-body" id="chats"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Feedback</h3><span class="badge badge-blue" id="fb-badge">-</span></div>
    <div class="card-body" id="feedback"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Client Logs</h3></div>
    <div class="card-body tall" id="logs"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Runtime</h3></div>
    <div class="card-body"><pre id="runtime"></pre></div>
  </div>
</div>
<script>
async function j(u){try{const r=await fetch(u);return r.json()}catch{return null}}
function ts(iso){if(!iso)return'-';const d=new Date(iso);return d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function renderStats(s){
  document.getElementById('stats-badge').textContent=s.eventsReceived+' events';
  document.getElementById('stats').innerHTML=[
    {v:s.eventsReceived,l:'Events'},{v:s.feedbackReceived,l:'Feedback'},
    {v:s.chatMessages||0,l:'Chat-Nachr.'},{v:ts(s.lastEventAt),l:'Letztes Event'}
  ].map(x=>'<div class="stat-item"><div class="stat-val">'+x.v+'</div><div class="stat-label">'+x.l+'</div></div>').join('');
}
function renderGoals(m){
  const el=document.getElementById('goals');
  const badge=document.getElementById('goals-badge');
  let html='';
  if(m.goals&&m.goals.length){
    badge.textContent=m.goals.length+' Ziele';
    m.goals.forEach(g=>{
      const labels={avoid:'Vermeiden',reduce:'Reduzieren',keep:'Beibehalten'};
      html+='<div class="goal-card"><div class="label">'+g.platform+'</div><div class="val">'+(labels[g.intention]||g.intention)+(g.dailyLimitMinutes?' ('+g.dailyLimitMinutes+' min/Tag)':'')+'</div>'+(g.context?'<div style="font-size:11px;color:#5a7a8a;margin-top:2px">'+g.context+'</div>':'')+'</div>';
    });
  }else{badge.textContent='Keine';html='<div style="color:#5a6a8a">Noch keine Ziele gesetzt.</div>';}
  if(m.motivationalMedia&&m.motivationalMedia.length){
    html+='<div class="mem-section" style="margin-top:10px"><h4>Motivationale Medien</h4>';
    m.motivationalMedia.forEach(x=>{html+='<div class="media-card"><a href="'+x.url+'" target="_blank">'+x.title+'</a>'+(x.context?' — '+x.context:'')+'</div>';});
    html+='</div>';
  }
  if(Object.keys(m.userPreferences||{}).length){
    html+='<div class="mem-section" style="margin-top:10px"><h4>Pr\\u00e4ferenzen</h4>';
    for(const[k,v]of Object.entries(m.userPreferences)){html+='<div class="mem-tag">'+k+': '+v+'</div>';}
    html+='</div>';
  }
  el.innerHTML=html;
}
function renderMemory(m){
  const el=document.getElementById('memory');
  document.getElementById('mem-badge').textContent=m.totalEvents+' total';
  let html='<div class="mem-section"><h4>Plattformen</h4><div class="platform-bar">';
  for(const[p,c]of Object.entries(m.platformCounts||{})){html+='<div class="platform-chip '+p+'">'+p+': '+c+'</div>';}
  html+='</div></div>';
  html+='<div class="mem-section"><h4>Zusammenfassung</h4><div class="stat-grid">';
  html+='<div class="stat-item"><div class="stat-val">'+m.totalPrompts+'</div><div class="stat-label">Prompts</div></div>';
  html+='<div class="stat-item"><div class="stat-val">'+m.totalFeedback+'</div><div class="stat-label">Feedback</div></div>';
  html+='</div></div>';
  if(m.notes&&m.notes.length){html+='<div class="mem-section"><h4>Notizen</h4>';m.notes.slice(-8).reverse().forEach(n=>{html+='<div class="mem-tag">'+n+'</div>';});html+='</div>';}
  el.innerHTML=html;
}
function renderInsights(text,llmInsights){
  const el=document.getElementById('insights');
  let html='';
  if(llmInsights&&llmInsights.length){
    html+='<div class="mem-section"><h4>AI-Erkenntnisse</h4>';
    llmInsights.slice(-10).reverse().forEach(i=>{html+='<div class="insight-line" style="color:#60d0a0">'+i+'</div>';});
    html+='</div>';
  }
  if(text&&text.trim()){
    html+='<div class="mem-section"><h4>Insights-Log</h4>';
    text.trim().split('\\n').filter(l=>l.trim()).slice(-10).reverse().forEach(l=>{html+='<div class="insight-line">'+l.replace(/^- /,'')+'</div>';});
    html+='</div>';
  }
  if(!html)html='<div style="color:#5a6a8a">Noch keine Insights.</div>';
  el.innerHTML=html;
}
function renderDecisions(traces){
  const el=document.getElementById('decisions');
  document.getElementById('dec-badge').textContent=traces.length+' letzte';
  el.innerHTML=traces.slice(0,20).map(t=>{
    const r=t.response||{};const e=t.event||{};const prompted=r.shouldPrompt;const ai=r.ai||{};
    let h='<div class="decision-card'+(prompted?' prompted':'')+'">';
    h+='<div class="meta">'+ts(t.at)+' \\u00b7 '+(e.platform||'?')+' \\u00b7 '+(e.contentMode||'?')+'</div>';
    h+='<div class="reason">'+(prompted?'<strong>PROMPT:</strong> '+(r.promptText||r.goalQuestion||'-'):'<strong>Kein Prompt</strong> \\u2014 '+(r.reason||'-'))+'</div>';
    if(r.goalQuestion){h+='<div class="ai-thought">Ziel-Frage: '+r.goalQuestion+'</div>';}
    if(ai.used){h+='<div class="ai-thought">AI: '+ai.thought+'</div>';}
    if(e.url){h+='<div class="meta" style="margin-top:4px">'+String(e.url).slice(0,80)+'</div>';}
    h+='</div>';return h;
  }).join('');
}
function renderChats(chats){
  const el=document.getElementById('chats');
  document.getElementById('chat-badge').textContent=(chats.length||0)+' Nachr.';
  el.innerHTML=chats.slice(0,20).map(c=>{
    let h='<div class="chat-entry"><span class="ts">'+ts(c.at)+'</span>';
    h+='<div><span class="user">Du:</span> <span class="msg">'+c.userMessage+'</span></div>';
    h+='<div><span class="ai">Spark:</span> <span class="msg">'+c.reply+'</span></div>';
    if(c.memoryUpdated)h+='<span class="badge badge-green" style="margin-top:4px">Memory aktualisiert</span>';
    h+='</div>';return h;
  }).join('');
}
function renderFeedback(traces){
  const el=document.getElementById('feedback');
  document.getElementById('fb-badge').textContent=traces.length+' Eintr.';
  el.innerHTML=traces.slice(0,15).map(t=>{
    const p=t.payload||{};const emoji=p.feedback==='up'?'\\u{1F44D}':'\\u{1F44E}';
    let h='<div class="log-entry"><span class="ts">'+ts(t.at)+'</span> '+emoji+' '+(p.feedback||'?');
    if(t.redirectUrl)h+=' \\u2192 <span style="color:#34d399">'+t.redirectUrl+'</span>';
    return h+'</div>';
  }).join('');
}
function renderLogs(logs){
  document.getElementById('logs').innerHTML=logs.slice(0,40).map(l=>{
    const cls=l.level==='error'?'error':l.level==='warn'?'warn':'';
    let h='<div class="log-entry '+cls+'"><span class="ts">'+ts(l.at)+'</span> <strong>'+l.message+'</strong>';
    if(l.context&&l.context.reason)h+=' ('+l.context.reason+')';
    return h+'</div>';
  }).join('');
}
function renderRuntime(rt){
  document.getElementById('runtime-info').textContent='PID '+rt.pid+' \\u00b7 Provider: '+rt.provider+' \\u00b7 Model: '+rt.model;
  document.getElementById('runtime').textContent=JSON.stringify(rt,null,2);
}
async function refresh(){
  document.getElementById('refresh-status').textContent='Lade...';
  try{
    const[rt,s,l,d,f,m,i,ch]=await Promise.all([
      j('/debug/runtime'),j('/debug/stats'),j('/debug/client-logs?limit=40'),j('/debug/traces?limit=20'),
      j('/debug/feedback-traces?limit=15'),j('/memory'),j('/memory/insights'),j('/debug/chat-log?limit=20')
    ]);
    if(rt)renderRuntime(rt);if(s)renderStats(s);if(l)renderLogs(l.logs||[]);
    if(d)renderDecisions(d.traces||[]);if(f)renderFeedback(f.traces||[]);
    if(m){renderMemory(m);renderGoals(m);renderInsights(i?i.text:'',m.llmInsights||[]);}
    if(ch)renderChats(ch.chats||[]);
    document.getElementById('refresh-status').textContent='Aktualisiert: '+new Date().toLocaleTimeString('de-DE');
  }catch(e){document.getElementById('refresh-status').textContent='Fehler: '+e;}
}
function clearView(){['logs','decisions','feedback','chats'].forEach(id=>{document.getElementById(id).innerHTML='';})}
refresh();setInterval(refresh,3000);
</script></body></html>`;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
    return void res.end();
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, host: HOST, port: PORT, provider: PROVIDER, model: MODEL, buildId: BUILD_ID, runtimeId: RUNTIME_ID });
  }
  if (req.method === "GET" && url.pathname === "/debug/runtime") {
    return json(res, 200, { buildId: BUILD_ID, runtimeId: RUNTIME_ID, pid: process.pid, provider: PROVIDER, model: MODEL, ollamaBaseUrl: OLLAMA_BASE_URL, dataDir: DATA_DIR });
  }
  if (req.method === "GET" && url.pathname === "/memory") return json(res, 200, loadMemory());
  if (req.method === "GET" && url.pathname === "/memory/insights") {
    try { return json(res, 200, { text: readFileSync(INSIGHTS_PATH, "utf8") }); }
    catch { return json(res, 200, { text: "" }); }
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
      return json(res, 400, { shouldPrompt: false, reason: `bad_event:${String(error)}` });
    }
  }
  if (req.method === "POST" && url.pathname === "/feedback") {
    try {
      const p = await parseBody<FeedbackEvent>(req);
      stats.feedbackReceived += 1;
      stats.lastFeedbackAt = new Date().toISOString();
      return json(res, 202, onFeedback(p));
    } catch { return json(res, 400, { accepted: false }); }
  }
  if (req.method === "POST" && url.pathname === "/goal-feedback") {
    try {
      const p = await parseBody<GoalFeedbackEvent>(req);
      onGoalFeedback(p);
      return json(res, 202, { accepted: true });
    } catch { return json(res, 400, { accepted: false }); }
  }
  if (req.method === "POST" && url.pathname === "/chat") {
    try {
      const p = await parseBody<ChatRequest>(req);
      return json(res, 200, await onChat(p));
    } catch (error) {
      return json(res, 400, { reply: `Fehler: ${String(error)}`, memoryUpdated: false });
    }
  }

  return json(res, 404, { error: "not_found" });
}

export function createCompanionServer() {
  return createServer((req, res) => { void handle(req, res); });
}

export function startCompanionServer(port = PORT, host = HOST) {
  ensureFiles();
  const server = createCompanionServer();
  server.listen(port, host, () => { console.log(`Spark companion running on http://${host}:${port}`); });
  return server;
}

if (process.env.SPARK_SKIP_AUTOSTART !== "1") {
  startCompanionServer();
}
