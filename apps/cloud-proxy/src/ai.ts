/**
 * AI calling module — ported from apps/companion/src/ai.ts
 * Uses fetch (Cloudflare Worker compatible, no Node.js deps).
 */

import type { EventIngest, ToolCall, ToolName, MemoryOp, Env } from "./types.js";
import type { PlatformContext } from "./d1-platform-context.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";

const GROK_MODEL = "grok-4-1-fast";
const AI_TIMEOUT_MS = 120_000;
const XAI_BASE = "https://api.x.ai/v1";

const TOOL_NAMES: ToolName[] = [
  "redirect_and_close", "open_curated_gate", "set_curated_gate",
  "update_memory", "set_next_check", "show_quote", "show_prompt"
];

// ── JSON parsing utilities (LLMs return messy JSON) ──

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
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";
    if (escaping) { out += ch; escaping = false; continue; }
    if (ch === "\\") { out += ch; if (inString) escaping = true; continue; }
    if (ch === "\"") { out += ch; inString = !inString; continue; }
    if (!inString && ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      if (i < text.length) out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

export function extractBalancedJson(text: string): string | null {
  let inString = false, escaping = false, depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaping) { escaping = false; continue; }
    if (ch === "\\") { if (inString) escaping = true; continue; }
    if (ch === "\"") { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") { if (depth === 0) start = i; depth++; continue; }
    if (ch === "}" && depth > 0) { depth--; if (depth === 0 && start >= 0) return text.slice(start, i + 1); }
  }
  return null;
}

export function parseLooseJson(text: string): Record<string, unknown> | null {
  const normalized = stripLineCommentsOutsideStrings(stripCodeFences(text));
  try { return JSON.parse(normalized); } catch { /* continue */ }
  const candidate = extractBalancedJson(normalized);
  if (!candidate) return null;
  try { return JSON.parse(candidate); } catch { return null; }
}

function parseToolCalls(parsed: Record<string, unknown>): ToolCall[] {
  const raw = parsed.toolCalls;
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const tool = typeof rec.tool === "string" ? rec.tool : "";
    if (!TOOL_NAMES.includes(tool as ToolName)) continue;
    const args = (rec.args && typeof rec.args === "object") ? rec.args as Record<string, unknown> : {};
    out.push({ tool: tool as ToolName, args });
  }
  return out;
}

function localTimeContext(): { localTime: string; localDate: string; timeZone: string } {
  const now = new Date();
  return {
    localTime: now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }),
    localDate: now.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Berlin" }),
    timeZone: "Europe/Berlin"
  };
}

// ── Core AI call ──

async function callGrok(prompt: string, system: string, env: Env): Promise<{ raw: string; parsed: Record<string, unknown> | null }> {
  if (!env.XAI_API_KEY) {
    return { raw: "grok_missing_api_key", parsed: null };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    const response = await fetch(`${XAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${env.XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      return { raw: `http_${response.status}:${err.slice(0, 300)}`, parsed: null };
    }
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    const raw = Array.isArray(content)
      ? content.map((p: { text?: string }) => typeof p?.text === "string" ? p.text : "").join("")
      : (typeof content === "string" ? content : "");
    return { raw, parsed: parseLooseJson(raw) };
  } catch (error) {
    return { raw: `error:${String(error)}`, parsed: null };
  }
}

// ── Public AI functions ──

export interface AiDecisionResult {
  used: boolean;
  thought: string;
  reason?: string;
  toolCalls?: ToolCall[];
}

export async function runAiDecision(event: EventIngest, memoryBody: string, env: Env, otherPlatformContext?: PlatformContext | null): Promise<AiDecisionResult> {
  const system = SYSTEM_PROMPT + "\n\n---\n" + (memoryBody || "(Noch kein Memory.)") + "\n---";
  const { localTime, localDate, timeZone } = localTimeContext();
  const thisPlatformLabel = event.thisPlatform === "pc" ? "PC" : event.thisPlatform === "android" ? "Android" : null;
  const promptParts = [
    "Interaktionstyp: EVENT_DECISION", "",
    "Aktueller Kontext:",
    `  Geraet: ${thisPlatformLabel || "unbekannt"}`,
    `  URL: ${event.url}`,
    `  Plattform: ${event.platform}`,
    `  Modus: ${event.contentMode}`,
    `  Titel: ${event.title || "(kein Titel)"}`,
    `  Session-Dauer: ${event.sessionSeconds}s`,
    `  Scroll-Intensitaet: ${event.scrollCount} Scrolls`,
    `  Lokale Zeit: ${localDate} ${localTime} (${timeZone})`,
  ];
  if (event.returnedAfterRedirect) {
    promptParts.push(`  returnedAfterRedirect: true`);
    if (event.redirectedFromUrl) promptParts.push(`  redirectedFromUrl: ${event.redirectedFromUrl}`);
    promptParts.push(`  WICHTIG: Der User ist nach einer Intervention zurueckgekehrt.`);
  }
  if (otherPlatformContext) {
    const ageSeconds = Math.round((Date.now() - new Date(otherPlatformContext.updatedAt + "Z").getTime()) / 1000);
    const ageStr = ageSeconds < 120 ? `${ageSeconds}s` : `${Math.round(ageSeconds / 60)}min`;
    const otherLabel = otherPlatformContext.platform === "pc" ? "PC" : "Android";
    promptParts.push(`  Anderes Geraet (${otherLabel}, vor ${ageStr}): ${otherPlatformContext.summary}`);
  }
  promptParts.push("", "Antworte als JSON mit toolCalls. Nur valides JSON, keine Markdown-Fences.");
  const prompt = promptParts.join("\n");

  const { raw, parsed } = await callGrok(prompt, system, env);
  if (!parsed) return { used: false, thought: `agent_error: ${raw.slice(0, 200)}` };

  const toolCalls = parseToolCalls(parsed);
  return {
    used: true,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    thought: typeof parsed.reason === "string" ? parsed.reason : raw.slice(0, 200)
  };
}

export async function runAiChat(message: string, memoryBody: string, env: Env): Promise<{
  reply: string; memoryOps?: MemoryOp[]; openUrl?: string; toolCalls?: ToolCall[];
}> {
  const fallback = "Ich hatte gerade ein AI-Problem. Schreib bitte nochmal.";
  const system = SYSTEM_PROMPT + "\n\n---\n" + (memoryBody || "(Noch kein Memory.)") + "\n---";
  const { localTime, localDate, timeZone } = localTimeContext();
  const prompt = [
    "Interaktionstyp: CHAT", "",
    `Lokale Zeit: ${localDate} ${localTime} (${timeZone})`,
    `Nutzer-Nachricht: ${message}`, "",
    "Antworte als JSON: reply (string), optional memoryOps (Array), optional openUrl, optional toolCalls. Nur valides JSON."
  ].join("\n");

  const { parsed } = await callGrok(prompt, system, env);
  if (!parsed) return { reply: fallback };

  const memoryOps = extractMemoryOps(parsed);
  const openUrl = typeof parsed.openUrl === "string" && parsed.openUrl.startsWith("http") ? parsed.openUrl : undefined;
  const toolCalls = parseToolCalls(parsed);

  return {
    reply: typeof parsed.reply === "string" ? parsed.reply : fallback,
    memoryOps: memoryOps.length ? memoryOps : undefined,
    openUrl,
    toolCalls: toolCalls.length ? toolCalls : undefined
  };
}

// ── Memory ops extraction (from AI response) ──

const VALID_SECTIONS: string[] = ["Long-Term", "Mid-Term", "Short-Term"];

function extractMemoryOps(parsed: Record<string, unknown>): MemoryOp[] {
  const raw = parsed.memoryOps;
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.filter((item: unknown): item is MemoryOp => {
    if (!item || typeof item !== "object") return false;
    const o = item as Record<string, unknown>;
    if (typeof o.op !== "string" || typeof o.section !== "string") return false;
    if (!["add", "remove", "update"].includes(o.op)) return false;
    if (!VALID_SECTIONS.includes(o.section)) return false;
    if (o.op === "update") return Boolean(o.old && o.new);
    return Boolean(o.entry);
  });
}
