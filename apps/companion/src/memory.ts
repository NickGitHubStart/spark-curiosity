import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MemoryEntry, MemorySnapshot, MemoryOp, MemorySection } from "@spark/shared";
import { MEMORY_MD_PATH, RUNTIME_CONFIG_PATH, TEMPLATES_DIR } from "./config.js";

const DEFAULT_MEMORY_BODY = `## Long-Term
- (leer)

## Mid-Term
- (leer)

## Short-Term
- (leer)
`;

let runtimeMemoryBody = DEFAULT_MEMORY_BODY;
let runtimeOnboardingComplete = false;
const DISK_PERSISTENCE_ENABLED = false;

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
  runtimeMemoryBody = body || DEFAULT_MEMORY_BODY;
  runtimeOnboardingComplete = onboardingComplete;
}

export function ensureFiles(): void {
  if (!DISK_PERSISTENCE_ENABLED) return;
  if (!existsSync(MEMORY_MD_PATH)) {
    const dir = dirname(MEMORY_MD_PATH);
    mkdirSync(dir, { recursive: true });
    writeFileSync(MEMORY_MD_PATH, DEFAULT_MEMORY_BODY, "utf8");
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

export function writeRuntimeConfig(config: { provider: "grok"; grokApiKey: string; grokModel: string }): { ok: true } | { ok: false; error: string } {
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
