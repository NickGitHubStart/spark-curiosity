/**
 * D1-backed curated gate — replaces filesystem curated-gate.ts
 */

import type { CuratedGateRule, CuratedGatePolicy, Platform, Env } from "./types.js";

export type CuratedGateUpdate = {
  mode: "set" | "add" | "remove" | "disable";
  rules?: CuratedGateRule[];
  ruleIds?: string[];
  note?: string;
};

// ── Normalization ──

function normalizeCuratedGateRule(rule: CuratedGateRule): CuratedGateRule | null {
  if (!rule || typeof rule !== "object") return null;
  const cleaned: CuratedGateRule = {
    id: typeof rule.id === "string" && rule.id.trim() ? rule.id.trim() : undefined,
    host: typeof rule.host === "string" && rule.host.trim() ? rule.host.trim().toLowerCase() : undefined,
    hostSuffix: typeof rule.hostSuffix === "string" && rule.hostSuffix.trim() ? rule.hostSuffix.trim().toLowerCase() : undefined,
    pathPrefix: typeof rule.pathPrefix === "string" && rule.pathPrefix.trim() ? rule.pathPrefix.trim() : undefined,
    pathRegex: typeof rule.pathRegex === "string" && rule.pathRegex.trim() ? rule.pathRegex.trim() : undefined,
    urlRegex: typeof rule.urlRegex === "string" && rule.urlRegex.trim() ? rule.urlRegex.trim() : undefined,
    note: typeof rule.note === "string" && rule.note.trim() ? rule.note.trim() : undefined
  };
  const hasMatcher = Boolean(cleaned.host || cleaned.hostSuffix || cleaned.pathPrefix || cleaned.pathRegex || cleaned.urlRegex);
  return hasMatcher ? cleaned : null;
}

export function normalizeCuratedGateRules(rules: CuratedGateRule[] | undefined): CuratedGateRule[] {
  if (!Array.isArray(rules)) return [];
  const normalized: CuratedGateRule[] = [];
  for (const rule of rules) {
    const cleaned = normalizeCuratedGateRule(rule);
    if (cleaned) normalized.push(cleaned);
  }
  return normalized;
}

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
  if (!update) return readCuratedGate(db, token);
  const mode = update.mode;
  if (!mode) return readCuratedGate(db, token);

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

// ── URL matching (stateless — takes policy as argument) ──

export function curatedGateMatches(policy: CuratedGatePolicy, url: string): boolean {
  if (!policy.enabled || !policy.rules.length) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return false;

  for (const rule of policy.rules) {
    let matches = true;
    if (rule.host && parsed.hostname !== rule.host) { matches = false; }
    if (matches && rule.hostSuffix) {
      const suffix = rule.hostSuffix.startsWith(".") ? rule.hostSuffix : `.${rule.hostSuffix}`;
      if (!(parsed.hostname === rule.hostSuffix || parsed.hostname.endsWith(suffix))) matches = false;
    }
    if (matches && rule.pathPrefix && !parsed.pathname.startsWith(rule.pathPrefix)) { matches = false; }
    if (matches && rule.pathRegex) {
      try { if (!new RegExp(rule.pathRegex).test(parsed.pathname)) matches = false; } catch { matches = false; }
    }
    if (matches && rule.urlRegex) {
      try { if (!new RegExp(rule.urlRegex).test(parsed.href)) matches = false; } catch { matches = false; }
    }
    if (matches) return true;
  }
  return false;
}

export function curatedGateMatchesByTitle(policy: CuratedGatePolicy, title: string, url: string): string | null {
  if (!policy.enabled || !policy.rules.length) return null;
  if (!url?.startsWith("app://")) return null;
  const lowerTitle = (title || "").toLowerCase();
  for (const rule of policy.rules) {
    if (rule.host && lowerTitle.includes(rule.host.replace("www.", ""))) return rule.host;
  }
  return null;
}

export function isFeedPath(url: string, platform: Platform): boolean {
  let pathname = "/";
  let hostname = "";
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    hostname = parsed.hostname.toLowerCase();
  } catch { return false; }
  const p = pathname.toLowerCase();

  if (platform === "youtube" || hostname.includes("youtube.com")) {
    return p === "/" || p === "" || p.startsWith("/shorts") || p.startsWith("/feed");
  }
  if (platform === "x" || hostname.includes("x.com") || hostname.includes("twitter.com")) {
    return p === "/" || p === "" || p.startsWith("/home") || p.startsWith("/i/trends") || p.startsWith("/explore");
  }
  if (hostname.includes("tiktok.com")) {
    return p === "/" || p === "" || p.startsWith("/foryou") || p.startsWith("/following") || /^\/@[^/]+\/?$/.test(p);
  }
  if (hostname.includes("instagram.com")) {
    return p === "/" || p === "" || p.startsWith("/reels") || p.startsWith("/explore");
  }
  if (hostname.includes("reddit.com")) {
    return p === "/" || p === "" || p.startsWith("/r/popular") || p.startsWith("/r/all");
  }
  if (hostname.includes("facebook.com")) {
    return p === "/" || p === "" || p.startsWith("/watch");
  }
  return p === "/" || p === "";
}
