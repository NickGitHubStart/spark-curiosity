/**
 * AI calling module for cloud-proxy.
 * Uses @spark/shared for JSON parsing and tool-call extraction.
 */

import type { EventIngest, ToolCall, ToolName, MemoryOp, MemorySection } from "./types.js";
import type { Env } from "./types.js";
import type { PlatformContext } from "./d1-platform-context.js";
import { parseLooseJson, parseToolCalls, extractMemoryOps } from "@spark/shared";
import { SYSTEM_PROMPT } from "./system-prompt.js";

// Re-export for tests that import from ai.ts
export { stripCodeFences, stripLineCommentsOutsideStrings, extractBalancedJson, parseLooseJson } from "@spark/shared";

const GROK_MODEL = "grok-4-1-fast";
const AI_TIMEOUT_MS = 120_000;
const XAI_BASE = "https://api.x.ai/v1";

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
  // Rich structured client signals (Android: media session, usage stats, recent DNS hosts).
  const sig = event.signals;
  if (sig) {
    if (sig.media) {
      const m = sig.media;
      const parts: string[] = [];
      if (m.title) parts.push(`Titel="${m.title}"`);
      if (m.artist) parts.push(`Artist="${m.artist}"`);
      if (m.album) parts.push(`Album="${m.album}"`);
      if (m.state) parts.push(`state=${m.state}`);
      if (m.positionMs != null && m.durationMs) {
        const pct = Math.round((m.positionMs / m.durationMs) * 100);
        parts.push(`pos=${Math.round(m.positionMs/1000)}s/${Math.round(m.durationMs/1000)}s (${pct}%)`);
      }
      if (m.pkg) parts.push(`pkg=${m.pkg}`);
      if (parts.length) promptParts.push(`  Medien-Session: ${parts.join(", ")}`);
    }
    if (sig.usage) {
      const u = sig.usage;
      const parts: string[] = [];
      if (u.todaySeconds != null) parts.push(`heute=${Math.round(u.todaySeconds/60)}min`);
      if (u.last1hSeconds != null) parts.push(`letzte1h=${Math.round(u.last1hSeconds/60)}min`);
      if (u.launchesToday != null) parts.push(`Starts heute=${u.launchesToday}`);
      if (parts.length) promptParts.push(`  Nutzung dieser App: ${parts.join(", ")}`);
    }
    // Recent DNS hosts bewusst weggelassen — reiner Noise fuer die Entscheidung.
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
