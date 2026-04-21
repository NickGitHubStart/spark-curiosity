/**
 * Pure curated-gate rule matching logic.
 * No I/O — works identically on Node.js and Cloudflare Workers.
 */

import type { CuratedGateRule, Platform, EventIngest } from "./index.js";

export type CuratedGatePolicy = {
  enabled: boolean;
  rules: CuratedGateRule[];
  updatedAt?: string;
  note?: string;
};

export type CuratedGateUpdate = {
  mode: "set" | "add" | "remove" | "disable";
  rules?: CuratedGateRule[];
  ruleIds?: string[];
  note?: string;
};

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

export function urlMatchesRules(url: string, rules: CuratedGateRule[]): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return false;
  for (const rule of rules) {
    if (rule.host && parsed.hostname !== rule.host) continue;
    if (rule.hostSuffix) {
      const suffix = rule.hostSuffix.startsWith(".") ? rule.hostSuffix : `.${rule.hostSuffix}`;
      if (!(parsed.hostname === rule.hostSuffix || parsed.hostname.endsWith(suffix))) continue;
    }
    if (rule.pathPrefix && !parsed.pathname.startsWith(rule.pathPrefix)) continue;
    if (rule.pathRegex) {
      try { if (!new RegExp(rule.pathRegex).test(parsed.pathname)) continue; } catch { continue; }
    }
    if (rule.urlRegex) {
      try { if (!new RegExp(rule.urlRegex).test(parsed.href)) continue; } catch { continue; }
    }
    return true;
  }
  return false;
}

export function titleMatchesRules(event: EventIngest, rules: CuratedGateRule[]): string | null {
  if (!event.url?.startsWith("app://")) return null;
  const title = (event.title || "").toLowerCase();
  for (const rule of rules) {
    if (rule.host && title.includes(rule.host.replace("www.", ""))) return rule.host;
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
  } catch {
    return false;
  }
  const p = pathname.toLowerCase();

  if (platform === "youtube" || hostname.includes("youtube.com")) {
    if (p === "/" || p === "") return true;
    if (p.startsWith("/shorts")) return true;
    if (p.startsWith("/feed")) return true;
    return false;
  }

  if (platform === "x" || hostname.includes("x.com") || hostname.includes("twitter.com")) {
    if (p === "/" || p === "") return true;
    if (p.startsWith("/home")) return true;
    if (p.startsWith("/i/trends")) return true;
    if (p.startsWith("/explore")) return true;
    return false;
  }

  if (hostname.includes("tiktok.com")) {
    if (p === "/" || p === "") return true;
    if (p.startsWith("/foryou")) return true;
    if (p.startsWith("/following")) return true;
    const isUserFeed = /^\/@[^/]+\/?$/.test(p);
    if (isUserFeed) return true;
    return false;
  }

  if (hostname.includes("instagram.com")) {
    if (p === "/" || p === "") return true;
    if (p.startsWith("/reels")) return true;
    if (p.startsWith("/explore")) return true;
    return false;
  }

  if (hostname.includes("reddit.com")) {
    if (p === "/" || p === "") return true;
    if (p.startsWith("/r/popular")) return true;
    if (p.startsWith("/r/all")) return true;
    return false;
  }

  if (hostname.includes("facebook.com")) {
    if (p === "/" || p === "") return true;
    if (p.startsWith("/watch")) return true;
    return false;
  }

  return p === "/" || p === "";
}

/** Apply a curated gate update to an existing policy (pure — no I/O). */
export function applyCuratedGateOp(policy: CuratedGatePolicy, update: CuratedGateUpdate): CuratedGatePolicy {
  const { mode } = update;

  if (mode === "disable") {
    return { enabled: false, rules: [], note: update.note, updatedAt: new Date().toISOString() };
  }

  if (mode === "set") {
    const rules = normalizeCuratedGateRules(update.rules);
    return { enabled: rules.length > 0, rules, note: update.note, updatedAt: new Date().toISOString() };
  }

  if (mode === "add") {
    const rules = normalizeCuratedGateRules(update.rules);
    if (!rules.length) return policy;
    const merged = [...policy.rules, ...rules];
    return { enabled: true, rules: merged, note: update.note || policy.note, updatedAt: new Date().toISOString() };
  }

  if (mode === "remove") {
    const ids = Array.isArray(update.ruleIds) ? update.ruleIds.filter(v => typeof v === "string") : [];
    if (!ids.length) return policy;
    const remaining = policy.rules.filter(rule => !rule.id || !ids.includes(rule.id));
    return { enabled: remaining.length > 0, rules: remaining, note: update.note || policy.note, updatedAt: new Date().toISOString() };
  }

  return policy;
}
