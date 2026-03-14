import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type AiProvider = "ollama" | "grok";

export const HOST = process.env.SPARK_COMPANION_HOST || "0.0.0.0";
export const PORT = Number(process.env.SPARK_COMPANION_PORT || 4343);

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

export const OLLAMA_BASE_URL = process.env.SPARK_OLLAMA_BASE_URL || "http://127.0.0.1:11434";
export const GROK_BASE_URL = process.env.SPARK_GROK_BASE_URL || "https://api.x.ai/v1";
export const WINDOWS_APP_ROOT = process.env.SPARK_WINDOWS_APP_ROOT || "";
export const RUNTIME_CONFIG_PATH = process.env.SPARK_RUNTIME_CONFIG_PATH || (WINDOWS_APP_ROOT ? join(WINDOWS_APP_ROOT, "config", "runtime.env") : "");
export const UPDATE_MANIFEST_URL = process.env.SPARK_UPDATE_MANIFEST_URL || process.env.SPARK_DIST_MANIFEST_URL || "";
export const AI_TIMEOUT_MS = Math.max(10_000, Number(process.env.SPARK_AI_TIMEOUT_MS || process.env.SPARK_OLLAMA_TIMEOUT_MS || 120_000));
export const GROK_INPUT_USD_PER_1M = Number.isFinite(Number(process.env.SPARK_GROK_INPUT_USD_PER_1M))
  ? Math.max(0, Number(process.env.SPARK_GROK_INPUT_USD_PER_1M))
  : null;
export const GROK_OUTPUT_USD_PER_1M = Number.isFinite(Number(process.env.SPARK_GROK_OUTPUT_USD_PER_1M))
  ? Math.max(0, Number(process.env.SPARK_GROK_OUTPUT_USD_PER_1M))
  : null;
export const BUILD_ID = "spark-goals-chat-v3-2026-02-20";
export const RUNTIME_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

export const DATA_DIR = findCompanionDataDir();
export const MEMORY_MD_PATH = join(DATA_DIR, "user-memory.md");
export const TEMPLATES_DIR = join(DATA_DIR, "templates");

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

export const PROMPT_DIR = findCompanionPromptDir();
export const SYSTEM_PROMPT_PATH = join(PROMPT_DIR, "agent-system-prompt.md");
export const DEFAULT_REDIRECT_URL = process.env.SPARK_FALLBACK_REDIRECT_URL || "https://todoist.com/app";

export function readRuntimeSetting(key: string): string {
  const fromFile = parseRuntimeEnvFile(RUNTIME_CONFIG_PATH)[key];
  if (typeof fromFile === "string" && fromFile.trim()) return fromFile.trim();
  return (process.env[key] || "").trim();
}

export function currentProvider(): AiProvider {
  return normalizeProvider(readRuntimeSetting("SPARK_AI_PROVIDER") || process.env.SPARK_AI_PROVIDER);
}

export function currentOllamaModel(): string {
  return readRuntimeSetting("SPARK_LOCAL_LLM_MODEL") || "phi3:mini";
}

export function currentGrokModel(): string {
  return readRuntimeSetting("SPARK_GROK_MODEL") || "grok-4-1-fast-reasoning";
}

export function currentModel(): string {
  return currentProvider() === "grok" ? currentGrokModel() : currentOllamaModel();
}

export function currentGrokApiKey(): string {
  return readRuntimeSetting("SPARK_GROK_API_KEY");
}

export function readInstallMeta(): Record<string, unknown> {
  if (!WINDOWS_APP_ROOT) return {};
  const metaPath = join(WINDOWS_APP_ROOT, "install-meta.json");
  if (!existsSync(metaPath)) return {};
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function resolveUpdateManifestUrl(): string {
  if (UPDATE_MANIFEST_URL) return UPDATE_MANIFEST_URL;
  const meta = readInstallMeta();
  const url = typeof meta.manifest_url === "string" ? meta.manifest_url : "";
  return url || "";
}

export function readCurrentVersion(): string {
  try {
    const pkgPath = join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function compareVersions(a: string, b: string): number {
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
