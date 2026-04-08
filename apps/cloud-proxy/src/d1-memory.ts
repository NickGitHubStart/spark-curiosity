/**
 * D1-backed memory storage — replaces filesystem-based memory.ts
 */

import type { MemoryOp, MemorySection, Env } from "./types.js";

const DEFAULT_BODY = `## Long-Term
- (leer)

## Mid-Term
- (leer)

## Short-Term
- (leer)`;

interface MemoryEntry { text: string; }
interface ParsedMemory {
  longTerm: MemoryEntry[];
  midTerm: MemoryEntry[];
  shortTerm: MemoryEntry[];
  preambles: { long: string; mid: string; short: string };
}

// ── Read / Write ──

export async function readMemory(db: D1Database, token: string): Promise<{
  body: string; onboardingComplete: boolean; lang: string;
}> {
  const row = await db.prepare(
    "SELECT body, onboarding_complete, lang FROM user_memory WHERE token = ?"
  ).bind(token).first<{ body: string; onboarding_complete: number; lang: string }>();

  if (!row) {
    return { body: DEFAULT_BODY, onboardingComplete: false, lang: "de" };
  }
  return {
    body: row.body || DEFAULT_BODY,
    onboardingComplete: row.onboarding_complete === 1,
    lang: row.lang || "de"
  };
}

export async function writeMemory(db: D1Database, token: string, body: string, onboardingComplete: boolean): Promise<void> {
  await db.prepare(`
    INSERT INTO user_memory (token, body, onboarding_complete, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(token) DO UPDATE SET body = ?, onboarding_complete = ?, updated_at = datetime('now')
  `).bind(token, body, onboardingComplete ? 1 : 0, body, onboardingComplete ? 1 : 0).run();
}

export async function ensureUser(db: D1Database, token: string): Promise<void> {
  await db.prepare(`
    INSERT OR IGNORE INTO user_memory (token, body, onboarding_complete, created_at, updated_at)
    VALUES (?, ?, 0, datetime('now'), datetime('now'))
  `).bind(token, DEFAULT_BODY).run();
}

// ── Onboarding ──

export async function getOnboardingStatus(db: D1Database, token: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT onboarding_complete FROM user_memory WHERE token = ?"
  ).bind(token).first<{ onboarding_complete: number }>();
  return row?.onboarding_complete === 1;
}

export async function applyTemplate(
  db: D1Database, token: string, templateId: string, customNotes?: string
): Promise<{ ok: true; templateId: string } | { ok: false; error: string }> {
  const tpl = await db.prepare(
    "SELECT id, body FROM onboarding_templates WHERE id = ?"
  ).bind(templateId).first<{ id: string; body: string }>();

  if (!tpl) return { ok: false, error: "template_not_found" };

  let memoryBody = tpl.body || DEFAULT_BODY;
  if (customNotes?.trim()) {
    const parsed = parseMemoryMarkdown(memoryBody);
    parsed.longTerm.push({ text: `Nutzer-Anmerkung beim Onboarding: ${customNotes.trim()}` });
    memoryBody = serializeMemoryToMarkdown(parsed, parsed.preambles);
  }
  await writeMemory(db, token, memoryBody, true);
  return { ok: true, templateId: tpl.id };
}

export async function listTemplates(db: D1Database): Promise<Array<{
  id: string; name: string; description: string; highlights: string[]; body: string;
}>> {
  const rows = await db.prepare(
    "SELECT id, name, description, highlights, body FROM onboarding_templates"
  ).all<{ id: string; name: string; description: string; highlights: string; body: string }>();

  return (rows.results || []).map(r => ({
    id: r.id,
    name: r.name,
    description: r.description || "",
    highlights: (r.highlights || "").split(";").map(s => s.trim()).filter(Boolean),
    body: r.body || ""
  }));
}

// ── Welcome message ──

export function buildWelcome(memoryBody: string): string | null {
  const nameMatch = memoryBody.match(/Name:\s*(.+)/i);
  const name = nameMatch ? nameMatch[1].trim() : null;
  const greeting = name ? `Hey ${name}!` : "Hey!";
  return `${greeting} Ich bin Spark, dein Begleiter fuer digitale Achtsamkeit. ` +
    `Ich laufe im Hintergrund und helfe dir, fokussiert zu bleiben. ` +
    `Du kannst jederzeit mit mir reden — sag mir, was ich verbessern soll, ` +
    `stell mir Fragen oder teil mir deine Ziele mit. Los geht's!`;
}

// ── Memory parsing & serialization (ported from companion/memory.ts) ──

export function parseMemoryMarkdown(body: string): ParsedMemory {
  const entry = (text: string): MemoryEntry => ({ text: text.trim() });
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

function ensureTimestamp(entry: string): string {
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
      const idx = entries.findIndex(e => e === op.old!.trim());
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
