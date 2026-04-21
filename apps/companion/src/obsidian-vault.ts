import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRAIN_PATH, DATA_DIR } from "./config.js";

export type VaultEntryType =
  | "thought"
  | "knowledge"
  | "mental_model"
  | "principle"
  | "maxim"
  | "log"
  | "limiting_step";

export interface VaultInitOptions {
  vaultPath?: string;
  importCurrentMemory?: string;
}

export interface VaultCaptureInput {
  vaultPath?: string;
  content: string;
  title?: string;
  type?: VaultEntryType;
  source?: string;
  themenpfad?: string;
  parentIndex?: string;
  relatedIndices?: string[];
  /** Raw selection / source text (shown in its own section). */
  originalSource?: string;
  /** User commentary alongside compressed KI output. */
  userNotes?: string;
  /** Model id used for compression (frontmatter + section heading). */
  aiModel?: string;
}

interface VaultEntryMeta {
  index: string;
  title: string;
  file: string;
  up: string[];
  next: string[];
  related: string[];
}

interface VaultStructure {
  entries: Record<string, VaultEntryMeta>;
}

const DEFAULT_VAULT_README = `# Brain (Spark Curiosity)

Dieses Verzeichnis ist der **Brain**-Vault (Markdown + Index). Pfad konfigurierbar: \`SPARK_BRAIN_PATH\` oder \`SPARK_OBSIDIAN_VAULT_PATH\` (Legacy).

Prinzipien fuer V1:
- alle Eintraege liegen flach in \`entries/\`
- Indexe werden regelbasiert vergeben
- \`up\`, \`next\`, \`related\` stehen im Frontmatter
- Typen bleiben wenige, sparsame Marker

Geplante Entwicklung:
- spaeter Retrieval / Embeddings
- spaeter intelligentere Klassifikation fuer parent / related
- spaeter mehr Capture-Modi fuer Wissen und Reflexion
`;

function resolveVaultPath(explicit?: string): string {
  const raw = explicit?.trim() || BRAIN_PATH;
  return raw || join(DATA_DIR, "Brain");
}

function vaultEntriesDir(vaultPath: string): string {
  return join(vaultPath, "entries");
}

function vaultSystemDir(vaultPath: string): string {
  return join(vaultPath, "system");
}

function ensureVaultDirs(vaultPath: string): void {
  mkdirSync(vaultEntriesDir(vaultPath), { recursive: true });
  mkdirSync(vaultSystemDir(vaultPath), { recursive: true });
}

function ensureSystemFiles(vaultPath: string): void {
  const readmePath = join(vaultPath, "README.md");
  if (!existsSync(readmePath)) writeFileSync(readmePath, DEFAULT_VAULT_README, "utf8");

  const statePath = join(vaultSystemDir(vaultPath), "vault-state.json");
  if (!existsSync(statePath)) {
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          schemaVersion: 1,
          mode: "background",
          layout: "flat-indexed-entries",
        },
        null,
        2
      ),
      "utf8"
    );
  }
}

function deriveTitle(content: string): string {
  const single = content
    .replace(/\r/g, "")
    .split("\n")
    .map(line => line.trim())
    .find(Boolean) || "Untitled";
  const clean = single.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 120) || "Untitled";
}

function slugifyTitle(title: string): string {
  const cleaned = title
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Untitled";
}

function parseFilename(filename: string): { index: string; title: string } | null {
  const match = filename.match(/^(\d+(?:\.\d+(?:[a-z]\d*)*)*)([A-Z]*)\s+(.+?)\.md$/);
  if (!match) return null;
  return { index: match[1] + match[2], title: match[3] };
}

function extractFrontmatterValue(raw: string, key: string): string[] {
  const match = raw.match(new RegExp(`(?:^|\\n)${key}:\\s*(.*)(?:\\n|$)`));
  const firstLine = match?.[1]?.trim();
  if (firstLine === "[]") return [];

  const blockMatch = raw.match(new RegExp(`${key}:\\s*\\n([\\s\\S]*?)(?:\\n[a-zA-Z_]+:|$)`));
  if (!blockMatch) return [];

  return blockMatch[1]
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith("- "))
    .map(line => line.slice(2).trim().replace(/^"\[\[|\]\]"$/g, ""))
    .filter(Boolean);
}

function parseFrontmatter(raw: string): { up: string[]; next: string[]; related: string[] } {
  if (!raw.startsWith("---")) return { up: [], next: [], related: [] };
  const parts = raw.split("---", 3);
  if (parts.length < 3) return { up: [], next: [], related: [] };
  const fm = parts[1];
  return {
    up: extractFrontmatterValue(fm, "up"),
    next: extractFrontmatterValue(fm, "next"),
    related: extractFrontmatterValue(fm, "related"),
  };
}

function indexSortKey(index: string): Array<number | string> {
  const match = index.match(/^(.+?)([A-Z]*)$/);
  const base = match?.[1] || index;
  const variant = match?.[2] || "";
  const out: Array<number | string> = [];
  for (const part of base.split(".")) {
    const m = part.match(/^(\d+)([a-z]*)(\d*)$/);
    if (!m) {
      out.push(0, "", 0);
      continue;
    }
    out.push(Number(m[1]), m[2] || "", m[3] ? Number(m[3]) : 0);
  }
  out.push(variant);
  return out;
}

function compareIndex(a: string, b: string): number {
  const ka = indexSortKey(a);
  const kb = indexSortKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
    const va = ka[i];
    const vb = kb[i];
    if (va === vb) continue;
    if (va === undefined) return -1;
    if (vb === undefined) return 1;
    if (typeof va === "number" && typeof vb === "number") return va - vb;
    return String(va).localeCompare(String(vb));
  }
  return 0;
}

function stripVariantSuffix(index: string): string {
  return index.replace(/[A-Z]+$/, "");
}

function isDirectChild(index: string, parentIndex: string): boolean {
  const normalized = stripVariantSuffix(index);
  if (!normalized.startsWith(parentIndex)) return false;
  let remaining = normalized.slice(parentIndex.length);
  if (remaining.startsWith(".")) remaining = remaining.slice(1);
  return /^(\d+|[a-z]\d*)$/.test(remaining);
}

function incrementIndex(index: string): string {
  const m = index.match(/^(.+?)(\d+)$/);
  if (m) return `${m[1]}${Number(m[2]) + 1}`;
  if (/[a-z]$/.test(index)) return `${index}1`;
  return `${index}1`;
}

export function findUpIndex(index: string): string | null {
  const normalized = stripVariantSuffix(index);
  const parts = normalized.split(".");
  if (parts.length === 1) return null;

  if (/\d$/.test(parts[parts.length - 1] || "")) {
    const last = parts[parts.length - 1] || "";
    if (last.length > 1 && /[a-z]\d$/.test(last)) {
      parts[parts.length - 1] = last.slice(0, -1);
    } else {
      parts.pop();
    }
  } else if (/[a-z]$/.test(parts[parts.length - 1] || "")) {
    parts[parts.length - 1] = (parts[parts.length - 1] || "").slice(0, -1);
  } else {
    parts.pop();
  }

  const result = parts.join(".");
  return result || null;
}

function scanVaultStructure(vaultPath: string): VaultStructure {
  ensureVaultDirs(vaultPath);
  const entriesDir = vaultEntriesDir(vaultPath);
  const files = readdirSync(entriesDir).filter(name => name.toLowerCase().endsWith(".md"));
  const entries: Record<string, VaultEntryMeta> = {};
  for (const file of files) {
    const parsed = parseFilename(file);
    if (!parsed) continue;
    const raw = readFileSync(join(entriesDir, file), "utf8");
    const meta = parseFrontmatter(raw);
    entries[parsed.index] = {
      index: parsed.index,
      title: parsed.title,
      file,
      up: meta.up,
      next: meta.next,
      related: meta.related,
    };
  }
  return { entries };
}

export function getNextIndex(vaultPath: string, themenpfad: string, parentIndex?: string | null): string {
  const structure = scanVaultStructure(vaultPath);
  if (parentIndex) {
    const children = Object.keys(structure.entries).filter(index =>
      index.startsWith(`${parentIndex}.`) || isDirectChild(index, parentIndex)
    );
    if (children.length) {
      children.sort(compareIndex);
      return incrementIndex(stripVariantSuffix(children[children.length - 1] || parentIndex));
    }
    if (!parentIndex.includes(".")) return `${parentIndex}.1`;
    if (/[a-z]$/.test(parentIndex)) return `${parentIndex}1`;
    return `${parentIndex}a`;
  }

  const themenpfadEntries = Object.keys(structure.entries).filter(index => index.startsWith(`${themenpfad}.`));
  if (!themenpfadEntries.length) return `${themenpfad}.1`;

  const mainIndices = Array.from(new Set(themenpfadEntries.map(index => {
    const parts = index.split(".");
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : index;
  })));
  mainIndices.sort(compareIndex);
  const last = mainIndices[mainIndices.length - 1] || `${themenpfad}.0`;
  const parts = last.split(".");
  return `${parts[0]}.${Number(parts[1] || 0) + 1}`;
}

function createFrontmatter(params: {
  type: VaultEntryType;
  source: string;
  upIndex: string | null;
  relatedIndices: string[];
  title: string;
  aiModel?: string;
}): string {
  const lines = ["---"];
  lines.push(`title: ${JSON.stringify(params.title)}`);
  lines.push(`type: ${params.type}`);
  lines.push(`created: ${new Date().toISOString()}`);
  lines.push(`source: ${JSON.stringify(params.source || "spark")}`);
  if (params.aiModel?.trim()) {
    lines.push(`ai_model: ${JSON.stringify(params.aiModel.trim())}`);
  }

  if (params.upIndex) {
    lines.push("up:");
    lines.push(`  - ${JSON.stringify(params.upIndex)}`);
  } else {
    lines.push("up: []");
  }

  lines.push("next: []");
  if (params.relatedIndices.length) {
    lines.push("related:");
    for (const related of params.relatedIndices.slice(0, 3)) {
      lines.push(`  - ${JSON.stringify(related)}`);
    }
  } else {
    lines.push("related: []");
  }
  lines.push("---");
  return lines.join("\n");
}

/** Body: optional sections for source / KI / user notes with clear markdown headings. */
export function buildVaultEntryBody(input: VaultCaptureInput): string {
  const main = (input.content || "").trim();
  const orig = (input.originalSource || "").trim();
  const notes = (input.userNotes || "").trim();
  const model = (input.aiModel || "").trim();
  if (!orig && !notes && !model) return main;

  const parts: string[] = [];
  if (orig) {
    parts.push("## Quelle (markiert)\n\n" + orig);
  }
  const head = model ? `## Komprimiert (KI: ${model})\n\n` : "## Komprimiert (KI)\n\n";
  parts.push(head + main);
  if (notes) {
    parts.push("## Deine Gedanken\n\n" + notes);
  }
  return parts.join("\n\n");
}

export function initializeVault(options: VaultInitOptions = {}): {
  ok: true;
  vaultPath: string;
  seeded: boolean;
} {
  const vaultPath = resolveVaultPath(options.vaultPath);
  ensureVaultDirs(vaultPath);
  ensureSystemFiles(vaultPath);

  let seeded = false;
  const entriesDir = vaultEntriesDir(vaultPath);
  const hasEntries = readdirSync(entriesDir).some(name => name.toLowerCase().endsWith(".md"));
  const memoryText = (options.importCurrentMemory || "").trim();
  if (!hasEntries && memoryText) {
    captureVaultEntry({
      vaultPath,
      content: memoryText,
      title: "Spark Memory Bootstrap",
      type: "log",
      source: "spark-memory-bootstrap",
      themenpfad: "1",
    });
    seeded = true;
  }

  return { ok: true, vaultPath, seeded };
}

export function getVaultStatus(vaultPathArg?: string): {
  enabled: boolean;
  path: string;
  exists: boolean;
  entries: number;
} {
  const vaultPath = resolveVaultPath(vaultPathArg);
  const exists = existsSync(vaultPath);
  const entries = exists ? Object.keys(scanVaultStructure(vaultPath).entries).length : 0;
  return {
    enabled: true,
    path: vaultPath,
    exists,
    entries,
  };
}

export function listVaultEntries(vaultPathArg?: string, limit = 50): Array<{
  index: string;
  title: string;
  file: string;
}> {
  const vaultPath = resolveVaultPath(vaultPathArg);
  if (!existsSync(vaultPath)) return [];
  return Object.values(scanVaultStructure(vaultPath).entries)
    .sort((a, b) => compareIndex(b.index, a.index))
    .slice(0, Math.max(1, Math.min(200, limit)))
    .map(entry => ({ index: entry.index, title: entry.title, file: entry.file }));
}

/** Persists one markdown file: body is `content` trimmed at edges only (no reformatting of model output). */
export function captureVaultEntry(input: VaultCaptureInput): {
  ok: true;
  vaultPath: string;
  index: string;
  file: string;
  markdown: string;
} {
  const content = (input.content || "").trim();
  if (!content) throw new Error("vault_content_required");

  const vaultPath = resolveVaultPath(input.vaultPath);
  ensureVaultDirs(vaultPath);
  ensureSystemFiles(vaultPath);

  const title = slugifyTitle(input.title?.trim() || deriveTitle(content));
  const type = input.type || "thought";
  const themenpfad = (input.themenpfad || input.parentIndex?.split(".")[0] || "1").trim();
  const parentIndex = input.parentIndex?.trim() || null;
  const index = getNextIndex(vaultPath, themenpfad, parentIndex);
  const upIndex = findUpIndex(index);
  const structure = scanVaultStructure(vaultPath);
  const relatedIndices = (input.relatedIndices || [])
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s !== upIndex && structure.entries[s])
    .slice(0, 3);

  const file = `${index} ${title}.md`;
  const filePath = join(vaultEntriesDir(vaultPath), file);
  const body = buildVaultEntryBody({ ...input, content });
  const frontmatter = createFrontmatter({
    type,
    source: input.source || "spark",
    upIndex,
    relatedIndices,
    title,
    aiModel: input.aiModel,
  });
  const markdown = `${frontmatter}\n\n${body}\n`;
  writeFileSync(filePath, markdown, "utf8");
  return { ok: true, vaultPath, index, file, markdown };
}
