/**
 * D1-backed curated gate.
 * Uses @spark/shared for rule normalization and feed-path detection.
 */

import type { CuratedGateRule, Platform } from "./types.js";
import {
  type CuratedGatePolicy,
  type CuratedGateUpdate,
  normalizeCuratedGateRules,
  urlMatchesRules,
  isFeedPath as sharedIsFeedPath,
} from "@spark/shared";

export type { CuratedGateUpdate };

// ── D1 Read / Write ──

export async function readCuratedGate(db: D1Database, token: string): Promise<CuratedGatePolicy> {
  const row = await db.prepare(
    "SELECT enabled, rules, note, updated_at FROM curated_gate WHERE token = ?"
  ).bind(token).first<{ enabled: number; rules: string; note: string | null; updated_at: string }>();

  if (!row) return { enabled: false, rules: [] };

  let rules: CuratedGateRule[] = [];
  try { rules = normalizeCuratedGateRules(JSON.parse(row.rules)); } catch { /* empty */ }

  return {
    enabled: row.enabled === 1,
    rules,
    note: row.note || undefined,
    updatedAt: row.updated_at
  };
}

export async function writeCuratedGate(db: D1Database, token: string, policy: CuratedGatePolicy): Promise<void> {
  const rules = normalizeCuratedGateRules(policy.rules);
  const rulesJson = JSON.stringify(rules);
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO curated_gate (token, enabled, rules, note, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET enabled = ?, rules = ?, note = ?, updated_at = ?
  `).bind(
    token, policy.enabled ? 1 : 0, rulesJson, policy.note || null, now,
    policy.enabled ? 1 : 0, rulesJson, policy.note || null, now
  ).run();
}

// ── Apply updates (set/add/remove/disable) ──

export async function applyCuratedGateUpdate(
  db: D1Database, token: string, update: CuratedGateUpdate | null
): Promise<CuratedGatePolicy> {
  if (!update?.mode) return readCuratedGate(db, token);
  const { mode } = update;
  const current = await readCuratedGate(db, token);

  if (mode === "disable") {
    const policy: CuratedGatePolicy = { enabled: false, rules: [], note: update.note };
    await writeCuratedGate(db, token, policy);
    return policy;
  }

  if (mode === "set") {
    const rules = normalizeCuratedGateRules(update.rules);
    const policy: CuratedGatePolicy = { enabled: rules.length > 0, rules, note: update.note };
    await writeCuratedGate(db, token, policy);
    return policy;
  }

  if (mode === "add") {
    const rules = normalizeCuratedGateRules(update.rules);
    if (!rules.length) return current;
    const merged = [...current.rules, ...rules];
    const policy: CuratedGatePolicy = { enabled: true, rules: merged, note: update.note || current.note };
    await writeCuratedGate(db, token, policy);
    return policy;
  }

  if (mode === "remove") {
    const ids = Array.isArray(update.ruleIds) ? update.ruleIds.filter(v => typeof v === "string") : [];
    if (!ids.length) return current;
    const remaining = current.rules.filter(rule => !rule.id || !ids.includes(rule.id));
    const policy: CuratedGatePolicy = { enabled: remaining.length > 0, rules: remaining, note: update.note || current.note };
    await writeCuratedGate(db, token, policy);
    return policy;
  }

  return current;
}

// ── URL matching (stateless — delegates to @spark/shared) ──

export function curatedGateMatches(policy: CuratedGatePolicy, url: string): boolean {
  if (!policy.enabled || !policy.rules.length) return false;
  return urlMatchesRules(url, policy.rules);
}

export function curatedGateMatchesByTitle(policy: CuratedGatePolicy, title: string, url: string): string | null {
  if (!policy.enabled || !policy.rules.length) return null;
  if (!url?.startsWith("app://")) return null;
  const lowerTitle = (title || "").toLowerCase();
  for (const rule of policy.rules) {
    if (!rule.host) continue;
    const brand = rule.host.replace(/^www\./, "").split(".")[0];
    if (brand && lowerTitle.includes(brand)) return rule.host;
  }
  return null;
}

export { sharedIsFeedPath as isFeedPath };
