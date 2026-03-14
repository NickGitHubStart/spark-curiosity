import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ChatRequest, ChatResponse, EventDecisionResponse, EventIngest,
  InteractionFeedbackEvent, InteractionFeedbackResponse,
  MemoryEntry, MemorySnapshot, Platform, SiteVerdict,
  AgentAction, AgentUiSpec, AgentActionType, AgentUiVariant
} from "@spark/shared";
import {
  enforceBadVerdictAction,
  resolveCachedDecision,
  safeRedirectUrl
} from "./decision-policy.js";

const HOST = process.env.SPARK_COMPANION_HOST || "0.0.0.0";
const PORT = Number(process.env.SPARK_COMPANION_PORT || 4343);
type AiProvider = "ollama" | "grok";

function normalizeProvider(raw: string | undefined): AiProvider {
  const v = (raw || "ollama").toLowerCase();
  return v === "grok" ? "grok" : "ollama";
}

function parseRuntimeEnvFile(path: string): Record<string, string> {
  if (!path || !existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx <= 0) continue;
      const key = t.slice(0, idx).trim();
      const value = t.slice(idx + 1).trim();
      if (key) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function readRuntimeSetting(key: string): string {
  const fromFile = parseRuntimeEnvFile(RUNTIME_CONFIG_PATH)[key];
  if (typeof fromFile === "string" && fromFile.trim()) return fromFile.trim();
  return (process.env[key] || "").trim();
}

function currentProvider(): AiProvider {
  return normalizeProvider(readRuntimeSetting("SPARK_AI_PROVIDER") || process.env.SPARK_AI_PROVIDER);
}

function currentOllamaModel(): string {
  return readRuntimeSetting("SPARK_LOCAL_LLM_MODEL") || "phi3:mini";
}

function currentGrokModel(): string {
  return readRuntimeSetting("SPARK_GROK_MODEL") || "grok-4-1-fast-reasoning";
}

function currentModel(): string {
  return currentProvider() === "grok" ? currentGrokModel() : currentOllamaModel();
}

function currentGrokApiKey(): string {
  return readRuntimeSetting("SPARK_GROK_API_KEY");
}

const OLLAMA_BASE_URL = process.env.SPARK_OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const GROK_BASE_URL = process.env.SPARK_GROK_BASE_URL || "https://api.x.ai/v1";
const WINDOWS_APP_ROOT = process.env.SPARK_WINDOWS_APP_ROOT || "";
const RUNTIME_CONFIG_PATH = process.env.SPARK_RUNTIME_CONFIG_PATH || (WINDOWS_APP_ROOT ? join(WINDOWS_APP_ROOT, "config", "runtime.env") : "");
const UPDATE_MANIFEST_URL = process.env.SPARK_UPDATE_MANIFEST_URL || process.env.SPARK_DIST_MANIFEST_URL || "";
const AI_TIMEOUT_MS = Math.max(10_000, Number(process.env.SPARK_AI_TIMEOUT_MS || process.env.SPARK_OLLAMA_TIMEOUT_MS || 120_000));
const GROK_INPUT_USD_PER_1M = Number.isFinite(Number(process.env.SPARK_GROK_INPUT_USD_PER_1M))
  ? Math.max(0, Number(process.env.SPARK_GROK_INPUT_USD_PER_1M))
  : null;
const GROK_OUTPUT_USD_PER_1M = Number.isFinite(Number(process.env.SPARK_GROK_OUTPUT_USD_PER_1M))
  ? Math.max(0, Number(process.env.SPARK_GROK_OUTPUT_USD_PER_1M))
  : null;
const BUILD_ID = "spark-goals-chat-v3-2026-02-20";
const RUNTIME_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function findCompanionDataDir(): string {
  if (process.env.SPARK_DATA_DIR && existsSync(join(process.env.SPARK_DATA_DIR, "templates"))) {
    return process.env.SPARK_DATA_DIR;
  }
  const fromCwd = join(process.cwd(), "apps", "companion", "data");
  if (existsSync(join(fromCwd, "templates"))) return fromCwd;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const repoRoot = join(__dirname, "..", "..", "..", "..");
    const fromModule = join(repoRoot, "apps", "companion", "data");
    if (existsSync(join(fromModule, "templates"))) return fromModule;
  } catch { /* ignore */ }
  return fromCwd;
}

const DATA_DIR = findCompanionDataDir();
const MEMORY_MD_PATH = join(DATA_DIR, "user-memory.md");
const TEMPLATES_DIR = join(DATA_DIR, "templates");

function findCompanionPromptDir(): string {
  if (process.env.SPARK_PROMPT_DIR && existsSync(process.env.SPARK_PROMPT_DIR)) {
    return process.env.SPARK_PROMPT_DIR;
  }
  const fromCwd = join(process.cwd(), "apps", "companion", "prompts");
  if (existsSync(fromCwd)) return fromCwd;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const repoRoot = join(__dirname, "..", "..", "..", "..");
    const fromModule = join(repoRoot, "apps", "companion", "prompts");
    if (existsSync(fromModule)) return fromModule;
  } catch { /* ignore */ }
  return fromCwd;
}

const PROMPT_DIR = findCompanionPromptDir();
const SYSTEM_PROMPT_PATH = join(PROMPT_DIR, "agent-system-prompt.md");
const DEFAULT_REDIRECT_URL = process.env.SPARK_FALLBACK_REDIRECT_URL || "https://todoist.com/app";
const DISK_PERSISTENCE_ENABLED = false;

interface ClientLog { at: string; level: "info" | "warn" | "error"; message: string; context?: Record<string, unknown> }
interface AiDecisionResult {
  used: boolean;
  action?: AgentAction;
  shouldPrompt?: boolean;
  promptText?: string;
  redirectUrl?: string;
  reason?: string;
  thought: string;
  siteVerdict?: SiteVerdict;
  nextCheckSeconds?: number;
  goalQuestion?: string;
  goalOptions?: string[];
  suggestMedia?: string;
  memoryMarkdown?: string;
  memoryOps?: MemoryOp[];
}

interface SiteVerdictEntry {
  verdict: SiteVerdict;
  nextCheckAt: number;
  thought: string;
  url: string;
  setAt: string;
  redirectUrl?: string;
}

interface AgentThought {
  at: string;
  url: string;
  thought: string;
  verdict: SiteVerdict;
  prompted: boolean;
}

interface AiUsageMeta {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

interface AiCallResult {
  raw: string;
  parsed: Record<string, unknown> | null;
  usage?: AiUsageMeta;
}

const clientLogs: ClientLog[] = [];
const lastDecisions: Array<Record<string, unknown>> = [];
const feedbackLog: Array<Record<string, unknown>> = [];
const chatLog: Array<Record<string, unknown>> = [];
const prompts = new Map<string, {
  platform: Platform;
  url: string;
  text: string;
  actionType: AgentActionType;
  options?: string[];
  redirectUrl?: string;
}>();
const siteVerdicts = new Map<string, SiteVerdictEntry>();
const recentAgentThoughts: AgentThought[] = [];
const MAX_RECENT_THOUGHTS = 4;

type CuratedGateRule = {
  id?: string;
  host?: string;
  hostSuffix?: string;
  pathPrefix?: string;
  pathRegex?: string;
  urlRegex?: string;
  note?: string;
};

type CuratedGatePolicy = {
  enabled: boolean;
  rules: CuratedGateRule[];
  updatedAt?: string;
  note?: string;
};

type CuratedGateUpdate = {
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

function normalizeCuratedGateRules(rules: CuratedGateRule[] | undefined): CuratedGateRule[] {
  if (!Array.isArray(rules)) return [];
  const normalized: CuratedGateRule[] = [];
  for (const rule of rules) {
    const cleaned = normalizeCuratedGateRule(rule);
    if (cleaned) normalized.push(cleaned);
  }
  return normalized;
}

function loadCuratedGatePolicy(): CuratedGatePolicy {
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

function applyCuratedGateUpdate(update: CuratedGateUpdate | null): CuratedGatePolicy {
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

const curatedCache = new Map<string, { items: Array<{ title: string; url: string }>; updatedAt: number }>();

const stats = {
  eventsReceived: 0,
  feedbackReceived: 0,
  chatMessages: 0,
  agentCalls: 0,
  agentSkips: 0,
  lastEventAt: "",
  lastFeedbackAt: "",
  lastChatAt: "",
  aiPromptTokens: 0,
  aiCompletionTokens: 0,
  aiTotalTokens: 0,
  aiEstimatedCostUsd: 0,
  aiCostTrackedCalls: 0,
  aiUnpricedCalls: 0
};
let forcedAiJsonForTests: string | null = process.env.SPARK_TEST_FORCE_AI_JSON || null;

function recordAiUsage(usage?: AiUsageMeta): void {
  if (!usage) return;
  stats.aiPromptTokens += usage.promptTokens;
  stats.aiCompletionTokens += usage.completionTokens;
  stats.aiTotalTokens += usage.totalTokens || (usage.promptTokens + usage.completionTokens);
  if (typeof usage.estimatedCostUsd === "number") {
    stats.aiEstimatedCostUsd += usage.estimatedCostUsd;
    stats.aiCostTrackedCalls += 1;
  } else {
    stats.aiUnpricedCalls += 1;
  }
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

function curatedGateMatches(url: string): boolean {
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

function buildCuratedGateDecision(event: EventIngest): EventDecisionResponse | null {
  if (!event.url || isLocalhostUrl(event.url)) return null;
  if (!curatedGateMatches(event.url)) return null;
  const host = hostnameOf(event.url);
  const redirectUrl = `http://127.0.0.1:4343/curated?from=${encodeURIComponent(event.url)}&site=${encodeURIComponent(host)}`;
  return {
    shouldPrompt: false,
    reason: "curated_gate_redirect",
    action: { type: "redirect", redirectUrl },
    redirectUrl,
    redirectImmediately: true,
    siteVerdict: "bad",
    nextCheckSeconds: 60,
    agentSkipped: true,
    ai: {
      provider: currentProvider(),
      model: currentModel(),
      used: false,
      thought: "curated_gate_policy"
    }
  };
}

const DEFAULT_MEMORY_BODY = `## Long-Term
- (leer)

## Mid-Term
- (leer)

## Short-Term
- (leer)
`;
let runtimeMemoryBody = DEFAULT_MEMORY_BODY;
let runtimeOnboardingComplete = false;

interface MemoryFileResult {
  body: string;
  onboardingComplete: boolean;
  snapshot: MemorySnapshot;
}

function defaultMemory(): MemorySnapshot {
  return {
    totalEvents: 0, totalPrompts: 0, totalFeedback: 0,
    platformCounts: {}, recentEvents: [], notes: [],
    goals: [], motivationalMedia: [],
    shortTerm: [], midTerm: [], longTerm: [],
    userPreferences: {},
  };
}

interface ParsedMemory {
  longTerm: MemoryEntry[];
  midTerm: MemoryEntry[];
  shortTerm: MemoryEntry[];
  preambles: { long: string; mid: string; short: string };
}

function parseMemoryMarkdown(body: string): ParsedMemory {
  const now = new Date().toISOString();
  const entry = (text: string): MemoryEntry => ({ text: text.trim(), at: now, source: "system" });
  const longTerm: MemoryEntry[] = [];
  const midTerm: MemoryEntry[] = [];
  const shortTerm: MemoryEntry[] = [];
  const preambles = { long: "", mid: "", short: "" };
  let section: "long" | "mid" | "short" | null = null;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.startsWith("## Long-Term") || t === "## Long-Term") { section = "long"; preambles.long = ""; }
    else if (t.startsWith("## Mid-Term") || t === "## Mid-Term") { section = "mid"; preambles.mid = ""; }
    else if (t.startsWith("## Short-Term") || t === "## Short-Term") { section = "short"; preambles.short = ""; }
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

function serializeMemoryToMarkdown(
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

function readMemoryFile(): MemoryFileResult {
  const base = defaultMemory();
  const onboardingComplete = runtimeOnboardingComplete;
  const body = runtimeMemoryBody || DEFAULT_MEMORY_BODY;
  const { longTerm, midTerm, shortTerm } = parseMemoryMarkdown(body);
  return {
    body: body || DEFAULT_MEMORY_BODY,
    onboardingComplete,
    snapshot: { ...base, longTerm, midTerm, shortTerm, onboardingComplete },
  };
}

function writeMemoryFile(body: string, onboardingComplete: boolean): void {
  runtimeMemoryBody = body || DEFAULT_MEMORY_BODY;
  runtimeOnboardingComplete = onboardingComplete;
}

function readTemplateFile(filePath: string): { id: string; name: string; description: string; highlights: string[]; body: string } {
  const raw = readFileSync(filePath, "utf8");
  const stem = filePath.replace(/\.md$/i, "").split(/[/\\]/).pop() || "template";
  let body = raw;
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const meta: Record<string, string> = {};
  if (fmMatch) {
    body = fmMatch[2].trim();
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
      if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  const highlightsRaw = meta.highlights || "";
  const highlights = highlightsRaw.split(";").map(s => s.trim()).filter(Boolean);
  return {
    id: meta.id || stem,
    name: meta.name || stem,
    description: meta.description || "",
    highlights,
    body: body || ""
  };
}

function loadMemory(): MemorySnapshot {
  return readMemoryFile().snapshot;
}

function applyOnboardingTemplate(templateId: string, customNotes?: string): { ok: true; templateId: string } | { ok: false; error: string } {
  const templatePath = join(TEMPLATES_DIR, `${templateId}.md`);
  if (!existsSync(templatePath)) return { ok: false, error: "template_not_found" };
  try {
    const t = readTemplateFile(templatePath);
    let memoryBody = t.body;
    if (customNotes?.trim()) {
      const parsed = parseMemoryMarkdown(memoryBody);
      parsed.longTerm.push({
        text: `Nutzer-Anmerkung beim Onboarding: ${customNotes.trim()}`,
        at: new Date().toISOString(),
        source: "user"
      });
      memoryBody = serializeMemoryToMarkdown(parsed, parsed.preambles);
    }
    writeMemoryFile(memoryBody, true);
    return { ok: true, templateId: t.id };
  } catch {
    return { ok: false, error: "template_apply_failed" };
  }
}

function writeRuntimeConfig(config: { provider: "grok"; grokApiKey: string; grokModel: string }): { ok: true } | { ok: false; error: string } {
  if (!RUNTIME_CONFIG_PATH) return { ok: false, error: "runtime_config_path_missing" };
  try {
    const dir = dirname(RUNTIME_CONFIG_PATH);
    mkdirSync(dir, { recursive: true });
    const lines = [
      `SPARK_AI_PROVIDER=${config.provider}`,
      `SPARK_GROK_API_KEY=${config.grokApiKey.trim()}`,
      `SPARK_GROK_MODEL=${config.grokModel.trim() || "grok-4-1-fast-reasoning"}`
    ];
    writeFileSync(RUNTIME_CONFIG_PATH, `${lines.join("\n")}\n`, "utf8");
    return { ok: true };
  } catch {
    return { ok: false, error: "runtime_config_write_failed" };
  }
}

function readInstallMeta(): Record<string, unknown> {
  if (!WINDOWS_APP_ROOT) return {};
  const metaPath = join(WINDOWS_APP_ROOT, "install-meta.json");
  if (!existsSync(metaPath)) return {};
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resolveUpdateManifestUrl(): string {
  if (UPDATE_MANIFEST_URL) return UPDATE_MANIFEST_URL;
  const meta = readInstallMeta();
  const url = typeof meta.manifest_url === "string" ? meta.manifest_url : "";
  return url || "";
}

function readCurrentVersion(): string {
  try {
    const pkgPath = join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(x => parseInt(x, 10));
  const pb = b.split(".").map(x => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

type MemorySection = "Long-Term" | "Mid-Term" | "Short-Term";
interface MemoryOp {
  op: "add" | "remove" | "update";
  section: MemorySection;
  entry?: string;
  old?: string;
  new?: string;
}

const VALID_SECTIONS: MemorySection[] = ["Long-Term", "Mid-Term", "Short-Term"];
const SECTION_HEADERS: Record<MemorySection, string> = {
  "Long-Term": "## Long-Term",
  "Mid-Term": "## Mid-Term",
  "Short-Term": "## Short-Term"
};

function applyMemoryOps(body: string, ops: MemoryOp[]): string {
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
      entries.push(op.entry.trim());
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

  const preambleBySec: Record<MemorySection, string> = {
    "Long-Term": parsed.preambles.long,
    "Mid-Term": parsed.preambles.mid,
    "Short-Term": parsed.preambles.short
  };
  const lines: string[] = [];
  for (const sec of VALID_SECTIONS) {
    lines.push(SECTION_HEADERS[sec]);
    if (preambleBySec[sec]) lines.push(preambleBySec[sec], "");
    const items = sectionMap[sec];
    if (items.length) items.forEach(t => lines.push(`- ${t}`));
    else lines.push("- (leer)");
    lines.push("");
  }
  return lines.join("\n").trim();
}

function extractMemoryMarkdown(parsed: Record<string, unknown>): string | undefined {
  const raw = parsed.memoryMarkdown;
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  if (!text) return undefined;
  // Minimal guard to avoid accidentally replacing memory with non-memory chatter.
  if (!/^##\s+Long-Term/m.test(text) || !/^##\s+Mid-Term/m.test(text) || !/^##\s+Short-Term/m.test(text)) {
    return undefined;
  }
  return text;
}

function resolveNextCheckSeconds(verdict: SiteVerdict | undefined, requested?: number): number {
  const v = verdict || "neutral";
  const defaultByVerdict = v === "good" ? 1800 : v === "bad" ? 60 : 300; // good=30m, bad=60s, neutral=5m
  if (typeof requested !== "number" || !Number.isFinite(requested)) return defaultByVerdict;
  return Math.max(10, Math.floor(requested));
}

function extractMemoryOps(parsed: Record<string, unknown>): MemoryOp[] {
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

function ensureFiles(): void {
  // Disk persistence intentionally disabled: state is runtime-only.
  if (!DISK_PERSISTENCE_ENABLED) return;
}

function loadSystemPrompt(): string {
  try {
    return readFileSync(SYSTEM_PROMPT_PATH, "utf8");
  } catch {
    return "Du bist Spark, ein freundlicher AI-Begleiter für digitale Achtsamkeit. Antworte immer in validem JSON.";
  }
}

function ringPush<T>(arr: T[], item: T, max: number): void {
  arr.push(item);
  if (arr.length > max) arr.shift();
}

curatedGatePolicy = loadCuratedGatePolicy();

// --- LLM ---

function stripCodeFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z0-9_-]*\s*/u, "");
    t = t.replace(/\s*```$/u, "");
  }
  return t.trim();
}

function stripLineCommentsOutsideStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaping = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";
    if (escaping) {
      out += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      if (inString) escaping = true;
      continue;
    }
    if (ch === "\"") {
      out += ch;
      inString = !inString;
      continue;
    }
    if (!inString && ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      if (i < text.length) out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

function extractBalancedJson(text: string): string | null {
  let inString = false;
  let escaping = false;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaping = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseLooseJson(text: string): Record<string, unknown> | null {
  const normalized = stripLineCommentsOutsideStrings(stripCodeFences(text));
  try { return JSON.parse(normalized) as Record<string, unknown>; } catch { /* continue */ }
  const candidate = extractBalancedJson(normalized);
  if (!candidate) return null;
  try { return JSON.parse(candidate) as Record<string, unknown>; } catch { return null; }
}

function parseUiVariant(value: unknown): AgentUiVariant | null {
  if (value === "binary" || value === "multi_choice" || value === "reflect") return value;
  return null;
}

function parseActionType(value: unknown): AgentActionType | null {
  if (value === "none" || value === "popup" || value === "redirect" || value === "popup_then_redirect") return value;
  return null;
}

function parseUiSpec(value: unknown): AgentUiSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const variant = parseUiVariant(raw.variant);
  const message = typeof raw.message === "string" ? raw.message : "";
  if (!variant || !message.trim()) return undefined;
  const options = Array.isArray(raw.options) ? raw.options.filter(v => typeof v === "string") as string[] : undefined;
  return {
    variant,
    title: typeof raw.title === "string" ? raw.title : undefined,
    message: message.trim(),
    options: options?.length ? options.slice(0, 6) : undefined
  };
}

function parseAgentAction(parsed: Record<string, unknown>): AgentAction | undefined {
  const raw = parsed.action;
  if (!raw || typeof raw !== "object") return undefined;
  const action = raw as Record<string, unknown>;
  const type = parseActionType(action.type);
  if (!type) return undefined;
  const ui = parseUiSpec(action.ui);
  return {
    type,
    redirectUrl: typeof action.redirectUrl === "string" ? action.redirectUrl : undefined,
    ui
  };
}

function parseCuratedGateUpdate(parsed: Record<string, unknown>): CuratedGateUpdate | null {
  const raw = parsed.curatedGate;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const mode = typeof obj.mode === "string" ? obj.mode : "";
  if (!["set", "add", "remove", "disable"].includes(mode)) return null;
  const rules = Array.isArray(obj.rules) ? obj.rules as CuratedGateRule[] : undefined;
  const ruleIds = Array.isArray(obj.ruleIds) ? obj.ruleIds.filter(v => typeof v === "string") as string[] : undefined;
  const note = typeof obj.note === "string" ? obj.note : undefined;
  return { mode: mode as CuratedGateUpdate["mode"], rules, ruleIds, note };
}

let ollamaAvailable: boolean | null = null;
let ollamaLastCheck = 0;
const OLLAMA_CHECK_INTERVAL_MS = 30_000;

async function checkOllamaHealth(): Promise<boolean> {
  const now = Date.now();
  if (ollamaAvailable !== null && now - ollamaLastCheck < OLLAMA_CHECK_INTERVAL_MS) return ollamaAvailable;
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    ollamaAvailable = res.ok;
  } catch {
    ollamaAvailable = false;
  }
  ollamaLastCheck = now;
  if (!ollamaAvailable) console.warn(`[spark] Ollama nicht erreichbar unter ${OLLAMA_BASE_URL}`);
  return ollamaAvailable;
}

async function callOllama(prompt: string, system: string): Promise<AiCallResult> {
  if (!(await checkOllamaHealth())) {
    return { raw: `ollama_unavailable: Ollama läuft nicht unter ${OLLAMA_BASE_URL}. Starte Ollama und pull ein Modell (ollama pull ${currentModel()}).`, parsed: null };
  }
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: currentModel(), prompt, system, stream: false, options: { temperature: 0.3 } }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!response.ok) return { raw: `http_${response.status}`, parsed: null };
    const payload = await response.json() as { response?: string; prompt_eval_count?: number; eval_count?: number };
    const raw = payload.response || "";
    const promptTokens = typeof payload.prompt_eval_count === "number" ? Math.max(0, payload.prompt_eval_count) : 0;
    const completionTokens = typeof payload.eval_count === "number" ? Math.max(0, payload.eval_count) : 0;
    return {
      raw,
      parsed: parseLooseJson(raw),
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, estimatedCostUsd: null }
    };
  } catch (error) {
    ollamaAvailable = null;
    if (error instanceof Error && error.name === "TimeoutError") {
      return { raw: `timeout_after_${AI_TIMEOUT_MS}ms`, parsed: null };
    }
    return { raw: `error:${String(error)}`, parsed: null };
  }
}

async function callGrok(prompt: string, system: string): Promise<AiCallResult> {
  const grokApiKey = currentGrokApiKey();
  if (!grokApiKey) {
    return { raw: "grok_missing_api_key: setze SPARK_GROK_API_KEY", parsed: null };
  }
  try {
    const response = await fetch(`${GROK_BASE_URL}/chat/completions`, {
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
    if (error instanceof Error && error.name === "TimeoutError") {
      return { raw: `timeout_after_${AI_TIMEOUT_MS}ms`, parsed: null };
    }
    return { raw: `error:${String(error)}`, parsed: null };
  }
}

async function callAi(prompt: string, system: string): Promise<AiCallResult> {
  if (forcedAiJsonForTests) {
    return { raw: forcedAiJsonForTests, parsed: parseLooseJson(forcedAiJsonForTests) };
  }
  if (currentProvider() === "grok") return callGrok(prompt, system);
  return callOllama(prompt, system);
}

async function runAiDecision(event: EventIngest, memoryBody: string): Promise<AiDecisionResult> {
  const system = loadSystemPrompt();
  const now = new Date();
  const localTime = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const localDate = now.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const promptParts = [
    "Interaktionstyp: EVENT_DECISION",
    "",
    "Dein Memory (Markdown – du kannst es direkt als memoryMarkdown ersetzen):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
    "Curated-Gate-Policy (aktuell; du darfst sie aendern):",
    JSON.stringify(curatedGatePolicy),
    "",
  ];
  promptParts.push(
    "",
    "Aktueller Kontext:",
    `  URL: ${event.url}`,
    `  Plattform: ${event.platform}`,
    `  Modus: ${event.contentMode}`,
    `  Titel: ${event.title || "(kein Titel)"}`,
    `  Session-Dauer: ${event.sessionSeconds}s`,
    `  Scroll-Intensitaet: ${event.scrollCount} Scrolls`,
    `  Lokale Zeit: ${localDate} ${localTime} (${timeZone})`,
  );
  if (event.returnedAfterRedirect) {
    promptParts.push(`  returnedAfterRedirect: true`);
    if (event.redirectedFromUrl) promptParts.push(`  redirectedFromUrl: ${event.redirectedFromUrl}`);
    promptParts.push(`  WICHTIG: Der User ist nach einer Intervention zurueckgekehrt. Zeige jetzt ein Popup mit 2 positiven Optionen (kein Redirect mehr).`);
  }
  if (event.lastProductiveUrl) {
    promptParts.push(`  Letzte produktive Seite: ${event.lastProductiveUrl}${event.lastProductiveTitle ? ` ("${event.lastProductiveTitle}")` : ""}`);
  }
  promptParts.push(
    "",
    "Nutze die aktuelle Uhrzeit fuer Entscheidungen mit Tagesrhythmus (z.B. Abend-/Shutdown-Phase).",
    "",
    "Du entscheidest ALLES. Analysiere die URL, den Kontext, das Memory und die Ziele des Users.",
    "Antworte als JSON mit diesen Feldern:",
    "  action (object) mit:",
    "    type: \"none\" | \"popup\" | \"redirect\" | \"popup_then_redirect\"",
    "    redirectUrl (PFLICHT bei type=redirect oder type=popup_then_redirect, gueltige http/https URL)",
    "    ui (optional object): variant(\"binary\"|\"multi_choice\"|\"reflect\"), title(optional), message(string), options(optional string[])",
    "  shouldPrompt (legacy bool), promptText (legacy string), redirectUrl (legacy string),",
    "  siteVerdict (\"good\" | \"bad\" | \"neutral\"),",
    "  nextCheckSeconds (Zahl; frei von dir waehlbar je nach Kontext, auch kuerzer wenn noetig),",
    "  reason (string), goalQuestion (optional), goalOptions (optional), suggestMedia (optional),",
    "  memoryMarkdown (optional string): kompletter neuer Memory-Markdown (bevorzugt).",
    "  memoryOps (optional legacy Array): nur wenn memoryMarkdown nicht genutzt wird.",
    "  curatedGate (optional object): wenn du Curated-Gate fuer bestimmte URLs aktivieren/deaktivieren willst.",
    "    curatedGate.mode: \"set\" | \"add\" | \"remove\" | \"disable\"",
    "    curatedGate.rules: Array mit Regeln, z.B. { host: \"youtube.com\" } oder { hostSuffix: \".youtube.com\" } oder { urlRegex: \"^https://(www\\.)?youtube\\.com/\" }",
    "    curatedGate.ruleIds: Array von ids fuer remove (optional)",
    "    curatedGate.note: kurze Begruendung (optional)",
    "TOOL-CONTRACT: Redirect ist ein verpflichtender Tool-Call. Wenn type redirect/popup_then_redirect ist, MUSS redirectUrl gesetzt sein.",
    "WICHTIG: Gib NUR valides JSON zurück. Keine Markdown-Codefences (```), keine Kommentare (//), kein zusätzlicher Text."
  );
  const prompt = promptParts.join("\n");

  const { raw, parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed) return { used: false, thought: `agent_error: ${raw.slice(0, 200)}` };

  const curatedUpdate = parseCuratedGateUpdate(parsed);
  if (curatedUpdate) applyCuratedGateUpdate(curatedUpdate);

  const validVerdicts: SiteVerdict[] = ["good", "bad", "neutral"];
  const rawVerdict = typeof parsed.siteVerdict === "string" ? parsed.siteVerdict.toLowerCase() : "";
  const siteVerdict: SiteVerdict | undefined = validVerdicts.includes(rawVerdict as SiteVerdict) ? rawVerdict as SiteVerdict : undefined;

  const nextCheckRequested = typeof parsed.nextCheckSeconds === "number" ? parsed.nextCheckSeconds : undefined;
  const nextCheck = resolveNextCheckSeconds(siteVerdict, nextCheckRequested);
  const action = parseAgentAction(parsed);
  const legacyPrompt = Boolean(parsed.shouldPrompt);
  const legacyPromptText = typeof parsed.promptText === "string" ? parsed.promptText : undefined;
  const legacyRedirect = typeof parsed.redirectUrl === "string" ? parsed.redirectUrl : undefined;

  const fallbackAction: AgentAction | undefined = action || (legacyPrompt
    ? {
      type: "popup",
      redirectUrl: legacyRedirect,
      ui: {
        variant: "binary",
        message: legacyPromptText || "Hey, passt das gerade zu deinen Zielen?",
        options: ["Fokus starten", "Aufgaben öffnen"]
      }
    }
    : (legacyRedirect ? { type: "redirect", redirectUrl: legacyRedirect } : { type: "none" }));

  const memoryMarkdown = extractMemoryMarkdown(parsed);
  const memoryOps = extractMemoryOps(parsed);

  return {
    used: true,
    action: fallbackAction,
    shouldPrompt: legacyPrompt,
    promptText: legacyPromptText,
    redirectUrl: legacyRedirect,
    reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    siteVerdict,
    nextCheckSeconds: nextCheck,
    goalQuestion: typeof parsed.goalQuestion === "string" ? parsed.goalQuestion : undefined,
    goalOptions: Array.isArray(parsed.goalOptions) ? parsed.goalOptions as string[] : undefined,
    suggestMedia: typeof parsed.suggestMedia === "string" ? parsed.suggestMedia : undefined,
    memoryMarkdown,
    memoryOps: memoryOps.length ? memoryOps : undefined,
    thought: typeof parsed.reason === "string" ? parsed.reason : raw.slice(0, 200)
  };
}

async function runAiChat(message: string, memoryBody: string): Promise<{ reply: string; memoryMarkdown?: string; memoryOps?: MemoryOp[]; openUrl?: string }> {
  const fallbackReply = "Ich hatte gerade ein AI-Problem. Schreib bitte nochmal kurz, ich antworte dann mit aktuellem Kontext.";

  const system = loadSystemPrompt();
  const now = new Date();
  const localTime = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const localDate = now.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "2-digit", day: "2-digit" });
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const prompt = [
    "Interaktionstyp: CHAT",
    "",
    "Dein Memory (Markdown – du kannst es direkt als memoryMarkdown ersetzen):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
    "Curated-Gate-Policy (aktuell; du darfst sie aendern):",
    JSON.stringify(curatedGatePolicy),
    "",
    `Lokale Zeit: ${localDate} ${localTime} (${timeZone})`,
    `Nutzer-Nachricht: ${message}`,
    "",
    "Antworte als JSON: reply (string), optional memoryMarkdown (string), optional memoryOps (legacy Array), optional openUrl (string, gueltige URL – dann oeffnet der Browser die Seite in neuem Tab), optional curatedGate (object: mode set|add|remove|disable, rules[], ruleIds[], note). Nur valides JSON, keine Markdown-Fences."
  ].join("\n");

  const { parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed) return { reply: fallbackReply };

  const curatedUpdate = parseCuratedGateUpdate(parsed);
  if (curatedUpdate) applyCuratedGateUpdate(curatedUpdate);

  const memoryMarkdown = extractMemoryMarkdown(parsed);
  const memoryOps = extractMemoryOps(parsed);
  const openUrl = typeof parsed.openUrl === "string" && parsed.openUrl.startsWith("http") ? parsed.openUrl : undefined;

  return {
    reply: typeof parsed.reply === "string" ? parsed.reply : fallbackReply,
    memoryMarkdown,
    memoryOps: memoryOps.length ? memoryOps : undefined,
    openUrl
  };
}

function sanitizeCuratedItems(items: Array<{ title?: string; url?: string }>, limit: number): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  for (const item of items) {
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url || !url.startsWith("http")) continue;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    out.push({ title: title || url, url });
    if (out.length >= limit) break;
  }
  return out;
}

async function runAiCuratedRecommendations(site: string, memoryBody: string, limit: number): Promise<Array<{ title: string; url: string }>> {
  const system = loadSystemPrompt();
  const prompt = [
    "Interaktionstyp: CURATED_RECOMMENDATIONS",
    "",
    "Dein Memory (Markdown):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
    `Ziel-Seite/Domain: ${site || "(unbekannt)"}`,
    `Gib eine kurze Liste (max ${limit}) mit passenden, hochwertigen Inhalten, die den Zielen und Interessen des Users entsprechen.`,
    "Antworte als JSON: { \"items\": [ { \"title\": \"...\", \"url\": \"https://...\" } ] }",
    "Keine Markdown-Fences, keine Kommentare."
  ].join("\n");
  const { parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed || !Array.isArray((parsed as any).items)) return [];
  return sanitizeCuratedItems((parsed as any).items as Array<{ title?: string; url?: string }>, limit);
}

async function runAiCuratedSearch(site: string, query: string, memoryBody: string): Promise<{ title?: string; url?: string } | null> {
  const system = loadSystemPrompt();
  const prompt = [
    "Interaktionstyp: CURATED_SEARCH",
    "",
    "Dein Memory (Markdown):",
    "---",
    memoryBody || "(Noch kein Memory.)",
    "---",
    "",
    `Ziel-Seite/Domain: ${site || "(unbekannt)"}`,
    `Suchanfrage des Users: ${query}`,
    "Finde die beste passende URL (direkt zum Inhalt).",
    "Antworte als JSON: { \"title\": \"...\", \"url\": \"https://...\" }",
    "Keine Markdown-Fences, keine Kommentare."
  ].join("\n");
  const { parsed, usage } = await callAi(prompt, system);
  recordAiUsage(usage);
  if (!parsed) return null;
  const url = typeof (parsed as any).url === "string" ? (parsed as any).url.trim() : "";
  if (!url || !url.startsWith("http")) return null;
  const title = typeof (parsed as any).title === "string" ? (parsed as any).title.trim() : undefined;
  return { title, url };
}

// --- Decision Logic (Agent-first) ---

function recordAgentResult(event: EventIngest, ai: AiDecisionResult): void {
  const host = hostnameOf(event.url);
  const verdict: SiteVerdict = ai.siteVerdict || "neutral";
  const checkSec = resolveNextCheckSeconds(verdict, ai.nextCheckSeconds);
  const now = Date.now();
  const resolvedRedirect = safeRedirectUrl(ai.action?.redirectUrl) || safeRedirectUrl(ai.redirectUrl);

  siteVerdicts.set(host, {
    verdict,
    nextCheckAt: now + checkSec * 1000,
    thought: ai.thought.slice(0, 150),
    url: event.url,
    setAt: new Date().toISOString(),
    redirectUrl: resolvedRedirect
  });

  ringPush(recentAgentThoughts, {
    at: new Date().toISOString(),
    url: event.url,
    thought: ai.thought,
    verdict,
    prompted: ai.action?.type === "popup" || ai.action?.type === "popup_then_redirect" || Boolean(ai.shouldPrompt),
  }, MAX_RECENT_THOUGHTS);
}

function isSocialMediaFeed(eventUrl: string, contentMode: string): boolean {
  const host = hostnameOf(eventUrl);
  const feedHosts = ["youtube.com", "www.youtube.com", "m.youtube.com", "x.com", "www.x.com", "twitter.com", "www.twitter.com", "tiktok.com", "www.tiktok.com"];
  if (!feedHosts.some(h => host === h || host.endsWith(`.${h}`))) return false;
  if (contentMode === "feed" || contentMode === "shorts") return true;
  try {
    const u = new URL(eventUrl);
    const p = u.pathname;
    if (host.includes("youtube.com") && (p === "/" || p.startsWith("/shorts") || p.startsWith("/feed"))) return true;
    if ((host === "x.com" || host.includes("twitter.com")) && (p === "/" || p.startsWith("/home") || p.startsWith("/i/trends"))) return true;
    if (host.includes("tiktok.com") && (p === "/" || p.startsWith("/foryou") || p.startsWith("/@"))) return true;
  } catch { /* ignore */ }
  return false;
}

async function decide(event: EventIngest): Promise<EventDecisionResponse> {
  const host = hostnameOf(event.url);
  const curatedDecision = buildCuratedGateDecision(event);
  if (curatedDecision) return curatedDecision;
  const cached = siteVerdicts.get(host);
  const now = Date.now();

  if (isSocialMediaFeed(event.url, event.contentMode || "other") && !event.returnedAfterRedirect) {
    const curatedActive = curatedGatePolicy.enabled && curatedGatePolicy.rules.length > 0;
    const redirectTarget = curatedActive
      ? `http://127.0.0.1:${PORT}/curated?from=${encodeURIComponent(event.url)}&site=${encodeURIComponent(host)}`
      : (cached?.redirectUrl || DEFAULT_REDIRECT_URL);
    const reason = `instant_social_feed_guard: ${host} feed/shorts detected`;
    siteVerdicts.set(host, {
      verdict: "bad",
      nextCheckAt: now + 60_000,
      thought: reason,
      url: event.url,
      setAt: new Date().toISOString(),
      redirectUrl: redirectTarget
    });
    ringPush(lastDecisions, { at: new Date().toISOString(), event, response: { action: { type: "redirect", redirectUrl: redirectTarget }, siteVerdict: "bad", redirectImmediately: true, reason }, aiUsed: false, agentThinking: reason }, 500);
    return {
      shouldPrompt: false,
      action: { type: "redirect", redirectUrl: redirectTarget },
      redirectUrl: redirectTarget,
      redirectImmediately: true,
      siteVerdict: "bad",
      nextCheckSeconds: 60,
      reason,
      ai: { provider: currentProvider(), model: currentModel(), used: false, thought: reason }
    };
  }

  const cachedDecision = resolveCachedDecision({
    cached,
    nowMs: now,
    returnedAfterRedirect: event.returnedAfterRedirect,
    runtime: { provider: currentProvider(), model: currentModel() }
  });
  if (cachedDecision) {
    return cachedDecision;
  }

  const { body: memoryBody, onboardingComplete } = readMemoryFile();

  stats.agentCalls += 1;
  const ai = await runAiDecision(event, memoryBody);
  if (ai.memoryMarkdown) {
    writeMemoryFile(ai.memoryMarkdown, onboardingComplete);
  } else if (ai.memoryOps?.length) {
    const newBody = applyMemoryOps(memoryBody, ai.memoryOps);
    writeMemoryFile(newBody, onboardingComplete);
  }

  if (ai.used) recordAgentResult(event, ai);

  let response: EventDecisionResponse;

  if (ai.used) {
    const baseAction = ai.action || { type: "none" as const };
    const verdict = ai.siteVerdict || "neutral";
    const action = enforceBadVerdictAction({
      verdict,
      baseAction,
      aiRedirectUrl: ai.redirectUrl,
      cachedRedirectUrl: cached?.redirectUrl
    });
    const actionIsPopup = action.type === "popup" || action.type === "popup_then_redirect";
    const actionNeedsImmediateRedirect = action.type === "redirect";
    const promptId = actionIsPopup ? `p-${Date.now()}` : undefined;
    const popupText = action.ui?.message || ai.promptText || "Hey, passt das gerade zu deinen Zielen?";

    if (promptId) {
      prompts.set(promptId, {
        platform: event.platform,
        url: event.url,
        text: popupText,
        actionType: action.type,
        options: action.ui?.options,
        redirectUrl: action.redirectUrl || ai.redirectUrl
      });
    }

    response = {
      shouldPrompt: actionIsPopup,
      promptId,
      promptText: actionIsPopup ? popupText : undefined,
      action,
      redirectUrl: action.redirectUrl || ai.redirectUrl,
      redirectImmediately: actionNeedsImmediateRedirect,
      siteVerdict: ai.siteVerdict,
      nextCheckSeconds: ai.nextCheckSeconds,
      reason: `agent: ${ai.reason || ai.thought}${(verdict === "bad" && action.type === "none") ? " [missing_redirect_url_for_bad]" : ""}`,
      goalQuestion: ai.goalQuestion,
      goalOptions: ai.goalOptions,
      suggestMedia: ai.suggestMedia,
      ai: { provider: currentProvider(), model: currentModel(), used: true, thought: ai.thought }
    };
  } else {
    response = {
      shouldPrompt: false,
      reason: `agent_offline: ${ai.thought}`,
      ai: { provider: currentProvider(), model: currentModel(), used: false, thought: ai.thought }
    };
  }

  ringPush(lastDecisions, { at: new Date().toISOString(), event, response, aiUsed: ai.used, agentThinking: ai.thought }, 500);
  return response;
}

// --- Feedback & Chat ---

function onInteractionFeedback(payload: InteractionFeedbackEvent): InteractionFeedbackResponse {
  const prompt = prompts.get(payload.promptId);
  const option = payload.selectedOption || "unknown";
  let redirectUrl: string | undefined;

  if (prompt?.actionType === "popup_then_redirect" && prompt.redirectUrl) {
    redirectUrl = prompt.redirectUrl;
  }

  ringPush(feedbackLog, { at: new Date().toISOString(), payload: { feedback: "interaction", selectedOption: option }, redirectUrl }, 500);
  return { accepted: true, redirectUrl };
}

async function onChat(req: ChatRequest): Promise<ChatResponse> {
  const { body: memoryBody, onboardingComplete } = readMemoryFile();
  stats.chatMessages += 1;
  stats.lastChatAt = new Date().toISOString();

  const { reply, memoryMarkdown, memoryOps, openUrl } = await runAiChat(req.message, memoryBody);
  if (memoryMarkdown) {
    writeMemoryFile(memoryMarkdown, onboardingComplete);
  } else if (memoryOps?.length) {
    const newBody = applyMemoryOps(memoryBody, memoryOps);
    writeMemoryFile(newBody, onboardingComplete);
  }

  const memoryUpdated = Boolean(memoryMarkdown || memoryOps?.length);
  ringPush(chatLog, { at: new Date().toISOString(), userMessage: req.message, reply, memoryUpdated, openUrl }, 200);
  return { reply, memoryUpdated, openUrl };
}

// --- HTTP ---

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(payload));
}

function html(res: ServerResponse, payload: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(payload);
}

async function parseBody<T>(req: IncomingMessage): Promise<T> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return JSON.parse(body) as T;
}

function renderDebugUi(): string {
  return `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Debug</title>
<style>
*{box-sizing:border-box;margin:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0e1a;color:#d8e0f0;padding:20px}
h1{font-size:22px;color:#7eb8ff;margin-bottom:4px}
.sub{font-size:13px;color:#5a6a8a;margin-bottom:16px}
.toolbar{display:flex;gap:8px;margin-bottom:16px;align-items:center}
.toolbar button{background:#1a2240;color:#7eb8ff;border:1px solid #2a3a5a;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:13px}
.toolbar button:hover{background:#243060}
.status{font-size:12px;color:#4a5a7a}
.grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
@media(max-width:1100px){.grid{grid-template-columns:1fr 1fr}}
@media(max-width:700px){.grid{grid-template-columns:1fr}}
.card{background:#10172a;border:1px solid #1a2545;border-radius:10px;overflow:hidden}
.card.span2{grid-column:span 2}
@media(max-width:1100px){.card.span2{grid-column:span 1}}
.card-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#131c33;border-bottom:1px solid #1a2545}
.card-head h3{font-size:14px;color:#8ab4e8;font-weight:600}
.badge{font-size:11px;padding:2px 8px;border-radius:10px;font-weight:600}
.badge-green{background:#0d3320;color:#34d399}
.badge-blue{background:#0d2640;color:#60a5fa}
.badge-yellow{background:#332d0d;color:#fbbf24}
.badge-red{background:#330d0d;color:#f87171}
.card-body{padding:12px 14px;max-height:320px;overflow-y:auto}
.card-body.tall{max-height:480px}
.stat-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.stat-item{background:#0d1225;border-radius:8px;padding:10px}
.stat-val{font-size:22px;font-weight:700;color:#fff}
.stat-label{font-size:11px;color:#5a6a8a;margin-top:2px}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.5;color:#a0b0d0;margin:0}
.decision-card{background:#0d1225;border-radius:10px;padding:12px;margin-bottom:10px;border-left:3px solid #2a3a5a}
.decision-card.prompted{border-left-color:#34d399;background:#0d1528}
.decision-card .meta{font-size:11px;color:#5a6a8a;margin-bottom:4px}
.decision-card .reason{font-size:13px;color:#c0d0e8}
.decision-card .ai-thought{font-size:12px;color:#8090b0;margin-top:4px;font-style:italic}
.insight-line{padding:4px 0;border-bottom:1px solid #151f35;font-size:13px;line-height:1.5}
.log-entry{padding:4px 0;border-bottom:1px solid #151f35;font-size:12px}
.log-entry .ts{color:#4a5a7a;font-size:11px}
.log-entry.error{color:#f87171}
.log-entry.warn{color:#fbbf24}
.mem-section{margin-bottom:10px}
.mem-section h4{font-size:12px;color:#5a6a8a;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px}
.mem-tag{display:inline-block;background:#1a2545;color:#8ab4e8;padding:2px 8px;border-radius:4px;margin:2px;font-size:12px}
.platform-bar{display:flex;gap:6px;margin-top:4px;flex-wrap:wrap}
.platform-chip{padding:4px 10px;border-radius:6px;font-size:13px;font-weight:600}
.platform-chip.youtube{background:#1a0d0d;color:#ff6b6b}
.platform-chip.x{background:#0d1a2a;color:#60a5fa}
.platform-chip.other{background:#1a1a0d;color:#9a9a6a}
.goal-card{background:#0d1a25;border:1px solid #1a3545;border-radius:8px;padding:8px 10px;margin-bottom:6px}
.goal-card .label{font-size:11px;color:#5a7a8a;text-transform:uppercase}
.goal-card .val{font-size:14px;color:#60d0a0;font-weight:600}
.media-card{background:#1a0d25;border-radius:8px;padding:6px 10px;margin-bottom:4px;font-size:12px}
.media-card a{color:#a080d0;text-decoration:none}
.chat-entry{margin-bottom:8px}
.chat-entry .user{color:#7eb8ff;font-weight:600}
.chat-entry .ai{color:#34d399;font-weight:600}
.chat-entry .msg{font-size:13px;margin-top:2px}
</style>
</head><body>
<h1>Spark Curiosity — Debug Dashboard</h1>
<div class="sub" id="runtime-info"></div>
<div class="toolbar">
  <button onclick="refresh()">Aktualisieren</button>
  <button onclick="clearView()">Logs leeren</button>
  <span class="status" id="refresh-status"></span>
</div>
<div class="grid">
  <div class="card">
    <div class="card-head"><h3>Stats</h3><span class="badge badge-green" id="stats-badge">-</span></div>
    <div class="card-body"><div class="stat-grid" id="stats"></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Ziele & Pr\u00e4ferenzen</h3><span class="badge badge-green" id="goals-badge">-</span></div>
    <div class="card-body" id="goals"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Memory</h3><span class="badge badge-blue" id="mem-badge">-</span></div>
    <div class="card-body" id="memory"></div>
  </div>
  <div class="card span2">
    <div class="card-head"><h3>\\u{1F9E0} Agent-Entscheidungen</h3><span class="badge badge-yellow" id="dec-badge">-</span></div>
    <div class="card-body tall" id="decisions"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Insights & AI-Notizen</h3></div>
    <div class="card-body tall" id="insights"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Chat-Verlauf</h3><span class="badge badge-blue" id="chat-badge">-</span></div>
    <div class="card-body" id="chats"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Feedback</h3><span class="badge badge-blue" id="fb-badge">-</span></div>
    <div class="card-body" id="feedback"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Client Logs</h3></div>
    <div class="card-body tall" id="logs"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>Runtime</h3></div>
    <div class="card-body"><pre id="runtime"></pre></div>
  </div>
</div>
<script>
async function j(u){try{const r=await fetch(u);return r.json()}catch{return null}}
function ts(iso){if(!iso)return'-';const d=new Date(iso);return d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function renderStats(s){
  const usd=(v)=>typeof v==='number'?'$'+v.toFixed(4):'-';
  document.getElementById('stats-badge').textContent=s.eventsReceived+' events';
  document.getElementById('stats').innerHTML=[
    {v:s.eventsReceived,l:'Events'},{v:s.agentCalls||0,l:'Agent-Calls'},
    {v:s.agentSkips||0,l:'Agent-Skips'},{v:s.feedbackReceived,l:'Feedback'},
    {v:s.chatMessages||0,l:'Chat-Nachr.'},{v:s.aiTotalTokens||0,l:'AI Tokens'},
    {v:usd(s.aiEstimatedCostUsd||0),l:'AI Kosten (USD)'},{v:s.aiCostTrackedCalls||0,l:'Cost-Calls'},
    {v:s.aiUnpricedCalls||0,l:'Unpriced-Calls'},{v:ts(s.lastEventAt),l:'Letztes Event'}
  ].map(x=>'<div class="stat-item"><div class="stat-val">'+x.v+'</div><div class="stat-label">'+x.l+'</div></div>').join('');
}

function renderGoals(m){
  const el=document.getElementById('goals');
  const badge=document.getElementById('goals-badge');
  let html='';
  if(m.goals&&m.goals.length){
    badge.textContent=m.goals.length+' Ziele';
    m.goals.forEach(g=>{
      const labels={avoid:'Vermeiden',reduce:'Reduzieren',keep:'Beibehalten'};
      html+='<div class="goal-card"><div class="label">'+g.platform+'</div><div class="val">'+(labels[g.intention]||g.intention)+(g.dailyLimitMinutes?' ('+g.dailyLimitMinutes+' min/Tag)':'')+'</div>'+(g.context?'<div style="font-size:11px;color:#5a7a8a;margin-top:2px">'+g.context+'</div>':'')+'</div>';
    });
  }else{badge.textContent='Keine';html='<div style="color:#5a6a8a">Noch keine Ziele gesetzt.</div>';}
  if(m.motivationalMedia&&m.motivationalMedia.length){
    html+='<div class="mem-section" style="margin-top:10px"><h4>Motivationale Medien</h4>';
    m.motivationalMedia.forEach(x=>{html+='<div class="media-card"><a href="'+x.url+'" target="_blank">'+x.title+'</a>'+(x.context?' — '+x.context:'')+'</div>';});
    html+='</div>';
  }
  if(Object.keys(m.userPreferences||{}).length){
    html+='<div class="mem-section" style="margin-top:10px"><h4>Pr\\u00e4ferenzen</h4>';
    for(const[k,v]of Object.entries(m.userPreferences)){html+='<div class="mem-tag">'+k+': '+v+'</div>';}
    html+='</div>';
  }
  el.innerHTML=html;
}
function renderMemory(m){
  const el=document.getElementById('memory');
  document.getElementById('mem-badge').textContent=m.totalEvents+' total';
  let html='<div class="mem-section"><h4>Plattformen</h4><div class="platform-bar">';
  for(const[p,c]of Object.entries(m.platformCounts||{})){html+='<div class="platform-chip '+p+'">'+p+': '+c+'</div>';}
  html+='</div></div>';
  html+='<div class="mem-section"><h4>Zusammenfassung</h4><div class="stat-grid">';
  html+='<div class="stat-item"><div class="stat-val">'+m.totalPrompts+'</div><div class="stat-label">Prompts</div></div>';
  html+='<div class="stat-item"><div class="stat-val">'+m.totalFeedback+'</div><div class="stat-label">Feedback</div></div>';
  html+='</div></div>';
  if(m.notes&&m.notes.length){html+='<div class="mem-section"><h4>Notizen</h4>';m.notes.slice(-8).reverse().forEach(n=>{html+='<div class="mem-tag">'+n+'</div>';});html+='</div>';}
  el.innerHTML=html;
}
function renderInsights(text,llmInsights){
  const el=document.getElementById('insights');
  let html='';
  if(llmInsights&&llmInsights.length){
    html+='<div class="mem-section"><h4>AI-Erkenntnisse</h4>';
    llmInsights.slice(-10).reverse().forEach(i=>{html+='<div class="insight-line" style="color:#60d0a0">'+i+'</div>';});
    html+='</div>';
  }
  if(text&&text.trim()){
    html+='<div class="mem-section"><h4>Insights-Log</h4>';
    text.trim().split('\\n').filter(l=>l.trim()).slice(-10).reverse().forEach(l=>{html+='<div class="insight-line">'+l.replace(/^- /,'')+'</div>';});
    html+='</div>';
  }
  if(!html)html='<div style="color:#5a6a8a">Noch keine Insights.</div>';
  el.innerHTML=html;
}
function renderDecisions(traces){
  const el=document.getElementById('decisions');
  const called=traces.filter(t=>!t.agentSkipped).length;
  const skipped=traces.filter(t=>t.agentSkipped).length;
  document.getElementById('dec-badge').textContent=called+' calls / '+skipped+' skips';
  el.innerHTML=traces.slice(0,30).map(t=>{
    const r=t.response||{};const e=t.event||{};const prompted=r.shouldPrompt;const ai=r.ai||{};
    const wasSkipped=t.agentSkipped;const agentOn=ai.used;
    const verdictColors={good:'#34d399',bad:'#f87171',neutral:'#fbbf24'};
    const vColor=verdictColors[r.siteVerdict]||'#5a6a8a';
    if(wasSkipped){
      let h='<div class="decision-card" style="opacity:0.6;border-left-color:#2a2a3a">';
      h+='<div class="meta">'+ts(t.at)+' \\u00b7 <span style="color:#5a6a8a">\\u23F8 Skipped</span>';
      if(t.skipReason)h+=' \\u00b7 <span style="color:#4a5a7a">'+t.skipReason+'</span>';
      if(r.siteVerdict)h+=' \\u00b7 <span style="color:'+vColor+'">'+r.siteVerdict+'</span>';
      h+='</div>';
      if(e.url){h+='<div class="meta" style="color:#4a5a6a;margin:2px 0">'+String(e.url).slice(0,80)+'</div>';}
      const skipThought=t.agentThinking||ai.thought||r.reason;
      if(skipThought){
        h+='<div style="margin:6px 0;padding:8px;background:#080d1a;border-radius:6px;border-left:2px solid #555">';
        h+='<div style="font-size:11px;color:#5a6a8a;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px">Agent-Denken (Skip)</div>';
        h+='<div style="font-size:13px;color:#aab8d0;line-height:1.5">'+skipThought+'</div>';
        h+='</div>';
      }
      h+='</div>';return h;
    }
    let h='<div class="decision-card'+(prompted?' prompted':'')+'">';
    h+='<div class="meta">'+ts(t.at)+' \\u00b7 '+(e.platform||'?')+' \\u00b7 '+(e.contentMode||'?');
    h+=(agentOn?' \\u00b7 <span style="color:#34d399">\\u{1F9E0} Agent</span>':' \\u00b7 <span style="color:#f87171">Agent offline</span>');
    if(r.action&&r.action.type)h+=' \\u00b7 Action: <span style="color:#7eb8ff">'+r.action.type+'</span>';
    if(t.activationReason)h+=' \\u00b7 <span style="color:#4a6a8a">'+t.activationReason+'</span>';
    if(r.siteVerdict)h+=' \\u00b7 Verdict: <span style="color:'+vColor+'">'+r.siteVerdict+'</span>';
    if(r.nextCheckSeconds)h+=' \\u00b7 Next: '+r.nextCheckSeconds+'s';
    h+='</div>';
    if(e.url){h+='<div class="meta" style="color:#6a7a9a;margin:2px 0">'+String(e.url).slice(0,100)+'</div>';}
    if(e.title){h+='<div class="meta" style="color:#8a9aba">'+String(e.title).slice(0,80)+'</div>';}
    h+='<div style="margin:6px 0;padding:8px;background:#080d1a;border-radius:6px;border-left:2px solid '+(agentOn?'#4a8af5':'#555')+'">';
    h+='<div style="font-size:11px;color:#5a6a8a;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px">Agent-Denken</div>';
    h+='<div style="font-size:13px;color:#c0d0e8;line-height:1.5">'+(t.agentThinking||ai.thought||r.reason||'(kein Output)')+'</div>';
    h+='</div>';
    if(prompted){
      h+='<div style="margin-top:4px"><strong style="color:#34d399">\\u2192 POPUP:</strong> <span style="color:#d0d8e8">'+(r.promptText||'-')+'</span></div>';
      if(r.redirectUrl){h+='<div class="meta" style="margin-top:2px">Redirect: <span style="color:#60a5fa">'+r.redirectUrl+'</span></div>';}
    }
    if(r.goalQuestion){h+='<div style="margin-top:4px;color:#fbbf24">Ziel-Frage: '+r.goalQuestion+'</div>';}
    if(r.suggestMedia){h+='<div class="meta" style="margin-top:2px">Media: '+r.suggestMedia+'</div>';}
    h+='</div>';return h;
  }).join('');
}
function renderChats(chats){
  const el=document.getElementById('chats');
  document.getElementById('chat-badge').textContent=(chats.length||0)+' Nachr.';
  el.innerHTML=chats.slice(0,20).map(c=>{
    let h='<div class="chat-entry"><span class="ts">'+ts(c.at)+'</span>';
    h+='<div><span class="user">Du:</span> <span class="msg">'+c.userMessage+'</span></div>';
    h+='<div><span class="ai">Spark:</span> <span class="msg">'+c.reply+'</span></div>';
    if(c.memoryUpdated)h+='<span class="badge badge-green" style="margin-top:4px">Memory aktualisiert</span>';
    h+='</div>';return h;
  }).join('');
}
function renderFeedback(traces){
  const el=document.getElementById('feedback');
  document.getElementById('fb-badge').textContent=traces.length+' Eintr.';
  el.innerHTML=traces.slice(0,15).map(t=>{
    const p=t.payload||{};
    const feedbackType=p.feedback||'?';
    const emoji=feedbackType==='up'?'\\u{1F44D}':feedbackType==='down'?'\\u{1F44E}':'\\u{1F9ED}';
    const label=feedbackType==='review'?'review: '+(p.selectedOption||'?'):feedbackType;
    let h='<div class="log-entry"><span class="ts">'+ts(t.at)+'</span> '+emoji+' '+label;
    if(t.redirectUrl)h+=' \\u2192 <span style="color:#34d399">'+t.redirectUrl+'</span>';
    return h+'</div>';
  }).join('');
}
function renderLogs(logs){
  document.getElementById('logs').innerHTML=logs.slice(0,40).map(l=>{
    const cls=l.level==='error'?'error':l.level==='warn'?'warn':'';
    let h='<div class="log-entry '+cls+'"><span class="ts">'+ts(l.at)+'</span> <strong>'+l.message+'</strong>';
    if(l.context&&l.context.reason)h+=' ('+l.context.reason+')';
    return h+'</div>';
  }).join('');
}
function renderRuntime(rt){
  document.getElementById('runtime-info').textContent='PID '+rt.pid+' \\u00b7 Provider: '+rt.provider+' \\u00b7 Model: '+rt.model;
  document.getElementById('runtime').textContent=JSON.stringify(rt,null,2);
}
async function refresh(){
  document.getElementById('refresh-status').textContent='Lade...';
  try{
    const[rt,s,l,d,f,m,i,ch]=await Promise.all([
      j('/debug/runtime'),j('/debug/stats'),j('/debug/client-logs?limit=40'),j('/debug/traces?limit=20'),
      j('/debug/feedback-traces?limit=15'),j('/memory'),j('/memory/insights'),j('/debug/chat-log?limit=20')
    ]);
    if(rt)renderRuntime(rt);if(s)renderStats(s);if(l)renderLogs(l.logs||[]);
    if(d)renderDecisions(d.traces||[]);if(f)renderFeedback(f.traces||[]);
    if(m){renderMemory(m);renderGoals(m);renderInsights(i?i.text:'',m.llmInsights||[]);}
    if(ch)renderChats(ch.chats||[]);
    document.getElementById('refresh-status').textContent='Aktualisiert: '+new Date().toLocaleTimeString('de-DE');
  }catch(e){document.getElementById('refresh-status').textContent='Fehler: '+e;}
}
function clearView(){['logs','decisions','feedback','chats'].forEach(id=>{document.getElementById(id).innerHTML='';})}
refresh();setInterval(refresh,3000);
</script></body></html>`;
}

function renderDesktopSetupUi(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Desktop Setup</title>
<style>
body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#0b1020;color:#e8eefc;margin:0;padding:24px}
.card{max-width:720px;margin:0 auto;background:#131a2e;border:1px solid #24304f;border-radius:14px;padding:20px}
h1{margin:0 0 8px 0;font-size:22px}
p{color:#a8b8d8}
label{display:block;margin-top:14px;margin-bottom:6px;font-size:13px;color:#b9c7e6}
input,select,textarea,button{width:100%;box-sizing:border-box;border-radius:10px;border:1px solid #2a3a62;background:#0a1328;color:#e8eefc;padding:10px}
textarea{min-height:96px;resize:vertical}
button{margin-top:18px;background:#2f6df6;border:none;font-weight:700;cursor:pointer}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ok{margin-top:14px;color:#68d391}
.err{margin-top:14px;color:#fca5a5}
.meta{margin-top:6px;font-size:12px;color:#8da0c8}
a{color:#84aefc}
</style></head>
<body><div class="card">
<h1>Spark Desktop Setup</h1>
<p>API-Key + Vorlage setzen. Danach laeuft Spark im Hintergrund weiter.</p>
<div id="status" class="meta">Lade Setup-Daten...</div>
<label>Grok API Key</label><input id="apiKey" type="password" placeholder="xai-..."/>
<div class="row">
<div><label>Model</label><input id="model" type="text" value="grok-4-1-fast-reasoning"/></div>
<div><label>Vorlage</label><select id="template"></select></div>
</div>
<label>Notizen (optional)</label><textarea id="notes" placeholder="z.B. Fokus auf Deep Work, keine Social Apps nach 23 Uhr"></textarea>
<button id="saveBtn">Speichern & weiter</button>
<div id="result"></div>
<div class="meta">Debug UI: <a href="/debug/ui" target="_blank">/debug/ui</a></div>
<div class="meta" id="updateStatus">Update-Check: ...</div>
<button id="updateBtn" style="display:none;background:#0f3d8a">Update starten (Command kopieren)</button>
</div>
<script>
const $=id=>document.getElementById(id);
async function j(url,opt){const r=await fetch(url,opt);if(!r.ok)throw new Error(await r.text());return r.json();}
async function load(){
  const [cfg, tpls] = await Promise.all([j('/desktop/config'), j('/onboarding/templates')]);
  $('status').textContent = cfg.runtimeConfigPath ? ('Config: '+cfg.runtimeConfigPath) : 'Config-Pfad fehlt (SPARK_WINDOWS_APP_ROOT)';
  $('model').value = cfg.grokModel || 'grok-4-1-fast-reasoning';
  const sel=$('template'); sel.innerHTML='';
  (tpls.templates||[]).forEach(t=>{ const o=document.createElement('option'); o.value=t.id; o.textContent=t.name||t.id; sel.appendChild(o); });
  if(!sel.options.length){const o=document.createElement('option');o.value='';o.textContent='(keine Vorlage gefunden)';sel.appendChild(o);}
  try{
    const u=await j('/desktop/update-check');
    if(u && u.updateAvailable){
      $('updateStatus').textContent='Update verfuegbar: '+u.currentVersion+' -> '+u.latestVersion;
      const btn=$('updateBtn');
      btn.style.display='block';
      btn.onclick=async()=>{
        try{ await navigator.clipboard.writeText('spark-curiosity update'); }catch{}
        btn.textContent='Command kopiert: spark-curiosity update';
      };
    }else if(u && u.currentVersion){
      $('updateStatus').textContent='Version aktuell: '+u.currentVersion;
    }
  }catch(e){
    $('updateStatus').textContent='Update-Check fehlgeschlagen';
  }
}
$('saveBtn').onclick=async()=>{
  const result=$('result'); result.className='meta'; result.textContent='Speichere...';
  try{
    const payload={grokApiKey:$('apiKey').value.trim(),grokModel:$('model').value.trim(),templateId:$('template').value,customNotes:$('notes').value.trim()};
    await j('/desktop/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    result.className='ok';
    result.textContent='Gespeichert. Debug UI wird geoeffnet...';
    setTimeout(()=>{ window.location.href='/debug/ui'; },700);
  }catch(e){
    result.className='err';
    result.textContent='Fehler: '+String(e);
  }
};
load().catch(e=>{$('status').textContent='Fehler: '+String(e);});
</script></body></html>`;
}

function renderCuratedPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Spark Curated Feed</title>
<style>
  :root{
    --bg:#0b0f1e;--panel:#11182d;--border:#24304f;--text:#e8eefc;--muted:#95a3c7;--accent:#4a8af5;--accent2:#34d399;
  }
  body{margin:0;padding:28px;background:radial-gradient(1200px 600px at 10% -10%,#1a2440,transparent),var(--bg);color:var(--text);font-family:Segoe UI,system-ui,sans-serif}
  .wrap{max-width:900px;margin:0 auto}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:20px 22px;box-shadow:0 18px 40px rgba(0,0,0,0.45)}
  h1{margin:0 0 6px 0;font-size:22px}
  .meta{color:var(--muted);font-size:12px}
  .search{display:flex;gap:10px;margin-top:16px}
  input{flex:1;background:#0a1328;border:1px solid #2a3a62;border-radius:10px;padding:12px;color:var(--text);font-size:14px}
  button{background:var(--accent);border:none;border-radius:10px;padding:12px 16px;color:white;font-weight:700;cursor:pointer}
  button.secondary{background:#1a2540;color:#c0d8ff}
  .items{margin-top:18px;display:grid;grid-template-columns:1fr;gap:12px}
  .item{background:#0d142a;border:1px solid #22304f;border-radius:12px;padding:14px}
  .item h3{margin:0 0 6px 0;font-size:16px;color:#cfe0ff}
  .item .url{font-size:12px;color:#7d8ab0;word-break:break-all}
  .item .actions{margin-top:10px;display:flex;gap:8px}
  .pill{background:#0d2520;color:#86efac;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600}
  .loading{opacity:.7}
</style></head>
<body><div class="wrap">
  <div class="card">
    <div class="pill">Curated Gate aktiv</div>
    <h1>Kuratiertes Fenster</h1>
    <div class="meta" id="meta">Lade...</div>
    <div class="search">
      <input id="q" type="text" placeholder="Suche genau das, was du brauchst..." />
      <button id="searchBtn">Suchen</button>
    </div>
    <div class="items" id="items"></div>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const from=params.get('from')||'';
const site=params.get('site')|| (from?new URL(from).hostname:'');
const meta=$('meta'); meta.textContent = site ? ('Quelle: '+site+' â€” Feed blockiert, nur kuratierte Inhalte.') : 'Feed blockiert, kuratierte Inhalte.';
const itemsEl=$('items');
function itemCard(item){
  const div=document.createElement('div'); div.className='item';
  const h=document.createElement('h3'); h.textContent=item.title||item.url; div.appendChild(h);
  const u=document.createElement('div'); u.className='url'; u.textContent=item.url; div.appendChild(u);
  const actions=document.createElement('div'); actions.className='actions';
  const open=document.createElement('button'); open.className='secondary'; open.textContent='Oeffnen'; open.onclick=()=>{window.open(item.url,'_blank','noopener');};
  actions.appendChild(open); div.appendChild(actions);
  return div;
}
async function loadRecs(){
  itemsEl.innerHTML=''; itemsEl.classList.add('loading'); itemsEl.textContent='Lade Empfehlungen...';
  try{
    const r=await fetch('/curated/recommendations?site='+encodeURIComponent(site||'')+'&limit=10');
    const data=await r.json();
    const items=(data.items||[]);
    itemsEl.classList.remove('loading'); itemsEl.innerHTML='';
    if(!items.length){ itemsEl.textContent='Keine Empfehlungen gefunden. Nutze die Suche.'; return; }
    items.forEach(i=>itemsEl.appendChild(itemCard(i)));
  }catch(e){
    itemsEl.classList.remove('loading'); itemsEl.textContent='Fehler beim Laden.';
  }
}
async function doSearch(){
  const q=$('q').value.trim(); if(!q) return;
  $('searchBtn').disabled=true;
  try{
    const r=await fetch('/curated/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q,site})});
    const data=await r.json();
    if(data && data.url){ window.open(data.url,'_blank','noopener'); }
  }catch(e){}
  $('searchBtn').disabled=false;
}
$('searchBtn').onclick=()=>{void doSearch();};
$('q').addEventListener('keydown',e=>{ if(e.key==='Enter'){ void doSearch(); }});
loadRecs();
</script></body></html>`;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
    return void res.end();
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, host: HOST, port: PORT, provider: currentProvider(), model: currentModel(), buildId: BUILD_ID, runtimeId: RUNTIME_ID });
  }
  if (req.method === "GET" && url.pathname === "/debug/runtime") {
    return json(res, 200, {
      buildId: BUILD_ID,
      runtimeId: RUNTIME_ID,
      pid: process.pid,
      provider: currentProvider(),
      model: currentModel(),
      aiTimeoutMs: AI_TIMEOUT_MS,
      grokInputUsdPer1m: GROK_INPUT_USD_PER_1M,
      grokOutputUsdPer1m: GROK_OUTPUT_USD_PER_1M,
      ollamaBaseUrl: OLLAMA_BASE_URL,
      grokBaseUrl: GROK_BASE_URL,
      grokKeyPresent: Boolean(currentGrokApiKey()),
      dataDir: DATA_DIR
    });
  }
  if (req.method === "GET" && url.pathname === "/memory") return json(res, 200, loadMemory());
  if (req.method === "GET" && url.pathname === "/memory/insights") {
    const { body, onboardingComplete } = readMemoryFile();
    const text = `---\nonboardingComplete: ${onboardingComplete}\n---\n\n${body}`;
    return json(res, 200, { text });
  }
  if (req.method === "GET" && url.pathname === "/debug/stats") return json(res, 200, stats);
  if (req.method === "GET" && url.pathname === "/debug/client-logs") {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 20)));
    return json(res, 200, { logs: clientLogs.slice(-limit).reverse() });
  }
  if (req.method === "GET" && url.pathname === "/debug/traces") {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 20)));
    return json(res, 200, { traces: lastDecisions.slice(-limit).reverse() });
  }
  if (req.method === "GET" && url.pathname === "/debug/feedback-traces") {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 20)));
    return json(res, 200, { traces: feedbackLog.slice(-limit).reverse() });
  }
  if (req.method === "GET" && url.pathname === "/debug/chat-log") {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 20)));
    return json(res, 200, { chats: chatLog.slice(-limit).reverse() });
  }
  if (req.method === "GET" && url.pathname === "/debug/verdicts") {
    const entries: Record<string, unknown>[] = [];
    for (const [host, v] of siteVerdicts) entries.push({ host, ...v, expiresInSec: Math.round((v.nextCheckAt - Date.now()) / 1000) });
    return json(res, 200, { verdicts: entries, recentThoughts: recentAgentThoughts });
  }
  if (req.method === "GET" && url.pathname === "/debug/ui") return html(res, renderDebugUi());
  if (req.method === "GET" && url.pathname === "/setup") return html(res, renderDesktopSetupUi());
  if (req.method === "GET" && url.pathname === "/curated") return html(res, renderCuratedPage());

  if (req.method === "GET" && url.pathname === "/policy/curated-gate") {
    return json(res, 200, curatedGatePolicy);
  }
  if (req.method === "POST" && url.pathname === "/policy/curated-gate") {
    try {
      const body = await parseBody<CuratedGateUpdate & CuratedGatePolicy>(req);
      if (typeof body.mode === "string") {
        const updated = applyCuratedGateUpdate({
          mode: body.mode as CuratedGateUpdate["mode"],
          rules: body.rules,
          ruleIds: body.ruleIds,
          note: body.note
        });
        return json(res, 200, updated);
      }
      if (typeof body.enabled === "boolean" || Array.isArray(body.rules)) {
        const rules = normalizeCuratedGateRules(body.rules);
        saveCuratedGatePolicy({ enabled: Boolean(body.enabled), rules, note: body.note, updatedAt: new Date().toISOString() });
        return json(res, 200, curatedGatePolicy);
      }
      return json(res, 400, { error: "invalid_policy_payload" });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
  }

  if (req.method === "GET" && url.pathname === "/curated/recommendations") {
    const site = url.searchParams.get("site") || "";
    const limit = Math.max(1, Math.min(12, Number(url.searchParams.get("limit") || 10)));
    const cacheKey = site || "__all__";
    const cached = curatedCache.get(cacheKey);
    if (cached && Date.now() - cached.updatedAt < 5 * 60 * 1000) {
      return json(res, 200, { items: cached.items });
    }
    try {
      const { body } = readMemoryFile();
      const items = await runAiCuratedRecommendations(site, body, limit);
      curatedCache.set(cacheKey, { items, updatedAt: Date.now() });
      return json(res, 200, { items });
    } catch (error) {
      return json(res, 200, { items: [], error: String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/curated/search") {
    try {
      const body = await parseBody<{ query: string; site?: string }>(req);
      const query = body.query?.trim();
      if (!query) return json(res, 400, { error: "query_required" });
      const { body: memoryBody } = readMemoryFile();
      const result = await runAiCuratedSearch(body.site || "", query, memoryBody);
      if (!result) return json(res, 200, { ok: false });
      return json(res, 200, { ok: true, ...result });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
  }

  if (req.method === "GET" && url.pathname === "/desktop/config") {
    return json(res, 200, {
      provider: currentProvider(),
      grokModel: currentGrokModel(),
      grokKeyPresent: Boolean(currentGrokApiKey()),
      runtimeConfigPath: RUNTIME_CONFIG_PATH || null
    });
  }

  if (req.method === "GET" && url.pathname === "/desktop/update-check") {
    const currentVersion = readCurrentVersion();
    const manifestUrl = resolveUpdateManifestUrl();
    if (!manifestUrl) {
      return json(res, 200, { currentVersion, updateAvailable: false, reason: "no_manifest" });
    }
    try {
      const resManifest = await fetch(manifestUrl, { signal: AbortSignal.timeout(3000) });
      if (!resManifest.ok) return json(res, 200, { currentVersion, updateAvailable: false, reason: `http_${resManifest.status}` });
      const data = await resManifest.json() as { version?: string; asset?: string };
      const latestVersion = typeof data.version === "string" ? data.version : "";
      if (!latestVersion) return json(res, 200, { currentVersion, updateAvailable: false, reason: "no_version" });
      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
      return json(res, 200, {
        currentVersion,
        latestVersion,
        updateAvailable,
        manifestUrl
      });
    } catch (error) {
      return json(res, 200, { currentVersion, updateAvailable: false, reason: String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/desktop/setup") {
    try {
      const body = await parseBody<{ grokApiKey: string; grokModel?: string; templateId?: string; customNotes?: string }>(req);
      if (!body.grokApiKey?.trim()) return json(res, 400, { error: "grok_api_key_required" });
      const writeResult = writeRuntimeConfig({
        provider: "grok",
        grokApiKey: body.grokApiKey.trim(),
        grokModel: (body.grokModel || "grok-4-1-fast-reasoning").trim()
      });
      if (!writeResult.ok) return json(res, 500, { error: writeResult.error });

      if (body.templateId?.trim()) {
        const applied = applyOnboardingTemplate(body.templateId.trim(), body.customNotes);
        if (!applied.ok) return json(res, 400, { error: applied.error });
        return json(res, 200, { ok: true, templateId: applied.templateId });
      }
      return json(res, 200, { ok: true, templateId: null });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/debug/client-log") {
    try {
      const p = await parseBody<ClientLog>(req);
      ringPush(clientLogs, { at: p.at || new Date().toISOString(), level: p.level || "info", message: p.message || "unknown", context: p.context }, 500);
      return json(res, 202, { accepted: true });
    } catch { return json(res, 400, { accepted: false }); }
  }
  if (req.method === "POST" && url.pathname === "/event") {
    try {
      const event = await parseBody<EventIngest>(req);
      stats.eventsReceived += 1;
      stats.lastEventAt = new Date().toISOString();
      return json(res, 200, await decide(event));
    } catch (error) {
      return json(res, 400, { shouldPrompt: false, reason: `bad_event:${String(error)}` });
    }
  }
  if (req.method === "POST" && url.pathname === "/interaction-feedback") {
    try {
      const p = await parseBody<InteractionFeedbackEvent>(req);
      stats.feedbackReceived += 1;
      stats.lastFeedbackAt = new Date().toISOString();
      return json(res, 202, onInteractionFeedback(p));
    } catch { return json(res, 400, { accepted: false }); }
  }
  if (req.method === "POST" && url.pathname === "/chat") {
    try {
      const p = await parseBody<ChatRequest>(req);
      return json(res, 200, await onChat(p));
    } catch (error) {
      return json(res, 400, { reply: `Fehler: ${String(error)}`, memoryUpdated: false });
    }
  }

  if (req.method === "GET" && url.pathname === "/onboarding/status") {
    const memory = loadMemory();
    return json(res, 200, { onboardingComplete: Boolean(memory.onboardingComplete) });
  }

  if (req.method === "GET" && url.pathname === "/onboarding/templates") {
    const templates: Array<{ id: string; name: string; description: string; highlights: string[] }> = [];
    try {
      mkdirSync(TEMPLATES_DIR, { recursive: true });
      const files = readdirSync(TEMPLATES_DIR);
      for (const f of files) {
        if (!f.toLowerCase().endsWith(".md")) continue;
        try {
          const t = readTemplateFile(join(TEMPLATES_DIR, f));
          templates.push({ id: t.id, name: t.name, description: t.description, highlights: t.highlights });
        } catch { /* skip */ }
      }
    } catch { /* empty list */ }
    return json(res, 200, { templates });
  }

  if (req.method === "POST" && url.pathname === "/onboarding/select") {
    try {
      const body = await parseBody<{ templateId: string; customNotes?: string }>(req);
      const result = applyOnboardingTemplate(body.templateId, body.customNotes);
      if (!result.ok) return json(res, 404, { error: result.error });
      return json(res, 200, { ok: true, templateId: result.templateId });
    } catch (error) {
      return json(res, 400, { error: String(error) });
    }
  }

  if (req.method === "POST" && url.pathname === "/onboarding/skip") {
    const { body, onboardingComplete: _ } = readMemoryFile();
    writeMemoryFile(body, true);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "not_found" });
}

export function createCompanionServer() {
  return createServer((req, res) => { void handle(req, res); });
}

export function startCompanionServer(port = PORT, host = HOST) {
  ensureFiles();
  const server = createCompanionServer();
  server.listen(port, host, async () => {
    const provider = currentProvider();
    const model = currentModel();
    const grokApiKey = currentGrokApiKey();
    console.log(`Spark companion running on http://${host}:${port}`);
    console.log(`[spark] AI provider: ${provider} — Modell: ${model} — Timeout: ${AI_TIMEOUT_MS}ms`);
    if (provider === "grok") {
      if (grokApiKey) {
        console.log(`[spark] Grok aktiv: ${GROK_BASE_URL}`);
      } else {
        console.warn("[spark] ⚠ Grok gewählt, aber SPARK_GROK_API_KEY fehlt.");
        console.warn("[spark]   Agent-Entscheidungen werden mit \"grok_missing_api_key\" beantwortet.");
      }
      return;
    }

    const ollamaOk = await checkOllamaHealth();
    if (ollamaOk) {
      console.log(`[spark] Ollama erreichbar: ${OLLAMA_BASE_URL} — Modell: ${model}`);
    } else {
      console.warn(`[spark] ⚠ Ollama NICHT erreichbar unter ${OLLAMA_BASE_URL}`);
      console.warn(`[spark]   Agent-Entscheidungen werden mit "ollama_unavailable" beantwortet.`);
      console.warn(`[spark]   Fix: Ollama installieren + starten + Modell pullen: ollama pull ${model}`);
    }
  });
  return server;
}

export function setTestForcedAiJson(json: string | null): void {
  forcedAiJsonForTests = json;
}

if (process.env.SPARK_SKIP_AUTOSTART !== "1") {
  startCompanionServer();
}




