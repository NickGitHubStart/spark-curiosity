import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import { spawn } from "node:child_process";
import {
  BUILD_ID, RUNTIME_ID, AI_TIMEOUT_MS, CLOUD_PROXY_URL, DATA_DIR, PORT,
  RUNTIME_CONFIG_PATH,
  currentGrokBaseUrl, currentGrokApiKey, currentGrokModel, currentModel,
  currentOpenAiApiKey, isDirectApiKey,
  GROK_INPUT_USD_PER_1M, GROK_OUTPUT_USD_PER_1M,
  compareVersions, readCurrentVersion, resolveUpdateManifestUrl,
} from "../config.js";
import { applyOnboardingTemplate, writeRuntimeConfig } from "../memory.js";
import { json, parseBody, isLoopbackRequest } from "./helpers.js";

/** Gleiche Aufloesung wie Desktop-Agent: Installer-Layout `native\\` oder Dev-Build unter apps/desktop-native/... */
export function resolveWindowsNativeExePath(): string | null {
  if (process.platform !== "win32") return null;
  const explicit = (process.env.SPARK_WINDOWS_NATIVE_EXE || "").trim();
  if (explicit) {
    const p = pathResolve(explicit);
    if (existsSync(p)) return p;
  }
  const root = process.env.SPARK_ROOT_DIR || process.cwd();
  const candidates = [
    pathResolve(root, "native", "ActiveWindowWatcher.exe"),
    pathResolve(root, "apps", "desktop-native", "windows", "ActiveWindowWatcher", "bin", "Release", "net6.0-windows", "win-x64", "publish", "ActiveWindowWatcher.exe"),
    pathResolve(root, "apps", "desktop-native", "windows", "ActiveWindowWatcher", "bin", "Release", "net6.0-windows", "win-x64", "ActiveWindowWatcher.exe"),
    pathResolve(root, "apps", "desktop-native", "windows", "ActiveWindowWatcher", "bin", "Release", "net6.0-windows", "ActiveWindowWatcher.exe")
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function fireWindowsNativePopup(kind: "quote", text: string, author?: string): { ok: boolean; error?: string; exe?: string } {
  const exe = resolveWindowsNativeExePath();
  if (!exe) return { ok: false, error: "native_exe_not_found" };
  const root = process.env.SPARK_ROOT_DIR || process.cwd();
  const iconPath = join(DATA_DIR, "assets", "icon_round.jpg");
  const args = ["--quote", text.slice(0, 260), ...(author?.trim() ? ["--author", author.trim().slice(0, 120)] : [])];
  try {
    const child = spawn(exe, args, {
      cwd: root,
      stdio: "ignore",
      detached: true,
      windowsHide: false,
      env: {
        ...process.env,
        SPARK_COMPANION_URL: process.env.SPARK_COMPANION_URL || `http://127.0.0.1:${PORT}`,
        ...(existsSync(iconPath) ? { SPARK_ICON_PATH: iconPath } : {})
      }
    });
    child.once("error", err => {
      console.warn("[spark:simulate-popup] spawn error:", err?.message || err);
    });
    child.unref();
  } catch (e) {
    return { ok: false, error: String(e), exe };
  }
  return { ok: true, exe };
}

export async function handleDesktopRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, host: url.hostname, port: PORT, provider: "grok", model: currentModel(), buildId: BUILD_ID, runtimeId: RUNTIME_ID });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/debug/runtime") {
    const proxyKey = currentGrokApiKey();
    const directOpenAi = currentOpenAiApiKey();
    const useSttProxy = Boolean(CLOUD_PROXY_URL && proxyKey && !isDirectApiKey());
    const sttReady = Boolean(useSttProxy ? proxyKey : directOpenAi);
    json(res, 200, {
      buildId: BUILD_ID, runtimeId: RUNTIME_ID, pid: process.pid,
      provider: "grok", model: currentModel(),
      aiTimeoutMs: AI_TIMEOUT_MS,
      grokInputUsdPer1m: GROK_INPUT_USD_PER_1M, grokOutputUsdPer1m: GROK_OUTPUT_USD_PER_1M,
      grokBaseUrl: currentGrokBaseUrl(), cloudProxyUrl: CLOUD_PROXY_URL || null,
      runtimeConfigPath: RUNTIME_CONFIG_PATH || null,
      grokKeyPresent: Boolean(currentGrokApiKey()), openAiKeyPresent: Boolean(currentOpenAiApiKey()),
      sttReady, sttViaProxy: useSttProxy,
      dataDir: DATA_DIR, windowsNativeExe: resolveWindowsNativeExePath()
    });
    return true;
  }

  if ((req.method === "GET" || req.method === "POST") && url.pathname === "/debug/simulate-popup") {
    if (!isLoopbackRequest(req)) { json(res, 403, { ok: false, error: "localhost_only" }); return true; }
    if (process.platform !== "win32") { json(res, 400, { ok: false, error: "windows_only" }); return true; }
    let text = "";
    let author: string | undefined;
    if (req.method === "GET") {
      text = (url.searchParams.get("text") || "").trim() || "Test – Popup simuliert von Spark Debug.";
      author = url.searchParams.get("author")?.trim() || undefined;
    } else {
      try {
        const body = await parseBody<{ text?: string; author?: string }>(req);
        text = (body.text || "").trim() || "Test – Popup simuliert von Spark Debug.";
        author = body.author?.trim() || undefined;
      } catch { json(res, 400, { ok: false, error: "bad_json" }); return true; }
    }
    const r = fireWindowsNativePopup("quote", text, author);
    json(res, r.ok ? 200 : 503, { ok: r.ok, error: r.error, exe: r.exe });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/desktop/ext-path") {
    const base = process.env.LOCALAPPDATA || "";
    if (!base) { json(res, 400, { path: null, error: "missing_localappdata" }); return true; }
    const extDir = join(base, "SparkCuriosity", "extension");
    json(res, 200, { path: extDir, exists: existsSync(extDir) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/desktop/start-overlay") {
    const exe = resolveWindowsNativeExePath();
    if (!exe) { json(res, 400, { ok: false, error: "native_exe_not_found" }); return true; }
    try {
      const root = process.env.SPARK_ROOT_DIR || process.cwd();
      const iconPath = join(DATA_DIR, "assets", "icon_round.jpg");
      const child = spawn(exe, ["--overlay"], {
        cwd: root, stdio: "ignore", detached: true, windowsHide: false,
        env: {
          ...process.env,
          SPARK_COMPANION_URL: `http://127.0.0.1:${PORT}`,
          ...(existsSync(iconPath) ? { SPARK_ICON_PATH: iconPath } : {})
        }
      });
      child.once("error", err => console.warn("[spark:start-overlay] spawn error:", err?.message || err));
      child.unref();
      json(res, 200, { ok: true, exe });
    } catch (e) {
      json(res, 500, { ok: false, error: String(e) });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/desktop/config") {
    json(res, 200, {
      provider: "grok", grokModel: currentGrokModel(),
      grokKeyPresent: Boolean(currentGrokApiKey()),
      runtimeConfigPath: RUNTIME_CONFIG_PATH || null
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/desktop/update-check") {
    const currentVersion = readCurrentVersion();
    const manifestUrl = resolveUpdateManifestUrl();
    if (!manifestUrl) {
      json(res, 200, { currentVersion, updateAvailable: false, reason: "no_manifest" });
      return true;
    }
    try {
      const resManifest = await fetch(manifestUrl, { signal: AbortSignal.timeout(3000) });
      if (!resManifest.ok) { json(res, 200, { currentVersion, updateAvailable: false, reason: `http_${resManifest.status}` }); return true; }
      const data = await resManifest.json() as { version?: string; asset?: string };
      const latestVersion = typeof data.version === "string" ? data.version : "";
      if (!latestVersion) { json(res, 200, { currentVersion, updateAvailable: false, reason: "no_version" }); return true; }
      const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
      json(res, 200, { currentVersion, latestVersion, updateAvailable, manifestUrl });
    } catch (error) {
      json(res, 200, { currentVersion, updateAvailable: false, reason: String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/desktop/setup") {
    try {
      const body = await parseBody<{ grokApiKey?: string; grokModel?: string; templateId?: string; customNotes?: string }>(req);
      if (body.grokApiKey?.trim()) {
        const writeResult = writeRuntimeConfig({
          grokApiKey: body.grokApiKey.trim(),
          grokModel: (body.grokModel || "grok-4-1-fast").trim()
        });
        if (!writeResult.ok) { json(res, 500, { error: writeResult.error }); return true; }
      }
      if (body.templateId?.trim()) {
        const applied = applyOnboardingTemplate(body.templateId.trim(), body.customNotes);
        if (!applied.ok) { json(res, 400, { error: applied.error }); return true; }
        json(res, 200, { ok: true, templateId: applied.templateId });
        return true;
      }
      json(res, 200, { ok: true, templateId: null });
    } catch (error) {
      json(res, 400, { error: String(error) });
    }
    return true;
  }

  return false;
}
