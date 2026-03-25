import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MemoryEntry, MemorySnapshot, MemoryOp, MemorySection } from "@spark/shared";
import { MEMORY_MD_PATH, RUNTIME_CONFIG_PATH, TEMPLATES_DIR, normalizeGrokModelName } from "./config.js";

const DEFAULT_MEMORY_BODY = `## Long-Term
- (leer)

## Mid-Term
- (leer)

## Short-Term
- (leer)
`;

let runtimeMemoryBody = DEFAULT_MEMORY_BODY;
let runtimeOnboardingComplete = false;
let runtimeWelcomeShown = false;
const DISK_PERSISTENCE_ENABLED = true;

/** Serialize memory file with YAML frontmatter (installer reads onboardingComplete from disk). */
export function formatMemoryFile(body: string, onboardingComplete: boolean): string {
  const b = (body || "").trim() || DEFAULT_MEMORY_BODY.trim();
  return `---\nonboardingComplete: ${onboardingComplete}\n---\n\n${b}\n`;
}

/** Parse frontmatter + markdown body from disk. */
export function parseMemoryFileRaw(raw: string): { onboardingComplete: boolean | null; body: string } {
  const trimmed = raw.trim();
  const fmMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) return { onboardingComplete: null, body: raw };
  const meta: Record<string, string> = {};
  for (const line of fmMatch[1].split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const ob = meta.onboardingcomplete;
  if (ob === undefined) return { onboardingComplete: null, body: fmMatch[2] };
  const oc = ob === "true" || ob === "1" || ob.toLowerCase() === "yes";
  return { onboardingComplete: oc, body: fmMatch[2] };
}

function stripLeadingFrontmatterFromBody(raw: string): string {
  const t = raw.trim();
  const fmMatch = t.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  if (fmMatch) return fmMatch[1].trim();
  return raw;
}

/** Legacy files without frontmatter: infer completion from onboarding markers. */
function inferLegacyOnboardingComplete(body: string): boolean {
  if (body.includes("Nutzer-Anmerkung beim Onboarding")) return true;
  return false;
}

export interface MemoryFileResult {
  body: string;
  onboardingComplete: boolean;
  snapshot: MemorySnapshot;
}

export function defaultMemory(): MemorySnapshot {
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

export function readMemoryFile(): MemoryFileResult {
  const base = defaultMemory();
  if (DISK_PERSISTENCE_ENABLED) {
    ensureFiles();
    try {
      const raw = readFileSync(MEMORY_MD_PATH, "utf8");
      const parsed = parseMemoryFileRaw(raw);
      let body = parsed.body?.trim() ? parsed.body : DEFAULT_MEMORY_BODY;
      body = stripLeadingFrontmatterFromBody(body);
      let onboardingComplete = parsed.onboardingComplete;
      if (onboardingComplete === null) {
        onboardingComplete = inferLegacyOnboardingComplete(body);
      }
      runtimeOnboardingComplete = onboardingComplete;
      runtimeMemoryBody = body;
      const { longTerm, midTerm, shortTerm } = parseMemoryMarkdown(body);
      return {
        body,
        onboardingComplete,
        snapshot: { ...base, longTerm, midTerm, shortTerm, onboardingComplete },
      };
    } catch {
      // fall through to runtime copy
    }
  }
  const onboardingComplete = runtimeOnboardingComplete;
  const body = runtimeMemoryBody || DEFAULT_MEMORY_BODY;
  const { longTerm, midTerm, shortTerm } = parseMemoryMarkdown(body);
  return {
    body: body || DEFAULT_MEMORY_BODY,
    onboardingComplete,
    snapshot: { ...base, longTerm, midTerm, shortTerm, onboardingComplete },
  };
}

export function writeMemoryFile(body: string, onboardingComplete: boolean): void {
  const stripped = stripLeadingFrontmatterFromBody(body || "");
  runtimeMemoryBody = stripped || DEFAULT_MEMORY_BODY;
  runtimeOnboardingComplete = onboardingComplete;
  if (DISK_PERSISTENCE_ENABLED) {
    ensureFiles();
    try {
      writeFileSync(MEMORY_MD_PATH, formatMemoryFile(runtimeMemoryBody, onboardingComplete), "utf8");
    } catch {
      // ignore
    }
  }
}

/** Returns a welcome message once after onboarding completes, then null forever. */
export function consumeWelcome(): string | null {
  if (runtimeWelcomeShown || !runtimeOnboardingComplete) return null;
  runtimeWelcomeShown = true;
  const { body } = readMemoryFile();
  const nameMatch = body.match(/Name:\s*(.+)/i);
  const name = nameMatch ? nameMatch[1].trim() : null;
  const greeting = name ? `Hey ${name}!` : "Hey!";
  return `${greeting} Ich bin Spark, dein Begleiter fuer digitale Achtsamkeit. ` +
    `Ich laufe im Hintergrund und helfe dir, fokussiert zu bleiben. ` +
    `Du kannst jederzeit mit mir reden — sag mir, was ich verbessern soll, ` +
    `stell mir Fragen oder teil mir deine Ziele mit. Los geht's!`;
}

export function ensureFiles(): void {
  if (!existsSync(MEMORY_MD_PATH)) {
    const dir = dirname(MEMORY_MD_PATH);
    mkdirSync(dir, { recursive: true });
    writeFileSync(MEMORY_MD_PATH, formatMemoryFile(DEFAULT_MEMORY_BODY.trim(), false), "utf8");
  }
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

export function listOnboardingTemplates(): Array<{ id: string; name: string; description: string; highlights: string[] }> {
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
  return templates;
}

export function loadMemory(): MemorySnapshot {
  return readMemoryFile().snapshot;
}

export function applyOnboardingTemplate(templateId: string, customNotes?: string): { ok: true; templateId: string } | { ok: false; error: string } {
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

/** Write runtime config. Merges with existing values so keys like SPARK_CLOUD_PROXY_URL are preserved. */
export function writeRuntimeConfig(config: { grokApiKey: string; grokModel: string }): { ok: true } | { ok: false; error: string } {
  if (!RUNTIME_CONFIG_PATH) return { ok: false, error: "runtime_config_path_missing" };
  try {
    const dir = dirname(RUNTIME_CONFIG_PATH);
    mkdirSync(dir, { recursive: true });
    // Read existing values to preserve keys we don't set
    const existing: Record<string, string> = {};
    if (existsSync(RUNTIME_CONFIG_PATH)) {
      const raw = readFileSync(RUNTIME_CONFIG_PATH, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const idx = t.indexOf("=");
        if (idx <= 0) continue;
        existing[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
      }
    }
    // Merge: our config overwrites, everything else preserved
    existing["SPARK_GROK_API_KEY"] = config.grokApiKey.trim();
    existing["SPARK_GROK_MODEL"] = normalizeGrokModelName(config.grokModel);
    // Never write SPARK_GROK_BASE_URL — it's derived from CLOUD_PROXY_URL automatically
    delete existing["SPARK_GROK_BASE_URL"];
    const lines = Object.entries(existing)
      .filter(([k]) => k)
      .map(([k, v]) => `${k}=${v}`);
    writeFileSync(RUNTIME_CONFIG_PATH, `${lines.join("\n")}\n`, "utf8");
    return { ok: true };
  } catch {
    return { ok: false, error: "runtime_config_write_failed" };
  }
}

/** Register with the cloud proxy and get an installation token. */
export async function registerCloudToken(proxyUrl: string, secret?: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${proxyUrl.replace(/\/+$/, "")}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(secret ? { secret } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `http_${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json() as { token?: string };
    if (!data.token) return { ok: false, error: "no_token_in_response" };
    return { ok: true, token: data.token };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

const VALID_SECTIONS: MemorySection[] = ["Long-Term", "Mid-Term", "Short-Term"];
const SECTION_HEADERS: Record<MemorySection, string> = {
  "Long-Term": "## Long-Term",
  "Mid-Term": "## Mid-Term",
  "Short-Term": "## Short-Term"
};

/** Auto-prepend [YYYY-MM-DD] (×1) if entry doesn't already have a timestamp prefix. */
function ensureTimestamp(entry: string): string {
  // Already has timestamp like [2026-03-25] or [2026-03-20 → 2026-03-25]
  if (/^\[\d{4}-\d{2}-\d{2}/.test(entry)) return entry;
  const today = new Date().toISOString().slice(0, 10);
  return `[${today}] (×1) ${entry}`;
}

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

export type SocialMediaMode = "moderat" | "komplett-vermeiden";

export function readSocialMediaMode(memoryBody: string): SocialMediaMode | null {
  const lines = memoryBody.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(?:-\s*)?social[-\s]*media[-\s]*modus\s*:\s*(.+)$/i);
    if (!m) continue;
    const raw = (m[1] || "").trim().toLowerCase();
    if (!raw) continue;
    if (raw.includes("moderat") || raw.includes("moderate")) return "moderat";
    if (raw.includes("komplett") || raw.includes("vermeid") || raw.includes("avoid")) return "komplett-vermeiden";
  }

  const text = memoryBody.toLowerCase();
  const mentionsSocial = /social\s*media|youtube|tiktok|instagram|reddit|facebook|x\.com|twitter/.test(text);
  if (mentionsSocial) {
    if (/komplett\s+vermeid/.test(text) || /total\s+avoid/.test(text) || /avoid\s+social/.test(text)) {
      return "komplett-vermeiden";
    }
    if (/moderat/.test(text) || /nur\s+\d+\s*(min|minute)/.test(text)) {
      return "moderat";
    }
  }

  return null;
}
