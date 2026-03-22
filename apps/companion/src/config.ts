import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Parse an env file and inject non-empty values into process.env (won't overwrite existing). */
function loadEnvFile(filePath: string): void {
  if (!filePath || !existsSync(filePath)) return;
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx <= 0) continue;
      const key = t.slice(0, idx).trim();
      let value = t.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"');
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/\\'/g, "'");
      if (key && value && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* ignore */
  }
}

function resolveRootDir(): string {
  return (
    process.env.SPARK_ROOT_DIR ||
    process.cwd() ||
    (() => {
      try {
        return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
      } catch {
        return process.cwd();
      }
    })()
  );
}

const ROOT_DIR = resolveRootDir();

/** Load .env and config/runtime.env from project root into process.env. */
function loadAllEnvFiles(): void {
  loadEnvFile(join(ROOT_DIR, ".env"));
  // Installed apps keep config in <root>/config/runtime.env
  loadEnvFile(join(ROOT_DIR, "config", "runtime.env"));
  // Also check SPARK_RUNTIME_CONFIG_PATH / SPARK_WINDOWS_APP_ROOT derived path
  const explicitPath = process.env.SPARK_RUNTIME_CONFIG_PATH || "";
  if (explicitPath) loadEnvFile(explicitPath);
  const appRoot = process.env.SPARK_WINDOWS_APP_ROOT || "";
  if (appRoot) loadEnvFile(join(appRoot, "config", "runtime.env"));
}
loadAllEnvFiles();

export const HOST = process.env.SPARK_COMPANION_HOST || "0.0.0.0";
export const PORT = Number(process.env.SPARK_COMPANION_PORT || 4343);

/** Parse KEY=VALUE pairs from a file (reads fresh from disk each call). */
function parseEnvFileToRecord(path: string): Record<string, string> {
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

export const CLOUD_PROXY_URL = process.env.SPARK_CLOUD_PROXY_URL || "";
export const CLOUD_REGISTER_SECRET = process.env.SPARK_CLOUD_REGISTER_SECRET || "";
export const DISCORD_BUG_WEBHOOK_URL = process.env.SPARK_DISCORD_BUG_WEBHOOK || "";

/** True when the current API key is a direct vendor key (xai-…), not a cloud proxy token. */
export function isDirectApiKey(): boolean {
  const key = currentGrokApiKey();
  return key.startsWith("xai-") || key.startsWith("sk-");
}

/** Derive the base URL for AI/STT calls. Uses proxy only with proxy tokens, not direct keys. */
export function currentGrokBaseUrl(): string {
  if (CLOUD_PROXY_URL && !isDirectApiKey()) return `${CLOUD_PROXY_URL.replace(/\/+$/, "")}/v1`;
  return "https://api.x.ai/v1";
}
export const WINDOWS_APP_ROOT = process.env.SPARK_WINDOWS_APP_ROOT || "";

function resolveRuntimeConfigPath(): string {
  if (process.env.SPARK_RUNTIME_CONFIG_PATH) return process.env.SPARK_RUNTIME_CONFIG_PATH;
  if (WINDOWS_APP_ROOT) return join(WINDOWS_APP_ROOT, "config", "runtime.env");
  // Installed apps: <root>/config/runtime.env
  const fromRoot = join(ROOT_DIR, "config", "runtime.env");
  if (existsSync(fromRoot)) return fromRoot;
  return "";
}
export const RUNTIME_CONFIG_PATH = resolveRuntimeConfigPath();
export const UPDATE_MANIFEST_URL = process.env.SPARK_UPDATE_MANIFEST_URL || process.env.SPARK_DIST_MANIFEST_URL || "";
export const AI_TIMEOUT_MS = Math.max(10_000, Number(process.env.SPARK_AI_TIMEOUT_MS || 120_000));
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
  const fromFile = parseEnvFileToRecord(RUNTIME_CONFIG_PATH)[key];
  if (typeof fromFile === "string" && fromFile.trim()) return fromFile.trim();
  return (process.env[key] || "").trim();
}

/** Default: non-reasoning fast model (lower latency/cost for routing/classification). */
export const GROK_MODEL_NON_REASONING = "grok-4-1-fast";

/** Map legacy reasoning SKU to non-reasoning; pass through any other explicit model name. */
export function normalizeGrokModelName(raw: string): string {
  const t = (raw || "").trim();
  if (t === "grok-4-1-fast-reasoning") return GROK_MODEL_NON_REASONING;
  return t || GROK_MODEL_NON_REASONING;
}

export function currentGrokModel(): string {
  return normalizeGrokModelName(readRuntimeSetting("SPARK_GROK_MODEL") || GROK_MODEL_NON_REASONING);
}

export function currentModel(): string {
  return currentGrokModel();
}

export function currentGrokApiKey(): string {
  return readRuntimeSetting("SPARK_GROK_API_KEY");
}

/** OpenAI API key. Prefer SPARK_OPENAI_API_KEY, then OPENAI_API_KEY. */
export function currentOpenAiApiKey(): string {
  return (readRuntimeSetting("SPARK_OPENAI_API_KEY") || process.env.OPENAI_API_KEY || "").trim();
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
