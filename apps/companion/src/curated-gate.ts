import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EventIngest, Platform, CuratedGateRule } from "@spark/shared";
import {
  type CuratedGatePolicy,
  type CuratedGateUpdate,
  normalizeCuratedGateRules,
  urlMatchesRules,
  titleMatchesRules,
  isFeedPath,
  applyCuratedGateOp,
} from "@spark/shared";
import { WINDOWS_APP_ROOT, DATA_DIR } from "./config.js";

export type { CuratedGatePolicy, CuratedGateUpdate, CuratedGateRule };
export { normalizeCuratedGateRules };

const CURATED_GATE_PATH = WINDOWS_APP_ROOT
  ? join(WINDOWS_APP_ROOT, "config", "curated-gate.json")
  : join(DATA_DIR, "curated-gate.json");

let curatedGatePolicy: CuratedGatePolicy = { enabled: false, rules: [] };

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
  if (!update?.mode) return curatedGatePolicy;
  const newPolicy = applyCuratedGateOp(curatedGatePolicy, update);
  saveCuratedGatePolicy(newPolicy);
  return curatedGatePolicy;
}

export function curatedGateMatches(url: string): boolean {
  if (!curatedGatePolicy.enabled || !curatedGatePolicy.rules.length) return false;
  return urlMatchesRules(url, curatedGatePolicy.rules);
}

export function curatedGateMatchesByTitle(event: EventIngest): string | null {
  if (!curatedGatePolicy.enabled || !curatedGatePolicy.rules.length) return null;
  return titleMatchesRules(event, curatedGatePolicy.rules);
}

export { isFeedPath };
