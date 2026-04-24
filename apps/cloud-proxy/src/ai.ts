/**
 * AI calling module for cloud-proxy.
 * Uses @spark/shared for JSON parsing and tool-call extraction.
 */

import type { EventIngest, ToolCall, ToolName, MemoryOp, MemorySection } from "./types.js";
import type { Env } from "./types.js";
import type { PlatformContext } from "./d1-platform-context.js";
import { AGENT_SYSTEM_PROMPT, parseLooseJson, parseToolCalls, extractMemoryOps, extractMemoryMarkdown } from "@spark/shared";
import { bumpAfterGrokWithMemory } from "./memory-cleanup-kv.js";

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

export async function runAiDecision(
  event: EventIngest,
  memoryBody: string,
  env: Env,
  otherPlatformContext?: PlatformContext | null,
  token?: string,
): Promise<AiDecisionResult> {
  const system = AGENT_SYSTEM_PROMPT + "\n\n---\n" + (memoryBody || "(Noch kein Memory.)") + "\n---";
  const { localTime, localDate, timeZone } = localTimeContext();
  const thisPlatformLabel = event.thisPlatform === "pc" ? "PC" : event.thisPlatform === "android" ? "Android" : null;
  const promptParts = [
    "Interaktionstyp: EVENT_DECISION", "",
    "Hier ist die Aktion, durch die du aufgerufen wurdest (aktueller Event-Trigger):",
    "Werte diesen Block als den konkreten Live-Anlass fuer deine Entscheidung (nicht mit Memory-Eintraegen verwechseln).",
    "",
    "SCOPE (Zwei-Geraete-Setup):",
    "  Dieser Request kommt von genau EINEM Geraet (siehe 'Geraet' unten).",
    "  close_tab und alle anderen Tools wirken NUR auf dieses Geraet — nicht auf PC und Android gleichzeitig.",
    "  Wenn unten ein Block 'Anderes Geraet' steht, ist das reine Parallel-Information (was die andere Maschine zuletzt gemeldet hat).",
    "  Leite daraus nicht automatisch ab, dass der User auf beiden dasselbe tut; entscheide fuer den aktuellen Event.",
    "",
    "Aktueller Kontext:",
    `  Geraet: ${thisPlatformLabel || "unbekannt"}`,
    `  URL: ${event.url}`,
    `  Plattform: ${event.platform}`,
    `  Modus: ${event.contentMode}`,
    `  Fenster-/App-Titel: ${event.title || "(kein Titel)"}`,
    `  Session-Dauer: ${event.sessionSeconds}s (Nur Dauer; kein Ersatz fuer Inhaltsinfos)`,
    `  Scroll-Zaehler: ${event.scrollCount} (Nebensignal, nicht welcher Post/Video)`,
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
    if (sig.pageContext) {
      const p = sig.pageContext;
      const bits: string[] = [];
      if (p.pathKind) bits.push(`Art=${p.pathKind}`);
      if (p.contentLabel) bits.push(`Inhalt="${p.contentLabel.slice(0, 380)}"`);
      if (p.documentTitle) bits.push(`doc.title="${p.documentTitle.slice(0, 240)}"`);
      if (bits.length) promptParts.push(`  Seitenkontext (Browser): ${bits.join(" — ")}`);
    }
    // Recent DNS hosts bewusst weggelassen — reiner Noise fuer die Entscheidung.
  }
  if (otherPlatformContext) {
    const rawTs = otherPlatformContext.updatedAt.trim();
    const iso = rawTs.includes("T")
      ? (rawTs.endsWith("Z") ? rawTs : `${rawTs}Z`)
      : `${rawTs.replace(" ", "T")}Z`;
    const updatedMs = Date.parse(iso);
    const ageSeconds = Number.isFinite(updatedMs)
      ? Math.max(0, Math.round((Date.now() - updatedMs) / 1000))
      : 0;
    const ageStr = ageSeconds < 120 ? `${ageSeconds}s` : `${Math.round(ageSeconds / 60)}min`;
    const stale = ageSeconds > 600;
    const otherLabel = otherPlatformContext.platform === "pc" ? "PC" : "Android";
    const staleNote = stale ? " — Hinweis: Snapshot koennte veraltet sein; nur als grobes Bild." : "";
    promptParts.push(
      `  Anderes Geraet (${otherLabel}, zuletzt vor ${ageStr}${staleNote}): ${otherPlatformContext.summary}`,
    );
    if (otherPlatformContext.url?.trim()) {
      promptParts.push(`  URL (anderes Geraet, zuletzt): ${otherPlatformContext.url.trim()}`);
    }
  }
  promptParts.push("", "Antworte als JSON mit toolCalls. Nur valides JSON, keine Markdown-Fences.");
  const prompt = promptParts.join("\n");

  const { raw, parsed } = await callGrok(prompt, system, env);
  if (token) await bumpAfterGrokWithMemory(env, token);
  if (!parsed) return { used: false, thought: `agent_error: ${raw.slice(0, 200)}` };

  const toolCalls = parseToolCalls(parsed);
  return {
    used: true,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    thought: typeof parsed.reason === "string" ? parsed.reason : raw.slice(0, 200)
  };
}

export async function runAiChat(
  message: string,
  memoryBody: string,
  env: Env,
  token?: string,
): Promise<{
  reply: string; memoryOps?: MemoryOp[]; openUrl?: string; toolCalls?: ToolCall[];
}> {
  const fallback = "Ich hatte gerade ein AI-Problem. Schreib bitte nochmal.";
  const system = AGENT_SYSTEM_PROMPT + "\n\n---\n" + (memoryBody || "(Noch kein Memory.)") + "\n---";
  const { localTime, localDate, timeZone } = localTimeContext();
  const prompt = [
    "Interaktionstyp: CHAT", "",
    `Lokale Zeit: ${localDate} ${localTime} (${timeZone})`,
    `Nutzer-Nachricht: ${message}`, "",
    "Antworte als JSON: reply (string), optional memoryOps (Array), optional openUrl, optional toolCalls. Nur valides JSON."
  ].join("\n");

  const { parsed } = await callGrok(prompt, system, env);
  if (token) await bumpAfterGrokWithMemory(env, token);
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

export async function runAiMemoryCleanup(
  memoryBody: string,
  env: Env,
): Promise<{ memoryMarkdown?: string; memoryOps?: MemoryOp[] }> {
  const system = AGENT_SYSTEM_PROMPT + "\n\n---\n" + (memoryBody || "(Noch kein Memory.)") + "\n---";
  const { localDate, localTime, timeZone } = localTimeContext();
  const prompt = [
    "Interaktionstyp: MEMORY_CLEANUP",
    "",
    `Heutiges Datum: ${localDate} ${localTime} (${timeZone})`,
    "",
    "Aufgabe: Pruefe und optimiere das Memory. Fuehre folgende Schritte aus:",
    "Kurz: Duplikate jeweils **nur innerhalb Short-Term** bzw. **nur innerhalb Mid-Term** zusammenfuehren (nicht Short- und Mid-Eintraege zu einem Eintrag vermischen).",
    "1. **Short-Term aufraeumen**: Loesche Eintraege die aelter als 2 Tage sind oder nicht mehr relevant.",
    "2. **Duplikate zusammenfuehren**: Wenn mehrere Eintraege in derselben Section dasselbe beschreiben, fuehre sie zu einem zusammen. Kombiniere die Zeitspannen ([fruehestes Datum → heute]) und summiere die Haeufigkeiten (×N).",
    "3. **Mid-Term → Long-Term**: Eintraege mit hoher Haeufigkeit (×5+) oder die ueber mehrere Wochen bestehen, nach Long-Term verschieben.",
    "4. **Veraltetes entfernen**: Eintraege die offensichtlich nicht mehr relevant sind (alte Projektphasen, abgeschlossene Aufgaben).",
    "5. **Haeufig genutzte Seiten**: Aktualisiere den Abschnitt falls noetig, aber loesche keine Seiten.",
    "Preambles (nicht-listiger Text direkt unter ## Long-Term / ## Mid-Term / ## Short-Term) nicht loeschen und nicht leeren.",
    "",
    "Antworte als JSON:",
    "{ \"memoryOps\": [ { \"op\": \"remove\", \"section\": \"...\", \"entry\": \"...\" }, { \"op\": \"add\", \"section\": \"...\", \"entry\": \"...\" }, ... ] }",
    "Wenn nichts zu tun ist: { \"memoryOps\": [] }",
    "WICHTIG: Fuer remove/update muss entry/old EXAKT mit dem bestehenden Eintrag uebereinstimmen.",
    "Keine Markdown-Fences, keine Kommentare."
  ].join("\n");

  const { parsed } = await callGrok(prompt, system, env);
  if (!parsed) return {};

  const memoryMarkdown = extractMemoryMarkdown(parsed);
  const memoryOps = extractMemoryOps(parsed);
  return {
    memoryMarkdown,
    memoryOps: memoryOps.length ? memoryOps : undefined
  };
}
