import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdaptiveCheckPrompt,
  ContentMode,
  EventDecisionResponse,
  EventIngest,
  FeedbackEvent,
  FeedbackResponse,
  Intervention,
  LlmDecision,
  MemorySnapshot,
  Platform,
  Recommendation
} from "@spark/shared";

const PORT = Number(process.env.SPARK_COMPANION_PORT || 4343);
const AI_PROVIDER = (process.env.SPARK_AI_PROVIDER || "local").toLowerCase();
const LOCAL_LLM_URL = process.env.SPARK_LOCAL_LLM_URL || "http://127.0.0.1:11434/api/generate";
const LOCAL_LLM_MODEL = process.env.SPARK_LOCAL_LLM_MODEL || "phi3:mini";
const OPENAI_MODEL = process.env.SPARK_OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const HOST = process.env.SPARK_COMPANION_HOST || "127.0.0.1";

const LLM_DEBOUNCE_MS = Number(process.env.SPARK_LLM_DEBOUNCE_MS || 3000);
const LLM_HEARTBEAT_MS = Number(process.env.SPARK_LLM_HEARTBEAT_MS || 60000);
const SHORT_TERM_TTL_HOURS = Number(process.env.SPARK_SHORT_TERM_TTL_HOURS || 24);

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SPARK_DATA_DIR || join(__dirname, "..", "data");
const PROMPTS_DIR = process.env.SPARK_PROMPTS_DIR || join(__dirname, "..", "prompts");
const SYSTEM_PROMPT_PATH = join(PROMPTS_DIR, "agent-system-prompt.md");
const MEMORY_PATH = join(DATA_DIR, "memory.json");
const EVENT_LOG_PATH = join(DATA_DIR, "events.ndjson");
const MEMORY_JOURNAL_PATH = join(DATA_DIR, "memory-journal.md");
const MEMORY_INSIGHTS_PATH = join(DATA_DIR, "memory-insights.md");

let lastPromptId = 0;
let lastEventId = 0;
let lastDecisionDebug: Record<string, unknown> = {};
let lastLlmCallAt = 0;
const prompts = new Map<string, PromptMeta>();
const decisionTraces: DecisionTrace[] = [];
const feedbackTraces: FeedbackTrace[] = [];
const clientLogs: ClientLog[] = [];
const TRACE_LIMIT = Number(process.env.SPARK_TRACE_LIMIT || 250);
const ingestStats = {
  eventsReceived: 0,
  feedbackReceived: 0,
  lastEventAt: "",
  lastFeedbackAt: ""
};

interface RuntimeMemory {
  snapshot: MemorySnapshot;
  counters: {
    downByPlatform: Record<string, number>;
    upByPlatform: Record<string, number>;
    lastPromptAtByPlatform: Record<string, string>;
    lastLlmAtByPlatform: Record<string, string>;
  };
}

interface ParsedAgentOutput {
  riskDelta?: number;
  popupText?: string;
  intentGuess?: string;
  styleHint?: string;
  interests: string[];
  patterns: string[];
  recommendations: Recommendation[];
  redirectUrl?: string;
  insights: string[];
  rawText?: string;
}

interface PromptMeta {
  recommendations: Recommendation[];
  platform: string;
  redirectUrl?: string;
  musicCandidate?: { title: string; url: string };
}

interface DecisionTrace {
  id: string;
  at: string;
  event: EventIngest;
  llm: {
    source: "llm" | "fallback";
    prompt?: string;
    rawOutput?: string;
    parsed?: ParsedAgentOutput | null;
  };
  decision: {
    riskScore: number;
    riskDelta: number;
    promptAllowed: boolean;
    shouldPrompt: boolean;
    reasonCodes: string[];
    modelUsed: string;
  };
  memory: {
    shortTermCount: number;
    longTermCount: number;
    midTermCount: number;
    motivationalCount: number;
  };
}

interface FeedbackTrace {
  id: string;
  at: string;
  payload: FeedbackEvent;
  result: FeedbackResponse;
}

interface ClientLog {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
}

const defaultMemory: RuntimeMemory = {
  snapshot: {
    shortTermEvents: [],
    longTermGoals: [],
    midTermPatterns: [],
    motivationalMedia: [],
    shortTermState: {
      currentRiskScore: 0,
      lastUpdated: new Date().toISOString()
    }
  },
  counters: {
    downByPlatform: {},
    upByPlatform: {},
    lastPromptAtByPlatform: {},
    lastLlmAtByPlatform: {}
  }
};

const defaultSystemPrompt = [
  "Du bist der Spark-Curiosity-Agent. Du bist direkt, klar, hilfreich und persoenlich.",
  "Ziel: User vor ungewolltem Doomscrolling schuetzen und zu neugierfoerdernden Aktionen lenken.",
  "Du darfst frei schreiben. Optional Direktiven: [[popup:...]] [[risk:+0.10]] [[goal:...]] [[pattern:...]] [[insight:...]] [[rec:Titel|https://...]] [[redirect:https://...]]",
  "Memory-Regel: promote nur belegte Trends, kein unnötiger Spam.",
  "Interventionen nur, wenn sinnvoll; kurze klar verständliche Popups."
].join("\n");

function ensureTextFiles(): void {
  mkdirSync(PROMPTS_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
  try {
    const existing = readFileSync(SYSTEM_PROMPT_PATH, "utf8").trim();
    if (!existing) throw new Error("empty");
  } catch {
    writeFileSync(SYSTEM_PROMPT_PATH, defaultSystemPrompt + "\n");
  }
  try {
    readFileSync(MEMORY_INSIGHTS_PATH, "utf8");
  } catch {
    writeFileSync(MEMORY_INSIGHTS_PATH, "# Spark Memory Insights\n\n");
  }
}

function loadMemory(): RuntimeMemory {
  try {
    const parsed = JSON.parse(readFileSync(MEMORY_PATH, "utf8")) as RuntimeMemory;
    parsed.snapshot.shortTermEvents ||= [];
    parsed.snapshot.motivationalMedia ||= [];
    parsed.counters.lastLlmAtByPlatform ||= {};
    return parsed;
  } catch {
    writeMemory(defaultMemory);
    return defaultMemory;
  }
}

function writeMemory(mem: RuntimeMemory): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2));
}

function appendEventLog(event: EventIngest, decision: Record<string, unknown>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(EVENT_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), event, decision }) + "\n", { flag: "a" });
}

function addDecisionTrace(trace: DecisionTrace): void {
  decisionTraces.push(trace);
  if (decisionTraces.length > TRACE_LIMIT) {
    decisionTraces.splice(0, decisionTraces.length - TRACE_LIMIT);
  }
}

function addFeedbackTrace(trace: FeedbackTrace): void {
  feedbackTraces.push(trace);
  if (feedbackTraces.length > TRACE_LIMIT) {
    feedbackTraces.splice(0, feedbackTraces.length - TRACE_LIMIT);
  }
}

function addClientLog(log: ClientLog): void {
  clientLogs.push(log);
  if (clientLogs.length > TRACE_LIMIT) {
    clientLogs.splice(0, clientLogs.length - TRACE_LIMIT);
  }
}

function appendMemoryJournal(line: string): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MEMORY_JOURNAL_PATH, `- ${new Date().toISOString()} ${line}\n`, { flag: "a" });
}

function appendInsight(line: string): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MEMORY_INSIGHTS_PATH, `- ${new Date().toISOString()} ${line}\n`, { flag: "a" });
}

ensureTextFiles();
let memory = loadMemory();

function readSystemPrompt(): string {
  return readFileSync(SYSTEM_PROMPT_PATH, "utf8");
}

function shortSummary(event: EventIngest): string {
  const title = event.content?.youtube?.videoTitle || event.content?.pageTitle || event.url;
  return `${event.platform}/${event.contentMode}: ${String(title).slice(0, 120)}`;
}

function compactShortTerm(now = Date.now()): void {
  const ttlMs = SHORT_TERM_TTL_HOURS * 3600 * 1000;
  const kept = (memory.snapshot.shortTermEvents || []).filter(e => now - new Date(e.timestamp).getTime() <= ttlMs);
  memory.snapshot.shortTermEvents = kept.slice(-120);
}

function pushShortTermEvent(event: EventIngest): void {
  const entry = {
    id: `e-${++lastEventId}`,
    timestamp: event.timestamp,
    platform: event.platform,
    contentMode: event.contentMode,
    summary: shortSummary(event)
  };
  memory.snapshot.shortTermEvents ||= [];
  memory.snapshot.shortTermEvents.push(entry);
  compactShortTerm();
}

function platformKey(p: Platform): string {
  return p;
}

function shouldCallLlm(event: EventIngest): { call: boolean; reasonCodes: string[] } {
  const reasons: string[] = [];
  const now = Date.now();
  const k = platformKey(event.platform);
  const lastByPlatform = memory.counters.lastLlmAtByPlatform[k];
  const lastMs = lastByPlatform ? new Date(lastByPlatform).getTime() : 0;

  if (!lastByPlatform) reasons.push("first_llm_call");

  const recent = (memory.snapshot.shortTermEvents || []).slice(-2);
  if (recent.length >= 2) {
    const prev = recent[recent.length - 2];
    const cur = recent[recent.length - 1];
    if (prev.contentMode !== cur.contentMode || prev.platform !== cur.platform) reasons.push("context_transition");
  }

  if ((event.signals.scrollEvents || 0) > 30) reasons.push("high_scroll_activity");
  if ((event.signals.sessionSeconds || 0) > 180) reasons.push("long_session");

  if (now - lastLlmCallAt >= LLM_HEARTBEAT_MS) reasons.push("llm_heartbeat");
  if (now - lastMs < LLM_DEBOUNCE_MS) return { call: false, reasonCodes: ["debounced"] };

  return { call: reasons.length > 0, reasonCodes: reasons.length ? reasons : ["no_relevant_change"] };
}

function riskScoreHeuristic(event: EventIngest): number {
  let score = 0.1;
  if (event.contentMode === "shorts") score += 0.45;
  if (event.contentMode === "feed") score += 0.3;
  if (event.signals.sessionSeconds > 120) score += 0.15;
  if (event.signals.sessionSeconds > 300) score += 0.15;
  if (event.signals.scrollEvents > 40) score += 0.2;
  return Math.min(score, 1);
}

function canPrompt(event: EventIngest, score: number): boolean {
  const lastAt = memory.counters.lastPromptAtByPlatform[event.platform];
  const threshold = event.contentMode === "shorts" ? 0.35 : 0.42;
  if (!lastAt) return score >= threshold;
  const elapsed = Math.floor((Date.now() - new Date(lastAt).getTime()) / 1000);
  const cooldown = score > 0.8 ? 45 : 90;
  return score >= threshold && elapsed >= cooldown;
}

function upsertPattern(patterns: MemorySnapshot["midTermPatterns"], key: string): MemorySnapshot["midTermPatterns"] {
  const k = key.trim().toLowerCase();
  if (!k) return patterns;
  const idx = patterns.findIndex(p => p.pattern === k);
  const now = new Date().toISOString();
  if (idx === -1) return [...patterns, { pattern: k, confidence: 0.6, lastSeen: now }];
  const next = [...patterns];
  next[idx] = { ...next[idx], confidence: Math.min(0.95, next[idx].confidence + 0.05), lastSeen: now };
  return next;
}

function upsertGoal(goals: MemorySnapshot["longTermGoals"], name: string): MemorySnapshot["longTermGoals"] {
  const n = name.trim().toLowerCase();
  if (!n) return goals;
  const idx = goals.findIndex(g => g.name === n);
  const now = new Date().toISOString();
  if (idx === -1) return [...goals, { name: n, confidence: 0.55, lastSeen: now }];
  const next = [...goals];
  next[idx] = { ...next[idx], confidence: Math.min(0.97, next[idx].confidence + 0.04), lastSeen: now };
  return next;
}

function upsertMotivationalMedia(media: NonNullable<MemorySnapshot["motivationalMedia"]>, title: string, url: string): NonNullable<MemorySnapshot["motivationalMedia"]> {
  const idx = media.findIndex(m => m.url === url);
  const now = new Date().toISOString();
  if (idx === -1) return [...media, { title: title.toLowerCase(), url, confidence: 0.62, lastSeen: now }];
  const next = [...media];
  next[idx] = { ...next[idx], confidence: Math.min(0.97, next[idx].confidence + 0.08), lastSeen: now };
  return next;
}

function detectMusicCandidate(event: EventIngest): { title: string; url: string } | null {
  if (event.platform !== "youtube") return null;
  const title = (event.content?.youtube?.videoTitle || event.content?.pageTitle || "").trim();
  if (!title) return null;
  const t = title.toLowerCase();
  const looks = ["music", "song", "playlist", "mix", "beats", "motiv", "gym", "phonk", "soundtrack"].some(k => t.includes(k));
  if (!looks) return null;
  return { title: title.slice(0, 120), url: event.url };
}

function defaultRecommendations(event: EventIngest): Recommendation[] {
  const motivator = (memory.snapshot.motivationalMedia || []).sort((a, b) => b.confidence - a.confidence).at(0);
  const tops = memory.snapshot.longTermGoals.slice(0, 2).map(g => ({ title: `Weiter an Ziel: ${g.name}`, url: "https://todoist.com/app" }));
  const defaults: Recommendation[] = motivator ? [{ title: `Motivations-Clip: ${motivator.title}`, url: motivator.url }] : [];
  defaults.push(
    { title: "Top 3 To-Dos öffnen", url: "https://todoist.com/app" },
    { title: "Kurzes AI-Learning starten", url: "https://www.deeplearning.ai/short-courses/" },
    { title: "1 Mini-Build-Schritt notieren", url: "https://github.com/" }
  );
  if (event.platform === "youtube") defaults[1] = { title: "Gezielte Lernsuche auf YouTube", url: "https://www.youtube.com/results?search_query=ai+tutorial" };
  return [...tops, ...defaults].slice(0, 3);
}

function fallbackPopupText(event: EventIngest): string {
  if (event.platform === "youtube" && event.contentMode === "shorts") return "Willst du gerade bewusst YouTube Shorts schauen?";
  if (event.platform === "x" && event.contentMode === "feed") return "Willst du gerade bewusst den X-Feed scrollen?";
  return "Passt diese Nutzung gerade zu deinem eigentlichen Ziel?";
}

function parseJsonDecision(raw: string): LlmDecision | null {
  try {
    return JSON.parse(raw) as LlmDecision;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1)) as LlmDecision;
    } catch {
      return null;
    }
  }
}

function sanitizeRecommendations(recs: Recommendation[] | undefined): Recommendation[] {
  if (!Array.isArray(recs)) return [];
  return recs.filter(r => typeof r?.title === "string" && typeof r?.url === "string" && r.url.startsWith("http")).slice(0, 3);
}

function parseDirectiveResponse(raw: string): ParsedAgentOutput {
  const out: ParsedAgentOutput = { interests: [], patterns: [], recommendations: [], insights: [], rawText: raw };
  const re = /\[\[(\w+):([\s\S]*?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (!value) continue;
    if (key === "risk") {
      const n = Number(value.replace("+", ""));
      if (!Number.isNaN(n)) out.riskDelta = n;
    } else if (key === "popup") out.popupText = value;
    else if (key === "intent") out.intentGuess = value;
    else if (key === "style") out.styleHint = value;
    else if (key === "goal" || key === "interest") out.interests.push(value);
    else if (key === "pattern") out.patterns.push(value);
    else if (key === "insight") out.insights.push(value);
    else if (key === "rec") {
      const [title, url] = value.split("|").map(v => v.trim());
      if (title && url && url.startsWith("http")) out.recommendations.push({ title, url });
    } else if (key === "redirect" && value.startsWith("http")) out.redirectUrl = value;
  }
  const cleaned = raw.replace(re, " ").replace(/\s+/g, " ").trim();
  if (!out.popupText && cleaned) out.popupText = cleaned.slice(0, 220);
  return out;
}

function mergeAgentOutput(raw: string): ParsedAgentOutput {
  const json = parseJsonDecision(raw);
  const free = parseDirectiveResponse(raw);
  return {
    interests: [...(json?.interests || []), ...free.interests],
    patterns: [...(json?.patterns || []), ...free.patterns],
    recommendations: [...sanitizeRecommendations(json?.recommendations), ...free.recommendations].slice(0, 3),
    insights: free.insights,
    rawText: raw,
    riskDelta: free.riskDelta ?? json?.riskDelta,
    popupText: free.popupText ?? json?.popupText,
    intentGuess: free.intentGuess ?? json?.intentGuess,
    styleHint: free.styleHint ?? json?.styleHint,
    redirectUrl: free.redirectUrl
  };
}

function buildAgentPrompt(event: EventIngest): string {
  const systemPrompt = readSystemPrompt();
  const summary = {
    longTermGoals: memory.snapshot.longTermGoals.slice(0, 8),
    midTermPatterns: memory.snapshot.midTermPatterns.slice(0, 12),
    motivationalMedia: (memory.snapshot.motivationalMedia || []).slice(0, 6),
    shortTermEvents: (memory.snapshot.shortTermEvents || []).slice(-12),
    shortTermState: memory.snapshot.shortTermState,
    counters: memory.counters
  };
  return [
    systemPrompt,
    "",
    "Kontext für Entscheidung:",
    `Event: ${JSON.stringify(event)}`,
    `Memory: ${JSON.stringify(summary)}`,
    "",
    "Antwort frei; optional mit Direktiven [[popup:...]] [[risk:+0.10]] [[goal:...]] [[pattern:...]] [[insight:...]] [[rec:Titel|https://...]] [[redirect:https://...]]."
  ].join("\n");
}

function currentModelLabel(): string {
  if (AI_PROVIDER === "local") return LOCAL_LLM_MODEL;
  if (AI_PROVIDER === "api") return OPENAI_MODEL;
  return "none";
}

async function callLocalLlm(prompt: string): Promise<string | null> {
  try {
    const resp = await fetch(LOCAL_LLM_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: LOCAL_LLM_MODEL, prompt, stream: false })
    });
    if (!resp.ok) return null;
    const body = await resp.json() as { response?: string };
    return body.response || null;
  } catch {
    return null;
  }
}

async function callOpenAi(prompt: string): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: "You are the Spark Curiosity app agent." },
          { role: "user", content: prompt }
        ]
      })
    });
    if (!resp.ok) return null;
    const body = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

async function analyzeWithLlm(event: EventIngest): Promise<{ source: "llm" | "fallback"; parsed: ParsedAgentOutput | null; reasonCodes: string[]; prompt?: string; rawOutput?: string }> {
  if (AI_PROVIDER === "none") return { source: "fallback", parsed: null, reasonCodes: ["provider_none"] };

  const gate = shouldCallLlm(event);
  if (!gate.call) return { source: "fallback", parsed: null, reasonCodes: gate.reasonCodes };

  const prompt = buildAgentPrompt(event);
  const raw = AI_PROVIDER === "local" ? await callLocalLlm(prompt) : await callOpenAi(prompt);
  if (!raw) return { source: "fallback", parsed: null, reasonCodes: [...gate.reasonCodes, "llm_unavailable"], prompt };

  lastLlmCallAt = Date.now();
  memory.counters.lastLlmAtByPlatform[event.platform] = new Date().toISOString();
  return { source: "llm", parsed: mergeAgentOutput(raw), reasonCodes: [...gate.reasonCodes, "llm_decision"], prompt, rawOutput: raw };
}

async function eventDecision(event: EventIngest): Promise<EventDecisionResponse> {
  pushShortTermEvent(event);

  const llm = await analyzeWithLlm(event);
  const agent = llm.parsed;
  const musicCandidate = detectMusicCandidate(event);
  const delta = Math.max(-0.2, Math.min(0.4, Number(agent?.riskDelta || 0)));
  let score = Math.max(0, Math.min(1, riskScoreHeuristic(event) + delta));
  if (musicCandidate) score = Math.max(0.2, score - 0.1);

  memory.snapshot.shortTermState.currentRiskScore = score;
  memory.snapshot.shortTermState.lastUpdated = new Date().toISOString();
  if (agent?.intentGuess) memory.snapshot.shortTermState.activeIntent = agent.intentGuess;
  if (agent?.styleHint) memory.snapshot.shortTermState.agentStyleHint = agent.styleHint;

  for (const goal of agent?.interests || []) {
    memory.snapshot.longTermGoals = upsertGoal(memory.snapshot.longTermGoals, goal);
    appendInsight(`Long-term goal aktualisiert: ${goal}`);
  }
  for (const pattern of agent?.patterns || []) {
    memory.snapshot.midTermPatterns = upsertPattern(memory.snapshot.midTermPatterns, pattern);
    appendInsight(`Pattern erkannt: ${pattern}`);
  }
  for (const ins of agent?.insights || []) {
    appendInsight(ins);
  }

  const promptAllowed = canPrompt(event, score) || Boolean(musicCandidate);
  const reasonCodes = [...llm.reasonCodes, ...(musicCandidate ? ["music_candidate"] : []), ...(promptAllowed ? ["prompt_allowed"] : ["prompt_blocked"] )];

  lastDecisionDebug = {
    at: new Date().toISOString(),
    provider: AI_PROVIDER,
    modelUsed: currentModelLabel(),
    platform: event.platform,
    contentMode: event.contentMode,
    score,
    riskDelta: delta,
    decisionSource: llm.source,
    reasonCodes,
    llmResponsePresent: Boolean(agent),
    promptAllowed,
    popupPreview: agent?.popupText || fallbackPopupText(event),
    shortTermCount: (memory.snapshot.shortTermEvents || []).length
  };

  const resultBase: EventDecisionResponse = {
    shouldPrompt: false,
    riskScore: score,
    decisionSource: llm.source,
    reasonCodes,
    modelUsed: currentModelLabel()
  };

  const traceBase: Omit<DecisionTrace, "decision"> = {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    event,
    llm: {
      source: llm.source,
      prompt: llm.prompt,
      rawOutput: llm.rawOutput,
      parsed: agent
    },
    memory: {
      shortTermCount: (memory.snapshot.shortTermEvents || []).length,
      longTermCount: memory.snapshot.longTermGoals.length,
      midTermCount: memory.snapshot.midTermPatterns.length,
      motivationalCount: (memory.snapshot.motivationalMedia || []).length
    }
  };

  if (!promptAllowed) {
    writeMemory(memory);
    appendEventLog(event, lastDecisionDebug);
    addDecisionTrace({
      ...traceBase,
      decision: {
        riskScore: score,
        riskDelta: delta,
        promptAllowed,
        shouldPrompt: false,
        reasonCodes,
        modelUsed: currentModelLabel()
      }
    });
    return resultBase;
  }

  const recommendations = agent?.recommendations?.length ? agent.recommendations : defaultRecommendations(event);
  const intervention: Intervention = {
    id: `intervention-${Date.now()}`,
    kind: "intent_check",
    message: musicCandidate
      ? `Motiviert dich dieser Track/Clip gerade? (${musicCandidate.title.slice(0, 70)})`
      : (agent?.popupText || fallbackPopupText(event)),
    options: ["thumb_up", "thumb_down"],
    recommendations
  };

  const prompt: AdaptiveCheckPrompt = {
    id: `prompt-${++lastPromptId}`,
    text: intervention.message,
    createdAt: new Date().toISOString()
  };

  prompts.set(prompt.id, {
    recommendations,
    platform: event.platform,
    redirectUrl: agent?.redirectUrl,
    musicCandidate: musicCandidate || undefined
  });
  memory.counters.lastPromptAtByPlatform[event.platform] = new Date().toISOString();
  writeMemory(memory);
  appendEventLog(event, lastDecisionDebug);
  addDecisionTrace({
    ...traceBase,
    decision: {
      riskScore: score,
      riskDelta: delta,
      promptAllowed,
      shouldPrompt: true,
      reasonCodes,
      modelUsed: currentModelLabel()
    }
  });

  return {
    ...resultBase,
    shouldPrompt: true,
    prompt,
    intervention
  };
}

function updateMemoryFromFeedback(payload: FeedbackEvent): FeedbackResponse {
  const prompt = prompts.get(payload.promptId);
  if (!prompt) {
    const result: FeedbackResponse = { accepted: true, action: { type: "none" }, memoryChanges: [] };
    addFeedbackTrace({
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      payload,
      result
    });
    return result;
  }

  const changes: string[] = [];
  const platform = prompt.platform;
  if (payload.feedback === "up" && prompt.musicCandidate) {
    memory.snapshot.motivationalMedia = upsertMotivationalMedia(
      memory.snapshot.motivationalMedia || [],
      prompt.musicCandidate.title,
      prompt.musicCandidate.url
    );
    changes.push("motivationalMedia");
    appendMemoryJournal(`Motivational clip bestätigt: \"${prompt.musicCandidate.title}\" (${prompt.musicCandidate.url})`);
    appendInsight(`Motivationsquelle bestätigt: ${prompt.musicCandidate.title}`);
    writeMemory(memory);
    const result: FeedbackResponse = { accepted: true, action: { type: "none" }, memoryChanges: changes };
    addFeedbackTrace({
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      payload,
      result
    });
    return result;
  }

  if (payload.feedback === "down") {
    memory.counters.downByPlatform[platform] = (memory.counters.downByPlatform[platform] || 0) + 1;
    memory.snapshot.midTermPatterns = upsertPattern(memory.snapshot.midTermPatterns, `${platform}:drift-risk`);
    changes.push("downByPlatform", "midTermPatterns");
    appendMemoryJournal(`Drift-Pattern verstärkt: ${platform}:drift-risk`);
    appendInsight(`Schwachstelle verstärkt: ${platform}:drift-risk`);
    writeMemory(memory);
    const result: FeedbackResponse = {
      accepted: true,
      memoryChanges: changes,
      action: {
        type: "redirect",
        url: prompt.redirectUrl || prompt.recommendations[0]?.url || "https://todoist.com/app"
      }
    };
    addFeedbackTrace({
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      payload,
      result
    });
    return result;
  }

  memory.counters.upByPlatform[platform] = (memory.counters.upByPlatform[platform] || 0) + 1;
  changes.push("upByPlatform");
  appendMemoryJournal(`Positive Intent-Bestätigung auf ${platform}`);
  writeMemory(memory);
  const result: FeedbackResponse = { accepted: true, action: { type: "none" }, memoryChanges: changes };
  addFeedbackTrace({
    id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    payload,
    result
  });
  return result;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

function renderDebugUi(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Spark Companion Debug UI</title>
    <style>
      :root {
        --bg: #0f1115;
        --panel: #171a21;
        --text: #e8ebf2;
        --muted: #9ea7bb;
        --accent: #6dd3ff;
        --border: #2a3140;
      }
      body {
        margin: 0;
        background: radial-gradient(circle at 20% 10%, #1c2230, var(--bg));
        color: var(--text);
        font-family: "Segoe UI", "SF Pro Text", sans-serif;
      }
      .wrap {
        max-width: 1100px;
        margin: 24px auto;
        padding: 0 16px 24px;
      }
      h1 {
        margin: 0 0 6px;
        font-size: 24px;
      }
      .sub {
        color: var(--muted);
        margin-bottom: 16px;
      }
      .toolbar {
        display: flex;
        gap: 10px;
        margin-bottom: 16px;
      }
      button {
        border: 1px solid var(--border);
        background: #1f2633;
        color: var(--text);
        border-radius: 8px;
        padding: 8px 12px;
        cursor: pointer;
      }
      button:hover {
        border-color: var(--accent);
      }
      .grid {
        display: grid;
        gap: 12px;
        grid-template-columns: 1fr;
      }
      @media (min-width: 960px) {
        .grid {
          grid-template-columns: 1fr 1fr;
        }
      }
      .panel {
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel) 85%, #0b0e14);
        border-radius: 12px;
        padding: 12px;
      }
      .panel h2 {
        margin: 0 0 8px;
        font-size: 15px;
        color: var(--accent);
      }
      pre {
        margin: 0;
        overflow: auto;
        max-height: 42vh;
        white-space: pre-wrap;
        line-height: 1.35;
        color: var(--text);
      }
      .full {
        grid-column: 1 / -1;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Spark Companion Debug UI</h1>
      <div class="sub">Live view of decision trace, memory snapshot and insight markdown.</div>
      <div class="toolbar">
        <button id="refreshBtn">Refresh now</button>
        <span id="status" class="sub"></span>
      </div>
      <div class="grid">
        <section class="panel">
          <h2>Last Decision</h2>
          <pre id="decisionView">loading...</pre>
        </section>
        <section class="panel">
          <h2>Memory JSON</h2>
          <pre id="memoryView">loading...</pre>
        </section>
        <section class="panel full">
          <h2>Memory Insights (.md)</h2>
          <pre id="insightsView">loading...</pre>
        </section>
        <section class="panel full">
          <h2>Recent Traces (newest first)</h2>
          <pre id="tracesView">loading...</pre>
        </section>
        <section class="panel full">
          <h2>Recent Feedback Traces</h2>
          <pre id="feedbackTracesView">loading...</pre>
        </section>
        <section class="panel">
          <h2>Ingest Stats</h2>
          <pre id="statsView">loading...</pre>
        </section>
        <section class="panel">
          <h2>Extension Client Logs</h2>
          <pre id="clientLogsView">loading...</pre>
        </section>
      </div>
    </div>
    <script>
      const decisionView = document.getElementById("decisionView");
      const memoryView = document.getElementById("memoryView");
      const insightsView = document.getElementById("insightsView");
      const tracesView = document.getElementById("tracesView");
      const feedbackTracesView = document.getElementById("feedbackTracesView");
      const statsView = document.getElementById("statsView");
      const clientLogsView = document.getElementById("clientLogsView");
      const status = document.getElementById("status");
      const refreshBtn = document.getElementById("refreshBtn");

      async function loadJson(path) {
        const res = await fetch(path);
        if (!res.ok) throw new Error(path + " -> " + res.status);
        return res.json();
      }

      async function refreshAll() {
        const started = Date.now();
        status.textContent = "Refreshing...";
        try {
          const [decision, memory, insights, traces, feedbackTraces, stats, clientLogs] = await Promise.all([
            loadJson("/debug/last-decision"),
            loadJson("/memory"),
            loadJson("/memory/insights"),
            loadJson("/debug/traces?limit=20"),
            loadJson("/debug/feedback-traces?limit=20"),
            loadJson("/debug/stats"),
            loadJson("/debug/client-logs?limit=50")
          ]);
          decisionView.textContent = JSON.stringify(decision, null, 2);
          memoryView.textContent = JSON.stringify(memory, null, 2);
          insightsView.textContent = insights.text || "";
          tracesView.textContent = JSON.stringify(traces, null, 2);
          feedbackTracesView.textContent = JSON.stringify(feedbackTraces, null, 2);
          statsView.textContent = JSON.stringify(stats, null, 2);
          clientLogsView.textContent = JSON.stringify(clientLogs, null, 2);
          status.textContent = "Updated " + new Date().toLocaleTimeString() + " (" + (Date.now() - started) + "ms)";
        } catch (err) {
          status.textContent = "Refresh failed: " + String(err);
        }
      }

      refreshBtn.addEventListener("click", refreshAll);
      refreshAll();
      setInterval(refreshAll, 5000);
    </script>
  </body>
</html>`;
}

async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, provider: AI_PROVIDER, model: currentModelLabel(), host: HOST });
  }

  if (req.method === "GET" && url.pathname === "/memory") {
    return json(res, 200, memory.snapshot);
  }

  if (req.method === "GET" && url.pathname === "/memory/insights") {
    try {
      const text = readFileSync(MEMORY_INSIGHTS_PATH, "utf8");
      return json(res, 200, { text });
    } catch {
      return json(res, 200, { text: "# Spark Memory Insights\n\n" });
    }
  }

  if (req.method === "GET" && url.pathname === "/debug/last-decision") {
    return json(res, 200, lastDecisionDebug);
  }

  if (req.method === "GET" && url.pathname === "/debug/traces") {
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 50)));
    return json(res, 200, { traces: decisionTraces.slice(-limit).reverse() });
  }

  if (req.method === "GET" && url.pathname === "/debug/traces/latest") {
    return json(res, 200, { trace: decisionTraces.at(-1) || null });
  }

  if (req.method === "GET" && url.pathname === "/debug/feedback-traces") {
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 50)));
    return json(res, 200, { traces: feedbackTraces.slice(-limit).reverse() });
  }

  if (req.method === "GET" && url.pathname === "/debug/client-logs") {
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));
    return json(res, 200, { logs: clientLogs.slice(-limit).reverse() });
  }

  if (req.method === "GET" && url.pathname === "/debug/stats") {
    return json(res, 200, ingestStats);
  }

  if (req.method === "GET" && url.pathname === "/debug/ui") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderDebugUi());
    return;
  }

  if (req.method === "POST" && url.pathname === "/event") {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", async () => {
      ingestStats.eventsReceived += 1;
      ingestStats.lastEventAt = new Date().toISOString();
      const event = JSON.parse(body) as EventIngest;
      const decision = await eventDecision(event);
      json(res, 200, decision);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/feedback") {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      ingestStats.feedbackReceived += 1;
      ingestStats.lastFeedbackAt = new Date().toISOString();
      const feedback = JSON.parse(body) as FeedbackEvent;
      const result = updateMemoryFromFeedback(feedback);
      json(res, 202, result);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/debug/client-log") {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const log = JSON.parse(body) as ClientLog;
        addClientLog({
          at: log.at || new Date().toISOString(),
          level: log.level || "info",
          message: log.message || "unknown",
          context: log.context
        });
        json(res, 202, { accepted: true });
      } catch {
        json(res, 400, { accepted: false, error: "invalid_log" });
      }
    });
    return;
  }

  json(res, 404, { error: "not_found" });
}

export function createCompanionServer() {
  return createServer((req, res) => {
    void requestHandler(req, res);
  });
}

export function startCompanionServer(port = PORT, host = HOST) {
  const server = createCompanionServer();
  server.listen(port, host, () => {
    console.log(`Spark companion listening on http://${host}:${port} (provider=${AI_PROVIDER})`);
  });
  return server;
}

if (process.env.SPARK_SKIP_AUTOSTART !== "1") {
  startCompanionServer();
}
