import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MemoryEntry, MemorySnapshot, MemoryOp, MemorySection } from "@spark/shared";
import {
  DEFAULT_MEMORY_BODY,
  parseMemoryMarkdown,
  serializeMemoryToMarkdown,
  applyMemoryOps,
  extractMemoryMarkdown,
  extractMemoryOps,
  buildWelcome,
} from "@spark/shared";
import { MEMORY_MD_PATH, RUNTIME_CONFIG_PATH, TEMPLATES_DIR, CLOUD_PROXY_URL, currentGrokApiKey, normalizeGrokModelName } from "./config.js";

// Re-export for consumers that import from memory.ts
export { applyMemoryOps, extractMemoryMarkdown, extractMemoryOps, parseMemoryMarkdown, serializeMemoryToMarkdown };

let runtimeMemoryBody = DEFAULT_MEMORY_BODY;
let runtimeOnboardingComplete = false;
let runtimeWelcomeShown = false;
let runtimeTemplateId: string | null = null;
let runtimeTemplateVersion: number | null = null;
const DISK_PERSISTENCE_ENABLED = true;

/** Serialize memory file with YAML frontmatter (installer reads onboardingComplete from disk). */
export function formatMemoryFile(body: string, onboardingComplete: boolean, meta?: { templateId?: string; templateVersion?: number }): string {
  const b = (body || "").trim() || DEFAULT_MEMORY_BODY.trim();
  const lines = [`onboardingComplete: ${onboardingComplete}`];
  if (meta?.templateId) lines.push(`templateId: ${meta.templateId}`);
  if (meta?.templateVersion != null) lines.push(`templateVersion: ${meta.templateVersion}`);
  return `---\n${lines.join("\n")}\n---\n\n${b}\n`;
}

export interface MemoryFileMeta {
  onboardingComplete: boolean | null;
  templateId: string | null;
  templateVersion: number | null;
  body: string;
}

/** Parse frontmatter + markdown body from disk. */
export function parseMemoryFileRaw(raw: string): MemoryFileMeta {
  const trimmed = raw.trim();
  const fmMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) return { onboardingComplete: null, templateId: null, templateVersion: null, body: raw };
  const meta: Record<string, string> = {};
  for (const line of fmMatch[1].split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const ob = meta.onboardingcomplete;
  const oc = ob === undefined ? null : (ob === "true" || ob === "1" || ob.toLowerCase() === "yes");
  const templateId = meta.templateid || null;
  const tv = meta.templateversion;
  const templateVersion = tv ? parseInt(tv, 10) : null;
  return { onboardingComplete: oc, templateId, templateVersion: Number.isNaN(templateVersion) ? null : templateVersion, body: fmMatch[2] };
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
      runtimeTemplateId = parsed.templateId;
      runtimeTemplateVersion = parsed.templateVersion;
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

export function writeMemoryFile(body: string, onboardingComplete: boolean, meta?: { templateId?: string; templateVersion?: number }): void {
  const stripped = stripLeadingFrontmatterFromBody(body || "");
  runtimeMemoryBody = stripped || DEFAULT_MEMORY_BODY;
  runtimeOnboardingComplete = onboardingComplete;
  if (meta?.templateId !== undefined) runtimeTemplateId = meta.templateId;
  if (meta?.templateVersion !== undefined) runtimeTemplateVersion = meta.templateVersion;
  if (DISK_PERSISTENCE_ENABLED) {
    ensureFiles();
    try {
      writeFileSync(MEMORY_MD_PATH, formatMemoryFile(runtimeMemoryBody, onboardingComplete, {
        templateId: runtimeTemplateId ?? undefined,
        templateVersion: runtimeTemplateVersion ?? undefined,
      }), "utf8");
    } catch {
      // ignore
    }
  }
  // Fire-and-forget: push to cloud so Android sees the same memory
  void syncMemoryToCloud(runtimeMemoryBody, onboardingComplete);
}

/** Debounced cloud push — avoids flooding the API when multiple ops fire in quick succession. */
let _cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingBody: string | null = null;
let _pendingOnboarding = false;

async function syncMemoryToCloud(body: string, onboardingComplete: boolean): Promise<void> {
  _pendingBody = body;
  _pendingOnboarding = onboardingComplete;
  if (_cloudSyncTimer) return; // already scheduled
  _cloudSyncTimer = setTimeout(async () => {
    _cloudSyncTimer = null;
    const b = _pendingBody;
    const oc = _pendingOnboarding;
    _pendingBody = null;
    if (!b || !CLOUD_PROXY_URL) return;
    const token = currentGrokApiKey();
    if (!token) return;
    try {
      const { pushEncryptedMemory } = await import("./cloud-memory.js");
      await pushEncryptedMemory(token, b, oc);
    } catch {
      // best-effort — don't crash companion if cloud is unreachable
    }
  }, 2000);
}

/**
 * Pull the latest memory from cloud and overwrite local state if the content differs.
 * Called on startup and every 2 minutes so that phone-side memory changes are visible to
 * the PC agent without requiring a full restart.
 * Deliberately does NOT call writeMemoryFile (which would push back to cloud and loop).
 */
export async function syncFromCloud(): Promise<boolean> {
  const token = currentGrokApiKey();
  if (!token || !CLOUD_PROXY_URL) return false;
  try {
    const { fetchEncryptedMemory } = await import("./cloud-memory.js");
    const remote = await fetchEncryptedMemory(token);
    if (!remote || !remote.body?.trim()) return false;
    const stripped = stripLeadingFrontmatterFromBody(remote.body);
    if (stripped.trim() === runtimeMemoryBody.trim()) return false;
    runtimeMemoryBody = stripped || DEFAULT_MEMORY_BODY;
    runtimeOnboardingComplete = remote.onboardingComplete;
    if (DISK_PERSISTENCE_ENABLED) {
      ensureFiles();
      try {
        writeFileSync(MEMORY_MD_PATH, formatMemoryFile(runtimeMemoryBody, runtimeOnboardingComplete, {
          templateId: runtimeTemplateId ?? undefined,
          templateVersion: runtimeTemplateVersion ?? undefined,
        }), "utf8");
      } catch { /* ignore disk errors */ }
    }
    console.log("[spark:cloud-memory] Pulled updated memory from cloud (cross-device sync)");
    return true;
  } catch {
    return false;
  }
}

/** Returns a welcome message once after onboarding completes, then null forever. */
export function consumeWelcome(): string | null {
  if (runtimeWelcomeShown || !runtimeOnboardingComplete) return null;
  runtimeWelcomeShown = true;
  const { body } = readMemoryFile();
  return buildWelcome(body);
}

export function ensureFiles(): void {
  if (!existsSync(MEMORY_MD_PATH)) {
    const dir = dirname(MEMORY_MD_PATH);
    mkdirSync(dir, { recursive: true });
    writeFileSync(MEMORY_MD_PATH, formatMemoryFile(DEFAULT_MEMORY_BODY.trim(), false), "utf8");
  }
}

/** Infer which template was used by matching known markers in memory body. */
function inferTemplateId(body: string): string | null {
  try {
    mkdirSync(TEMPLATES_DIR, { recursive: true });
    const files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith(".md"));
    // Score each template by how many of its default entries appear in the user's memory
    let bestId: string | null = null;
    let bestScore = 0;
    for (const f of files) {
      try {
        const tpl = readTemplateFile(join(TEMPLATES_DIR, f));
        const tplParsed = parseMemoryMarkdown(tpl.body);
        const tplEntries = [...tplParsed.longTerm, ...tplParsed.midTerm, ...tplParsed.shortTerm];
        let score = 0;
        for (const e of tplEntries) {
          if (body.includes(e.text.slice(0, 40))) score++;
        }
        if (score > bestScore) { bestScore = score; bestId = tpl.id; }
      } catch { /* skip */ }
    }
    return bestScore >= 2 ? bestId : null;
  } catch { return null; }
}

/**
 * Migrate template preambles on upgrade.
 * Compares the user's templateVersion with the bundled template's version.
 * If the template is newer: keeps all user entries, replaces preambles with the new template's preambles.
 * Safe to call on every startup — no-ops when versions match or no template is set.
 */
export function migrateTemplateIfNeeded(): void {
  try {
    const raw = readFileSync(MEMORY_MD_PATH, "utf8");
    const fileMeta = parseMemoryFileRaw(raw);
    const body = stripLeadingFrontmatterFromBody(fileMeta.body || "");

    // Legacy users: infer templateId from memory content if not set
    if (!fileMeta.templateId) {
      if (!fileMeta.onboardingComplete) return; // not onboarded yet
      const inferred = inferTemplateId(body);
      if (!inferred) return; // can't determine which template
      fileMeta.templateId = inferred;
      fileMeta.templateVersion = 0; // force first migration
      console.log(`[spark:memory] inferred templateId="${inferred}" for legacy user`);
    }
    const userVersion = fileMeta.templateVersion ?? 0;

    const templatePath = join(TEMPLATES_DIR, `${fileMeta.templateId}.md`);
    if (!existsSync(templatePath)) return; // template file missing
    const tpl = readTemplateFile(templatePath);
    if (tpl.version <= userVersion) return; // already up to date

    // Parse user memory: keep their entries, take new preambles from template
    const userParsed = parseMemoryMarkdown(body);
    const tplParsed = parseMemoryMarkdown(tpl.body);

    const migrated = serializeMemoryToMarkdown(
      { longTerm: userParsed.longTerm, midTerm: userParsed.midTerm, shortTerm: userParsed.shortTerm },
      tplParsed.preambles // new preambles from updated template
    );

    const onboardingComplete = fileMeta.onboardingComplete ?? runtimeOnboardingComplete;
    writeMemoryFile(migrated, onboardingComplete, { templateId: fileMeta.templateId, templateVersion: tpl.version });
    console.log(`[spark:memory] template migrated: ${fileMeta.templateId} v${userVersion} → v${tpl.version} (preambles updated, entries preserved)`);
  } catch (err) {
    console.warn("[spark:memory] template migration skipped:", err);
  }
}

function readTemplateFile(filePath: string): { id: string; version: number; name: string; description: string; highlights: string[]; body: string } {
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
  const version = parseInt(meta.version || "0", 10);
  return {
    id: meta.id || stem,
    version: Number.isNaN(version) ? 0 : version,
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
    writeMemoryFile(memoryBody, true, { templateId: t.id, templateVersion: t.version });
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
    existing["SPARK_MODEL"] = normalizeGrokModelName(config.grokModel);
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

/** Every N Grok calls that embed system memory (EVENT_DECISION / CHAT), run MEMORY_CLEANUP. Not counted: cleanup, brain, curated, etc. */
const MEMORY_CLEANUP_EVERY_N_GROK_CALLS = 50;
let grokCallsSinceMemoryCleanup = 0;
let memoryCleanupRunning = false;

export function bumpGrokCallForMemoryCleanup(): void {
  grokCallsSinceMemoryCleanup += 1;
  if (grokCallsSinceMemoryCleanup < MEMORY_CLEANUP_EVERY_N_GROK_CALLS || memoryCleanupRunning) return;
  grokCallsSinceMemoryCleanup = 0;
  memoryCleanupRunning = true;
  void runMemoryCleanupJob();
}

async function runMemoryCleanupJob(): Promise<void> {
  try {
    const { runAiMemoryCleanup } = await import("./ai.js");
    const { body: memBody, onboardingComplete } = readMemoryFile();
    const result = await runAiMemoryCleanup(memBody);
    if (result.memoryOps?.length) {
      const updated = applyMemoryOps(memBody, result.memoryOps);
      if (updated !== memBody) writeMemoryFile(updated, onboardingComplete);
    } else if (result.memoryMarkdown) {
      writeMemoryFile(result.memoryMarkdown, onboardingComplete);
    }
  } catch {
    /* best-effort */
  } finally {
    memoryCleanupRunning = false;
  }
}
