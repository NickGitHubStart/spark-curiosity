import { readFileSync } from "node:fs";
import type {
  EventIngest,
  MemoryOp,
  ToolCall,
  ToolName,
  ToolRedirectArgs,
  ToolOpenCuratedGateArgs,
  ToolSetCuratedGateArgs,
  ToolUpdateMemoryArgs,
  ToolSetNextCheckArgs,
  ToolShowQuoteArgs,
  ToolPromptArgs
} from "@spark/shared";
import {
  AI_TIMEOUT_MS,
  GROK_BASE_URL,
  GROK_INPUT_USD_PER_1M,
  GROK_OUTPUT_USD_PER_1M,
  OLLAMA_BASE_URL,
  SYSTEM_PROMPT_PATH,
  currentGrokApiKey,
  currentModel,
  currentProvider
} from "./config.js";
import { extractMemoryMarkdown, extractMemoryOps } from "./memory.js";
import { recordAiUsage, type AiUsageMeta } from "./state.js";

export interface AiDecisionResult {
  used: boolean;
  thought: string;
  reason?: string;
  toolCalls?: ToolCall[];
}

interface AiCallResult {
  raw: string;
  parsed: Record<string, unknown> | null;
  usage?: AiUsageMeta;
}

let forcedAiJsonForTests: string | null = process.env.SPARK_TEST_FORCE_AI_JSON || null;

export function setTestForcedAiJson(json: string | null): void {
  forcedAiJsonForTests = json;
}

function loadSystemPrompt(): string {
  try {
    return readFileSync(SYSTEM_PROMPT_PATH, "utf8");
  } catch {
    return "Du bist Spark, ein freundlicher AI-Begleiter fuer digitale Achtsamkeit. Antworte immer in validem JSON.";
  }
}

export function stripCodeFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z0-9_-]*\s*/u, "");
    t = t.replace(/\s*```$/u, "");
  }
  return t.trim();
}

export function stripLineCommentsOutsideStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaping = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";
    if (escaping) {
      out += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      if (inString) escaping = true;
      continue;
    }
    if (ch === "\"") {
      out += ch;
      inString = !inString;
      continue;
    }
    if (!inString && ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      if (i < text.length) out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

export function extractBalancedJson(text: string): string | null {
  let inString = false;
  let escaping = false;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaping = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * LLMs often return JSON with code fences, trailing comments, or extra text.
 * Pipeline: strip fences → strip // comments (respecting string literals) →
 * try parse → if that fails, extract the first balanced {...} and parse that.
 */
export function parseLooseJson(text: string): Record<string, unknown> | null {
  const normalized = stripLineCommentsOutsideStrings(stripCodeFences(text));
  try { return JSON.parse(normalized) as Record<string, unknown>; } catch { /* continue */ }
  const candidate = extractBalancedJson(normalized);
  if (!candidate) return null;
  try { return JSON.parse(candidate) as Record<string, unknown>; } catch { return null; }
}

type ToolArgsShape =
  | ToolRedirectArgs
  | ToolOpenCuratedGateArgs
  | ToolSetCuratedGateArgs
  | ToolUpdateMemoryArgs
  | ToolSetNextCheckArgs
  | ToolShowQuoteArgs
  | ToolPromptArgs;

const TOOL_NAMES: ToolName[] = [
  "redirect_and_close",
  "open_curated_gate",
  "set_curated_gate",
  "update_memory",
  "set_next_check",
  "show_quote",
  "show_prompt"
];

function parseToolCalls(parsed: Record<string, unknown>): ToolCall[] {
  const raw = parsed.toolCalls;
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const tool = typeof rec.tool === "string" ? rec.tool : "";
    if (!TOOL_NAMES.includes(tool as ToolName)) continue;
    const args = (rec.args && typeof rec.args === "object") ? rec.args as ToolArgsShape : {};
    out.push({ tool: tool as ToolName, args });
  }
  return out;
}

function localTimeContext(): { localTime: string; localDate: string; timeZone: string } {
  const now = new Date();
  return {
    localTime: now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
    localDate: now.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" }),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local"
  };
}

function wrapAiError(error: unknown): AiCallResult {
  if (error instanceof Error && error.name === "TimeoutError") {
    return { raw: `timeout_after_${AI_TIMEOUT_MS}ms`, parsed: null };
  }
  return { raw: `error:${String(error)}`, parsed: null };
}

let ollamaAvailable: boolean | null = null;
let ollamaLastCheck = 0;
const OLLAMA_CHECK_INTERVAL_MS = 30_000;

export async function checkOllamaHealth(): Promise<boolean> {
  const now = Date.now();
  if (ollamaAvailable !== null && now - ollamaLastCheck < OLLAMA_CHECK_INTERVAL_MS) return ollamaAvailable;
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    ollamaAvailable = res.ok;
  } catch {
    ollamaAvailable = false;
  }
  ollamaLastCheck = now;
  if (!ollamaAvailable) console.warn(`[spark] Ollama nicht erreichbar unter ${OLLAMA_BASE_URL}`);
  return ollamaAvailable;
}

async function callOllama(prompt: string, system: string): Promise<AiCallResult> {
  if (!(await checkOllamaHealth())) {
    return { raw: `ollama_unavailable: Ollama laeuft nicht unter ${OLLAMA_BASE_URL}. Starte Ollama und pull ein Modell (ollama pull ${currentModel()}).`, parsed: null };
  }
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: currentModel(), prompt, system, stream: false, options: { temperature: 0.3 } }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!response.ok) return { raw: `http_${response.status}`, parsed: null };
    const payload = await response.json() as { response?: string; prompt_eval_count?: number; eval_count?: number };
    const raw = payload.response || "";
    const promptTokens = typeof payload.prompt_eval_count === "number" ? Math.max(0, payload.prompt_eval_count) : 0;
    const completionTokens = typeof payload.eval_count === "number" ? Math.max(0, payload.eval_count) : 0;
    return {
      raw,
      parsed: parseLooseJson(raw),
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estimatedCostUsd: null }
    };
  } catch (error) {
    ollamaAvailable = null;
    return wrapAiError(error);
  }
}

async function callGrok(prompt: string, system: string): Promise<AiCallResult> {
  const grokApiKey = currentGrokApiKey();
  if (!grokApiKey) {
    return { raw: "grok_missing_api_key: setze SPARK_GROK_API_KEY", parsed: null };
  }
  try {
    const response = await fetch(`${GROK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${grokApiKey}`
      },
      body: JSON.stringify({
        model: currentModel(),
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS)
    });
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      return { raw: `http_${response.status}:${err.slice(0, 300)}`, parsed: null };
    }
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content;
    const raw = Array.isArray(content)
      ? content.map(p => typeof p?.text === "string" ? p.text : "").join("")
      : (typeof content === "string" ? content : "");
    const promptTokens = typeof payload.usage?.prompt_tokens === "number" ? Math.max(0, payload.usage.prompt_tokens) : 0;
    const completionTokens = typeof payload.usage?.completion_tokens === "number" ? Math.max(0, payload.usage.completion_tokens) : 0;
    const totalTokens = typeof payload.usage?.total_tokens === "number"
      ? Math.max(0, payload.usage.total_tokens)
      : (promptTokens + completionTokens);
    const estimatedCostUsd = (GROK_INPUT_USD_PER_1M !== null && GROK_OUTPUT_USD_PER_1M !== null)
      ? ((promptTokens / 1_000_000) * GROK_INPUT_USD_PER_1M + (completionTokens / 1_000_000) * GROK_OUTPUT_USD_PER_1M)
      : null;
    return { raw, parsed: parseLooseJson(raw), usage: { promptTokens, completionTokens, totalTokens, estimatedCostUsd } };
  } catch (error) {
    return wrapAiError(error);
  }
}

async function callAi(prompt: string, system: string): Promise<AiCallResult> {
  if (forcedAiJsonForTests) {
    return { raw: forcedAiJsonForTests, parsed: parseLooseJson(forcedAiJsonForTests) };
  }
  if (currentProvider() === "grok") return callGrok(prompt, system);
  return callOllama(prompt, system);
}

export async function runAiDecision(event: EventIngest, memoryBody: string): Promise<AiDecisionResult> {
  const system = loadSystemPrompt();
  const { localTime, localDate, timeZone } = localTimeContext();
  const promptParts = [
    "Interaktionstyp: EVENT_DECISION",
    "",
    "Dein Memory (Markdown):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
  ];
  promptParts.push(
    "",
    "Aktueller Kontext:",
    `  URL: ${event.url}`,
    `  Plattform: ${event.platform}`,
    `  Modus: ${event.contentMode}`,
    `  Titel: ${event.title || "(kein Titel)"}`,
    `  Session-Dauer: ${event.sessionSeconds}s`,
    `  Scroll-Intensitaet: ${event.scrollCount} Scrolls`,
    `  Lokale Zeit: ${localDate} ${localTime} (${timeZone})`,
  );
  if (event.returnedAfterRedirect) {
    promptParts.push(`  returnedAfterRedirect: true`);
    if (event.redirectedFromUrl) promptParts.push(`  redirectedFromUrl: ${event.redirectedFromUrl}`);
    promptParts.push(`  WICHTIG: Der User ist nach einer Intervention zurueckgekehrt. Entscheide, ob ein erneuter Tool-Call noetig ist.`);
  }
  if (event.lastProductiveUrl) {
    promptParts.push(`  Letzte produktive Seite: ${event.lastProductiveUrl}${event.lastProductiveTitle ? ` ("${event.lastProductiveTitle}")` : ""}`);
  }
  promptParts.push(
    "",
    "Nutze die aktuelle Uhrzeit fuer Entscheidungen mit Tagesrhythmus (z.B. Abend-/Shutdown-Phase).",
    "",
    "Du entscheidest ALLES. Analysiere die URL, den Kontext, das Memory und die Ziele des Users.",
    "Antworte als JSON mit diesem Feld:",
    "  toolCalls: Array von Tool-Calls. Jedes Element: { \"tool\": \"...\", \"args\": { ... } }",
    "Du darfst 0, 1 oder mehrere Tools aufrufen. Wenn nichts passieren soll, gib toolCalls: [].",
    "WICHTIG: Nur valides JSON, keine Markdown-Fences, keine Kommentare."
  );
  const prompt = promptParts.join("\n");

  const { raw, parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed) return { used: false, thought: `agent_error: ${raw.slice(0, 200)}` };

  const toolCalls = parseToolCalls(parsed);
  return {
    used: true,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    thought: typeof parsed.reason === "string" ? parsed.reason : raw.slice(0, 200)
  };
}

export async function runAiChat(message: string, memoryBody: string): Promise<{ reply: string; memoryMarkdown?: string; memoryOps?: MemoryOp[]; openUrl?: string }> {
  const fallbackReply = "Ich hatte gerade ein AI-Problem. Schreib bitte nochmal kurz, ich antworte dann mit aktuellem Kontext.";

  const system = loadSystemPrompt();
  const { localTime, localDate, timeZone } = localTimeContext();
  const prompt = [
    "Interaktionstyp: CHAT",
    "",
    "Dein Memory (Markdown - du kannst es direkt als memoryMarkdown ersetzen):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
    `Lokale Zeit: ${localDate} ${localTime} (${timeZone})`,
    `Nutzer-Nachricht: ${message}`,
    "",
    "Antworte als JSON: reply (string), optional memoryMarkdown (string), optional memoryOps (legacy Array), optional openUrl (string, gueltige URL - dann oeffnet der Browser die Seite in neuem Tab). Nur valides JSON, keine Markdown-Fences."
  ].join("\n");

  const { parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed) return { reply: fallbackReply };

  const memoryMarkdown = extractMemoryMarkdown(parsed);
  const memoryOps = extractMemoryOps(parsed);
  const openUrl = typeof parsed.openUrl === "string" && parsed.openUrl.startsWith("http") ? parsed.openUrl : undefined;

  return {
    reply: typeof parsed.reply === "string" ? parsed.reply : fallbackReply,
    memoryMarkdown,
    memoryOps: memoryOps.length ? memoryOps : undefined,
    openUrl
  };
}

type CuratedItem = { title: string; url: string; summary?: string; thumbnail?: string };

function sanitizeCuratedItems(
  items: Array<{ title?: string; url?: string; summary?: string; description?: string; thumbnail?: string }>,
  limit: number
): CuratedItem[] {
  const out: CuratedItem[] = [];
  for (const item of items) {
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url || !url.startsWith("http")) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const summaryRaw = typeof item.summary === "string"
      ? item.summary.trim()
      : (typeof item.description === "string" ? item.description.trim() : "");
    const summary = summaryRaw ? summaryRaw.slice(0, 480) : undefined;
    const thumbnail = typeof item.thumbnail === "string" ? item.thumbnail.trim() : "";
    out.push({ title: title || url, url, summary, thumbnail: thumbnail || undefined });
    if (out.length >= limit) break;
  }
  return out;
}

export async function runAiCuratedRecommendations(site: string, memoryBody: string, limit: number): Promise<CuratedItem[]> {
  const system = loadSystemPrompt();
  const prompt = [
    "Interaktionstyp: CURATED_RECOMMENDATIONS",
    "",
    "Dein Memory (Markdown):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
    `Ziel-Seite/Domain: ${site || "(unbekannt)"}`,
    `Gib eine kurze Liste (max ${limit}) mit passenden, hochwertigen Inhalten, die den Zielen und Interessen des Users entsprechen.`,
    "Zu jedem Item: eine sehr kurze 1-3 Satz Summary.",
    "Optional: thumbnail URL, falls bekannt (sonst weglassen).",
    "Antworte als JSON: { \"items\": [ { \"title\": \"...\", \"url\": \"https://...\", \"summary\": \"...\", \"thumbnail\": \"https://...\" } ] }",
    "Keine Markdown-Fences, keine Kommentare."
  ].join("\n");
  const { parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return sanitizeCuratedItems(parsed.items as Array<{ title?: string; url?: string }>, limit);
}

export async function runAiCuratedSearch(site: string, query: string, memoryBody: string): Promise<{ title?: string; url?: string } | null> {
  const system = loadSystemPrompt();
  const prompt = [
    "Interaktionstyp: CURATED_SEARCH",
    "",
    "Dein Memory (Markdown):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
    `Ziel-Seite/Domain: ${site || "(unbekannt)"}`,
    `Suchanfrage des Users: ${query}`,
    "Finde die beste passende URL (direkt zum Inhalt).",
    "Antworte als JSON: { \"title\": \"...\", \"url\": \"https://...\" }",
    "Keine Markdown-Fences, keine Kommentare."
  ].join("\n");
  const { parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed) return null;
  const url = typeof parsed.url === "string" ? parsed.url.trim() : "";
  if (!url || !url.startsWith("http")) return null;
  const title = typeof parsed.title === "string" ? parsed.title.trim() : undefined;
  return { title, url };
}

export async function runAiMemoryCompression(memoryBody: string): Promise<{ memoryMarkdown?: string; memoryOps?: MemoryOp[]; thought: string }> {
  const system = loadSystemPrompt();
  const prompt = [
    "Interaktionstyp: MEMORY_COMPRESSION",
    "",
    "Aufgabe:",
    "- Komprimiere Short-Term auf die wichtigsten Punkte.",
    "- Du darfst Items nach Mid-Term oder Long-Term verschieben, wenn es sinnvoll ist.",
    "- Halte die Struktur mit genau diesen Sections: Long-Term, Mid-Term, Short-Term.",
    "- Wenn nichts zu tun ist, gib das Memory unveraendert zurueck.",
    "",
    "Memory (Markdown):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
    "Antworte als JSON: memoryMarkdown (string, kompletter neuer Memory-Markdown) ODER memoryOps (legacy Array).",
    "Keine Markdown-Fences, keine Kommentare."
  ].join("\n");
  const { raw, parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed) return { thought: `memory_compress_error: ${raw.slice(0, 200)}` };

  const memoryMarkdown = extractMemoryMarkdown(parsed);
  const memoryOps = extractMemoryOps(parsed);
  return {
    memoryMarkdown,
    memoryOps: memoryOps.length ? memoryOps : undefined,
    thought: "memory_compressed"
  };
}
