import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EventIngest, Platform } from "@spark/shared";
import { WINDOWS_APP_ROOT, DATA_DIR } from "./config.js";

export type CuratedGateRule = {
  id?: string;
  host?: string;
  hostSuffix?: string;
  pathPrefix?: string;
  pathRegex?: string;
  urlRegex?: string;
  note?: string;
};

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

const CURATED_GATE_PATH = WINDOWS_APP_ROOT
  ? join(WINDOWS_APP_ROOT, "config", "curated-gate.json")
  : join(DATA_DIR, "curated-gate.json");

let curatedGatePolicy: CuratedGatePolicy = { enabled: false, rules: [] };

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

export function loadCuratedGatePolicy(): CuratedGatePolicy {
  if (!existsSync(CURATED_GATE_PATH)) return { enabled: false, rules: [] };
  try {
    const raw = JSON.parse(readFileSync(CURATED_GATE_PATH, "utf8")) as CuratedGatePolicy;
    const rules = normalizeCuratedGateRules(raw.rules);
    return {
      enabled: Boolean(raw.enabled),
      rules,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
      note: typeof raw.note === "string" ? raw.note : undefined
    };
  } catch {
    return { enabled: false, rules: [] };
  }
}

function saveCuratedGatePolicy(policy: CuratedGatePolicy): void {
  const dir = dirname(CURATED_GATE_PATH);
  mkdirSync(dir, { recursive: true });
  const payload: CuratedGatePolicy = {
    enabled: Boolean(policy.enabled),
    rules: normalizeCuratedGateRules(policy.rules),
    updatedAt: policy.updatedAt || new Date().toISOString(),
    note: policy.note
  };
  writeFileSync(CURATED_GATE_PATH, JSON.stringify(payload, null, 2), "utf8");
  curatedGatePolicy = payload;
}

export function initCuratedGatePolicy(): void {
  curatedGatePolicy = loadCuratedGatePolicy();
}

export function getCuratedGatePolicy(): CuratedGatePolicy {
  return curatedGatePolicy;
}

export function setCuratedGatePolicy(policy: CuratedGatePolicy): CuratedGatePolicy {
  const rules = normalizeCuratedGateRules(policy.rules);
  saveCuratedGatePolicy({
    enabled: Boolean(policy.enabled),
    rules,
    note: policy.note,
    updatedAt: policy.updatedAt || new Date().toISOString()
  });
  return curatedGatePolicy;
}

export function applyCuratedGateUpdate(update: CuratedGateUpdate | null): CuratedGatePolicy {
  if (!update) return curatedGatePolicy;
  const mode = update.mode;
  if (!mode) return curatedGatePolicy;

  if (mode === "disable") {
    saveCuratedGatePolicy({ enabled: false, rules: [], note: update.note, updatedAt: new Date().toISOString() });
    return curatedGatePolicy;
  }

  if (mode === "set") {
    const rules = normalizeCuratedGateRules(update.rules);
    saveCuratedGatePolicy({ enabled: rules.length > 0, rules, note: update.note, updatedAt: new Date().toISOString() });
    return curatedGatePolicy;
  }

  if (mode === "add") {
    const rules = normalizeCuratedGateRules(update.rules);
    if (!rules.length) return curatedGatePolicy;
    const merged = [...curatedGatePolicy.rules, ...rules];
    saveCuratedGatePolicy({ enabled: true, rules: merged, note: update.note || curatedGatePolicy.note, updatedAt: new Date().toISOString() });
    return curatedGatePolicy;
  }

  if (mode === "remove") {
    const ids = Array.isArray(update.ruleIds) ? update.ruleIds.filter(v => typeof v === "string") : [];
    if (!ids.length) return curatedGatePolicy;
    const remaining = curatedGatePolicy.rules.filter(rule => !rule.id || !ids.includes(rule.id));
    saveCuratedGatePolicy({ enabled: remaining.length > 0, rules: remaining, note: update.note || curatedGatePolicy.note, updatedAt: new Date().toISOString() });
    return curatedGatePolicy;
  }

  return curatedGatePolicy;
}

export function curatedGateMatches(url: string): boolean {
  if (!curatedGatePolicy.enabled || !curatedGatePolicy.rules.length) return false;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") return false;
  for (const rule of curatedGatePolicy.rules) {
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

export function curatedGateMatchesByTitle(event: EventIngest): string | null {
  if (!curatedGatePolicy.enabled || !curatedGatePolicy.rules.length) return null;
  if (!event.url?.startsWith("app://")) return null;
  const title = (event.title || "").toLowerCase();
  for (const rule of curatedGatePolicy.rules) {
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
