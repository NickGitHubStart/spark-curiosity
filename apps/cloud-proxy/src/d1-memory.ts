/**
 * D1-backed memory storage.
 * Uses @spark/shared for parsing/serialization/ops.
 */

import type { MemoryOp } from "./types.js";
import {
  DEFAULT_MEMORY_BODY,
  parseMemoryMarkdown,
  serializeMemoryToMarkdown,
  applyMemoryOps,
  buildWelcome,
} from "@spark/shared";

// Re-export for consumers that import from this module
export { applyMemoryOps, buildWelcome };

// ── Read / Write ──

export async function readMemory(db: D1Database, token: string): Promise<{
  body: string; onboardingComplete: boolean; lang: string;
}> {
  const row = await db.prepare(
    "SELECT body, onboarding_complete, lang FROM user_memory WHERE token = ?"
  ).bind(token).first<{ body: string; onboarding_complete: number; lang: string }>();

  if (!row) {
    return { body: DEFAULT_MEMORY_BODY, onboardingComplete: false, lang: "de" };
  }
  return {
    body: row.body || DEFAULT_MEMORY_BODY,
    onboardingComplete: row.onboarding_complete === 1,
    lang: row.lang || "de"
  };
}

export async function writeMemory(db: D1Database, token: string, body: string, onboardingComplete: boolean): Promise<void> {
  // Never downgrade onboarding to false if the row was already complete (client bugs, races, bad JSON).
  const oc = onboardingComplete || (await getOnboardingStatus(db, token));
  await db.prepare(`
    INSERT INTO user_memory (token, body, onboarding_complete, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(token) DO UPDATE SET body = ?, onboarding_complete = ?, updated_at = datetime('now')
  `).bind(token, body, oc ? 1 : 0, body, oc ? 1 : 0).run();
}

export async function ensureUser(db: D1Database, token: string): Promise<void> {
  await db.prepare(`
    INSERT OR IGNORE INTO user_memory (token, body, onboarding_complete, created_at, updated_at)
    VALUES (?, ?, 0, datetime('now'), datetime('now'))
  `).bind(token, DEFAULT_MEMORY_BODY).run();
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

  let memoryBody = tpl.body || DEFAULT_MEMORY_BODY;
  if (customNotes?.trim()) {
    const parsed = parseMemoryMarkdown(memoryBody);
    parsed.longTerm.push({ text: `Nutzer-Anmerkung beim Onboarding: ${customNotes.trim()}`, at: new Date().toISOString(), source: "user" });
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
