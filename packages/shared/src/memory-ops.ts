/**
 * Pure memory markdown parsing, serialization, and ops application.
 * No I/O — works identically on Node.js and Cloudflare Workers.
 */

import type { MemoryOp, MemorySection } from "./index.js";

export const DEFAULT_MEMORY_BODY = `## Long-Term
- (leer)

## Mid-Term
- (leer)

## Short-Term
- (leer)`;

export interface MemoryEntry {
  text: string;
  at: string;
  source: "user" | "system" | "ai";
}

export interface ParsedMemory {
  longTerm: MemoryEntry[];
  midTerm: MemoryEntry[];
  shortTerm: MemoryEntry[];
  preambles: { long: string; mid: string; short: string };
}

export function parseMemoryMarkdown(body: string): ParsedMemory {
  const now = new Date().toISOString();
  const entry = (text: string): MemoryEntry => ({ text: text.trim(), at: now, source: "system" });
  const longTerm: MemoryEntry[] = [];
  const midTerm: MemoryEntry[] = [];
  const shortTerm: MemoryEntry[] = [];
  const preambles = { long: "", mid: "", short: "" };
  let section: "long" | "mid" | "short" | null = null;

  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.startsWith("## Long-Term")) { section = "long"; preambles.long = ""; }
    else if (t.startsWith("## Mid-Term")) { section = "mid"; preambles.mid = ""; }
    else if (t.startsWith("## Short-Term")) { section = "short"; preambles.short = ""; }
    else if (section && t.startsWith("- ") && t.length > 2) {
      const text = t.slice(2).trim();
      if (text && text !== "(leer)") {
        if (section === "long") longTerm.push(entry(text));
        else if (section === "mid") midTerm.push(entry(text));
        else shortTerm.push(entry(text));
      }
    } else if (section && t) {
      if (section === "long") preambles.long += (preambles.long ? "\n" : "") + t;
      else if (section === "mid") preambles.mid += (preambles.mid ? "\n" : "") + t;
      else if (section === "short") preambles.short += (preambles.short ? "\n" : "") + t;
    }
  }
  return { longTerm, midTerm, shortTerm, preambles };
}

export function serializeMemoryToMarkdown(
  m: { longTerm: MemoryEntry[]; midTerm: MemoryEntry[]; shortTerm: MemoryEntry[] },
  preambles?: { long: string; mid: string; short: string }
): string {
  const p = preambles || { long: "", mid: "", short: "" };
  const lines: string[] = [];
  lines.push("## Long-Term");
  if (p.long) lines.push(p.long, "");
  if (m.longTerm.length) m.longTerm.forEach(e => lines.push(`- ${e.text}`));
  else lines.push("- (leer)");
  lines.push("", "## Mid-Term");
  if (p.mid) lines.push(p.mid, "");
  if (m.midTerm.length) m.midTerm.forEach(e => lines.push(`- ${e.text}`));
  else lines.push("- (leer)");
  lines.push("", "## Short-Term");
  if (p.short) lines.push(p.short, "");
  if (m.shortTerm.length) m.shortTerm.forEach(e => lines.push(`- ${e.text}`));
  else lines.push("- (leer)");
  return lines.join("\n");
}

/** Auto-prepend [YYYY-MM-DD] (×1) if entry doesn't already have a timestamp prefix. */
export function ensureTimestamp(entry: string): string {
  if (/^\[\d{4}-\d{2}-\d{2}/.test(entry)) return entry;
  const today = new Date().toISOString().slice(0, 10);
  return `[${today}] (×1) ${entry}`;
}

const VALID_SECTIONS: MemorySection[] = ["Long-Term", "Mid-Term", "Short-Term"];
const SECTION_HEADERS: Record<MemorySection, string> = {
  "Long-Term": "## Long-Term",
  "Mid-Term": "## Mid-Term",
  "Short-Term": "## Short-Term"
};

export function applyMemoryOps(body: string, ops: MemoryOp[]): string {
  const parsed = parseMemoryMarkdown(body);
  const sectionMap: Record<MemorySection, string[]> = {
    "Long-Term": parsed.longTerm.map(e => e.text),
    "Mid-Term": parsed.midTerm.map(e => e.text),
    "Short-Term": parsed.shortTerm.map(e => e.text),
  };

  for (const op of ops) {
    if (!VALID_SECTIONS.includes(op.section)) continue;
    const entries = sectionMap[op.section];

    if (op.op === "add" && op.entry?.trim()) {
      entries.push(ensureTimestamp(op.entry.trim()));
    } else if (op.op === "remove" && op.entry?.trim()) {
      const target = op.entry.trim();
      const idx = entries.findIndex(e => e === target);
      if (idx >= 0) entries.splice(idx, 1);
    } else if (op.op === "update" && op.old?.trim() && op.new?.trim()) {
      const oldText = op.old.trim();
      const idx = entries.findIndex(e => e === oldText);
      if (idx >= 0) entries[idx] = op.new.trim();
    }
  }

  const secToPreamble: Record<MemorySection, string> = {
    "Long-Term": parsed.preambles.long,
    "Mid-Term": parsed.preambles.mid,
    "Short-Term": parsed.preambles.short
  };
  const lines: string[] = [];
  for (const sec of VALID_SECTIONS) {
    lines.push(SECTION_HEADERS[sec]);
    if (secToPreamble[sec]) lines.push(secToPreamble[sec], "");
    const items = sectionMap[sec];
    if (items.length) items.forEach(t => lines.push(`- ${t}`));
    else lines.push("- (leer)");
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function extractMemoryMarkdown(parsed: Record<string, unknown>): string | undefined {
  const raw = parsed.memoryMarkdown;
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  if (!/^##\s+Long-Term/m.test(text) || !/^##\s+Mid-Term/m.test(text) || !/^##\s+Short-Term/m.test(text)) {
    return undefined;
  }
  return text;
}

export function extractMemoryOps(parsed: Record<string, unknown>): MemoryOp[] {
  const raw = parsed.memoryOps;
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.filter((item: unknown): item is MemoryOp => {
    if (!item || typeof item !== "object") return false;
    const o = item as Record<string, unknown>;
    if (typeof o.op !== "string" || typeof o.section !== "string") return false;
    if (!["add", "remove", "update"].includes(o.op)) return false;
    if (!VALID_SECTIONS.includes(o.section as MemorySection)) return false;
    if (o.op === "update") return Boolean(o.old && o.new);
    return Boolean(o.entry);
  });
}

/** Build a welcome message from memory body. */
export function buildWelcome(memoryBody: string): string {
  const nameMatch = memoryBody.match(/Name:\s*(.+)/i);
  const name = nameMatch ? nameMatch[1].trim() : null;
  const greeting = name ? `Hey ${name}!` : "Hey!";
  return `${greeting} Ich bin Spark, dein Begleiter fuer digitale Achtsamkeit. ` +
    `Ich laufe im Hintergrund und helfe dir, fokussiert zu bleiben. ` +
    `Du kannst jederzeit mit mir reden — sag mir, was ich verbessern soll, ` +
    `stell mir Fragen oder teil mir deine Ziele mit. Los geht's!`;
}
