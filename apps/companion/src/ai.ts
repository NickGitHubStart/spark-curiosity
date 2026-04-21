import { readFileSync } from "node:fs";
import type { EventIngest, MemoryOp, ToolCall } from "@spark/shared";
import {
  parseLooseJson,
  parseToolCalls,
  extractMemoryMarkdown,
  extractMemoryOps,
  stripCodeFences,
} from "@spark/shared";
import {
  AI_TIMEOUT_MS,
  BRAIN_COMPRESSION_APPEND_PATH,
  currentGrokBaseUrl,
  GROK_INPUT_USD_PER_1M,
  GROK_OUTPUT_USD_PER_1M,
  SYSTEM_PROMPT_PATH,
  currentGrokApiKey,
  currentModel
} from "./config.js";
import { recordAiUsage, type AiUsageMeta } from "./state.js";

// Re-export for tests that import from ai.ts
export { stripCodeFences, stripLineCommentsOutsideStrings, extractBalancedJson, parseLooseJson } from "@spark/shared";

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

async function callGrok(prompt: string, system: string): Promise<AiCallResult> {
  const grokApiKey = currentGrokApiKey();
  if (!grokApiKey) {
    return { raw: "grok_missing_api_key: setze SPARK_GROK_API_KEY", parsed: null };
  }
  try {
    const response = await fetch(`${currentGrokBaseUrl()}/chat/completions`, {
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
  return callGrok(prompt, system);
}

export async function runAiDecision(event: EventIngest, memoryBody: string): Promise<AiDecisionResult> {
  const baseSystem = loadSystemPrompt();
  // Memory is appended to the system prompt so the agent sees it as one block
  const system = baseSystem + "\n\n---\n" + (memoryBody || "(Noch kein Memory.)") + "\n---";
  const { localTime, localDate, timeZone } = localTimeContext();
  const promptParts = [
    "Interaktionstyp: EVENT_DECISION",
    "",
    "Hier ist die Aktion, durch die du aufgerufen wurdest (aktueller Event-Trigger):",
    "Werte diesen Block als den konkreten Live-Anlass fuer deine Entscheidung (nicht mit Memory-Eintraegen verwechseln).",
    "",
    "Aktueller Kontext:",
    `  URL: ${event.url}`,
    `  Plattform: ${event.platform}`,
    `  Modus: ${event.contentMode}`,
    `  Fenster-/App-Titel: ${event.title || "(kein Titel)"}`,
    `  Session-Dauer: ${event.sessionSeconds}s (Nur Dauer auf dieser Seite; kein Ersatz fuer Inhaltsinfos)`,
    `  Scroll-Zaehler: ${event.scrollCount} (Nebensignal — NICHT als Hauptbeleg welcher Post/Video, nur grobe Aktivitaet)`,
    `  Lokale Zeit: ${localDate} ${localTime} (${timeZone})`,
  ];
  if (event.returnedAfterRedirect) {
    promptParts.push(`  returnedAfterRedirect: true`);
    if (event.redirectedFromUrl) promptParts.push(`  redirectedFromUrl: ${event.redirectedFromUrl}`);
    promptParts.push(`  WICHTIG: Der User ist nach einer Intervention zurueckgekehrt. Entscheide, ob ein erneuter Tool-Call noetig ist.`);
  }
  // Rich structured client signals (media session, usage stats, recent hosts).
  const sig = event.signals;
  if (sig) {
    if (sig.media) {
      const m = sig.media;
      const parts: string[] = [];
      if (m.title) parts.push(`Titel="${m.title}"`);
      if (m.artist) parts.push(`Artist="${m.artist}"`);
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
      if (bits.length) promptParts.push(`  Seitenkontext (Browser-Extension, welcher Post/Video im Tab): ${bits.join(" — ")}`);
    }
    // Recent DNS hosts bewusst weggelassen — reiner Noise fuer die Entscheidung.
  }
  promptParts.push(
    "",
    "Nutze die aktuelle Uhrzeit fuer Entscheidungen mit Tagesrhythmus (z.B. Abend-/Shutdown-Phase).",
    "",
    "Du entscheidest ALLES. Analysiere die URL, den Kontext, das Memory und die Ziele des Users.",
    "Next-Check (Tool set_next_check.seconds): Es gibt keine serverseitige Regel-Engine fuer die Sekunden — du waehlst sie.",
    "Orientierung: kritische/Ablenkungs-Kontexte typischerweise 60–300s; klar produktive Nutzung typischerweise 900–1500s (siehe System-Prompt).",
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

export async function runAiChat(message: string, memoryBody: string): Promise<{ reply: string; memoryMarkdown?: string; memoryOps?: MemoryOp[]; openUrl?: string; toolCalls?: ToolCall[] }> {
  const fallbackReply = "Ich hatte gerade ein AI-Problem. Schreib bitte nochmal kurz, ich antworte dann mit aktuellem Kontext.";

  const baseSystem = loadSystemPrompt();
  const system = baseSystem + "\n\n---\n" + (memoryBody || "(Noch kein Memory.)") + "\n---";
  const { localTime, localDate, timeZone } = localTimeContext();
  const prompt = [
    "Interaktionstyp: CHAT",
    "",
    `Lokale Zeit: ${localDate} ${localTime} (${timeZone})`,
    `Nutzer-Nachricht: ${message}`,
    "",
    "Antworte als JSON: reply (string), optional memoryOps (Array), optional openUrl (string, gueltige URL), optional toolCalls (Array, z.B. set_curated_gate — wenn der User eine Seite temporaer erlauben will). Nur valides JSON, keine Markdown-Fences."
  ].join("\n");

  const { parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed) return { reply: fallbackReply };

  const memoryMarkdown = extractMemoryMarkdown(parsed);
  const memoryOps = extractMemoryOps(parsed);
  const openUrl = typeof parsed.openUrl === "string" && parsed.openUrl.startsWith("http") ? parsed.openUrl : undefined;
  const toolCalls = parseToolCalls(parsed);

  return {
    reply: typeof parsed.reply === "string" ? parsed.reply : fallbackReply,
    memoryMarkdown,
    memoryOps: memoryOps.length ? memoryOps : undefined,
    openUrl,
    toolCalls: toolCalls.length ? toolCalls : undefined
  };
}

export async function runAiMemoryCleanup(memoryBody: string): Promise<{ memoryMarkdown?: string; memoryOps?: MemoryOp[] }> {
  const baseSystem = loadSystemPrompt();
  const system = baseSystem + "\n\n---\n" + (memoryBody || "(Noch kein Memory.)") + "\n---";
  const { localDate, localTime, timeZone } = localTimeContext();
  const prompt = [
    "Interaktionstyp: MEMORY_CLEANUP",
    "",
    `Heutiges Datum: ${localDate} ${localTime} (${timeZone})`,
    "",
    "Aufgabe: Pruefe und optimiere das Memory. Fuehre folgende Schritte aus:",
    "1. **Short-Term aufraeumen**: Loesche Eintraege die aelter als 2 Tage sind oder nicht mehr relevant.",
    "2. **Duplikate zusammenfuehren**: Wenn mehrere Eintraege dasselbe beschreiben, fuehre sie zu einem zusammen. Kombiniere die Zeitspannen ([fruehestes Datum → heute]) und summiere die Haeufigkeiten (×N).",
    "3. **Mid-Term → Long-Term**: Eintraege mit hoher Haeufigkeit (×5+) oder die ueber mehrere Wochen bestehen, nach Long-Term verschieben.",
    "4. **Veraltetes entfernen**: Eintraege die offensichtlich nicht mehr relevant sind (alte Projektphasen, abgeschlossene Aufgaben).",
    "5. **Haeufig genutzte Seiten**: Aktualisiere den Abschnitt falls noetig, aber loesche keine Seiten.",
    "",
    "Antworte als JSON:",
    "{ \"memoryOps\": [ { \"op\": \"remove\", \"section\": \"...\", \"entry\": \"...\" }, { \"op\": \"add\", \"section\": \"...\", \"entry\": \"...\" }, ... ] }",
    "Wenn nichts zu tun ist: { \"memoryOps\": [] }",
    "WICHTIG: Fuer remove/update muss entry/old EXAKT mit dem bestehenden Eintrag uebereinstimmen.",
    "Keine Markdown-Fences, keine Kommentare."
  ].join("\n");

  const { parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed) return {};

  const memoryMarkdown = extractMemoryMarkdown(parsed);
  const memoryOps = extractMemoryOps(parsed);
  return {
    memoryMarkdown,
    memoryOps: memoryOps.length ? memoryOps : undefined
  };
}

export type CuratedItem = { title: string; url: string; summary?: string; thumbnail?: string };

/** Fallback if `prompts/brain-compression-append.md` is missing (must match file content). */
export const BRAIN_COMPRESSION_APPEND_PROMPT = `kannst du das auf die core lessons compressen bitte. alle wichtigen core dinge sollen erhalten bleiben und am besten die orginalformulierung auch irgendwie einbringen wenn diese sehr gut ist. quasi als würde man das lesen aber die compressde version davon. beinhalte alle wichtigen core teile bitte mit ein. stelle sicher, das du die orginal formulierung wenn sie schon absolut top so erklären gleich nutzt und ncihts noch änderst (und sodass man sieht das es orginal ist und was von dir quasi). bleibe auf orignalquellensprache mit compressdem`;

function loadBrainCompressionAppend(): string {
  try {
    const raw = readFileSync(BRAIN_COMPRESSION_APPEND_PATH, "utf8").trim();
    if (raw) return raw;
  } catch {
    /* use fallback */
  }
  return BRAIN_COMPRESSION_APPEND_PROMPT;
}

export interface BrainClassificationResult {
  title: string;
  type: "thought" | "knowledge" | "mental_model" | "principle" | "maxim" | "log" | "limiting_step";
  themenpfad: string;
  parentIndex?: string;
  relatedIndices: string[];
}

export async function runAiBrainCompression(sourceContent: string): Promise<string> {
  const content = (sourceContent || "").trim();
  if (!content) return "";
  const system = "Du bist ein hilfreicher AI-Assistent.";
  const prompt = `${content}\n\n${loadBrainCompressionAppend()}`;
  const { raw } = await callAi(prompt, system);
  return stripCodeFences(raw).trim();
}

export async function runAiBrainClassification(
  content: string,
  existingEntries: Array<{ index: string; title: string }>,
  preferredType?: string
): Promise<BrainClassificationResult> {
  const safeType = typeof preferredType === "string" ? preferredType.trim() : "";
  const system = [
    "Du klassifizierst neue Brain-Eintraege fuer Spark Curiosity.",
    "Wichtig:",
    "- du vergibst KEINE finale Indexnummer",
    "- du waehlst nur title, type, themenpfad, optional parentIndex, optional relatedIndices",
    "- relatedIndices maximal 3 und nur wenn wirklich passend",
    "- antworte nur als valides JSON"
  ].join("\n");
  const existing = existingEntries.slice(0, 300).map(entry => `${entry.index} ${entry.title}`).join("\n") || "(keine bestehenden Eintraege)";
  const prompt = [
    "Neueintrag fuer Brain:",
    "---",
    content.trim(),
    "---",
    "",
    safeType ? `Bevorzugter type vom User: ${safeType}` : "Kein bevorzugter type vorgegeben.",
    "",
    "Bestehende Eintraege:",
    existing,
    "",
    "Waehle:",
    '- title: kurze gute Ueberschrift',
    '- type: thought | knowledge | mental_model | principle | maxim | log | limiting_step',
    '- themenpfad: grosse Nummer als String, z.B. "1"',
    '- parentIndex: optional, wenn der Eintrag klar unter einen bestehenden Eintrag gehoert',
    "- relatedIndices: optional, maximal 3, nur sehr passend",
    "",
    'Antworte exakt als JSON: {"title":"...","type":"...","themenpfad":"...","parentIndex":"...","relatedIndices":["..."]}'
  ].join("\n");
  const { parsed } = await callAi(prompt, system);
  if (!parsed) {
    return {
      title: "Brain Entry",
      type: (safeType as BrainClassificationResult["type"]) || "thought",
      themenpfad: "1",
      relatedIndices: [],
    };
  }
  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Brain Entry";
  const typeRaw = typeof parsed.type === "string" ? parsed.type.trim() : "";
  const type = (["thought", "knowledge", "mental_model", "principle", "maxim", "log", "limiting_step"].includes(typeRaw)
    ? typeRaw
    : (safeType || "thought")) as BrainClassificationResult["type"];
  const themenpfad = typeof parsed.themenpfad === "string" && /^\d+$/.test(parsed.themenpfad.trim())
    ? parsed.themenpfad.trim()
    : "1";
  const parentIndex = typeof parsed.parentIndex === "string" && parsed.parentIndex.trim()
    ? parsed.parentIndex.trim()
    : undefined;
  const relatedIndices = Array.isArray(parsed.relatedIndices)
    ? parsed.relatedIndices.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 3)
    : [];
  return { title, type, themenpfad, parentIndex, relatedIndices };
}

/** Search YouTube by scraping the search results page and extracting ytInitialData. */
async function searchYouTube(query: string, limit: number): Promise<CuratedItem[]> {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const resp = await fetch(searchUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(10_000)
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!match?.[1]) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- YouTube's ytInitialData is deeply nested and untyped
    let data: any;
    try { data = JSON.parse(match[1]); } catch { return []; }
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (!Array.isArray(contents)) return [];

    const out: CuratedItem[] = [];
    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const v = item?.videoRenderer;
        if (!v?.videoId) continue;
        const videoId = String(v.videoId);
        const title = v.title?.runs?.[0]?.text || videoId;
        const thumbs = v.thumbnail?.thumbnails;
        const thumbnail = Array.isArray(thumbs) && thumbs.length ? thumbs[thumbs.length - 1]?.url : undefined;
        // Extract description snippet + channel name + view count for summary
        const descRuns = v.detailedMetadataSnippets?.[0]?.snippetText?.runs;
        const descSnippet = Array.isArray(descRuns) ? descRuns.map((r: { text?: string }) => r.text || "").join("") : "";
        const channel = v.ownerText?.runs?.[0]?.text || "";
        const views = v.viewCountText?.simpleText || "";
        const duration = v.lengthText?.simpleText || "";
        const summaryParts = [channel, views, duration].filter(Boolean).join(" · ");
        const summary = descSnippet ? `${summaryParts ? summaryParts + "\n" : ""}${descSnippet}` : summaryParts || undefined;
        out.push({
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          summary,
          thumbnail: typeof thumbnail === "string" ? thumbnail : undefined
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function runAiCuratedRecommendations(site: string, memoryBody: string, limit: number): Promise<CuratedItem[]> {
  // Ask Grok for search topics based on user interests, then search YouTube for real videos
  const system = loadSystemPrompt();
  const prompt = [
    "Interaktionstyp: CURATED_SEARCH_TOPICS",
    "",
    "Dein Memory (Markdown):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
    `Ziel-Seite/Domain: ${site || "(unbekannt)"}`,
    `Generiere ${limit} YouTube-Suchbegriffe (auf Englisch oder Deutsch, je nach Thema), die zu den Interessen und Zielen des Users passen.`,
    "Jeder Suchbegriff soll spezifisch genug sein, um hochwertige, lehrreiche Videos zu finden.",
    "Mische verschiedene Interessengebiete des Users.",
    `Antworte als JSON: { "queries": ["suchbegriff 1", "suchbegriff 2", ...] }`,
    "Keine Markdown-Fences, keine Kommentare."
  ].join("\n");
  const { parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  const queries: string[] = [];
  if (parsed && Array.isArray(parsed.queries)) {
    for (const q of parsed.queries) {
      if (typeof q === "string" && q.trim()) queries.push(q.trim());
      if (queries.length >= limit) break;
    }
  }
  if (!queries.length) queries.push("best educational videos 2025");

  // Search YouTube for each topic in parallel, take first result per query
  const results = await Promise.allSettled(queries.map(q => searchYouTube(q, 2)));
  const seen = new Set<string>();
  const out: CuratedItem[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      out.push(item);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export async function runAiCuratedSearch(_site: string, query: string, _memoryBody: string, limit = 5): Promise<CuratedItem[]> {
  // Direct YouTube search — no LLM needed for user-typed queries
  return searchYouTube(query, limit);
}

export async function runAiVideoSummary(url: string, title: string, memoryBody: string): Promise<string> {
  const system = loadSystemPrompt();
  const prompt = [
    "Interaktionstyp: VIDEO_SUMMARY",
    "",
    "Dein Memory (Markdown):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
    `Video-URL: ${url}`,
    `Video-Titel: ${title || "(unbekannt)"}`,
    "Fasse dieses Video zusammen. Nutze dein Wissen ueber den Inhalt basierend auf Titel und URL.",
    "Gib eine hilfreiche, praegnante Zusammenfassung (3-8 Saetze).",
    `Antworte als JSON: { "summary": "..." }`,
    "Keine Markdown-Fences, keine Kommentare."
  ].join("\n");
  const { parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed || typeof parsed.summary !== "string") return "";
  return parsed.summary.trim();
}
