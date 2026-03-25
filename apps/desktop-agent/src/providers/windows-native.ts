import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { ActiveWindowContext } from "../domain/types.js";
import { runCommand } from "./shell.js";

// Cache resolved path; null means "not yet found" (retry on next call)
let cachedExePath: string | null | undefined;

function getExePath(): string | null {
  if (cachedExePath) return cachedExePath;

  const explicit = process.env.SPARK_WINDOWS_NATIVE_EXE || "";
  if (explicit) {
    const p = resolve(explicit);
    if (existsSync(p)) { cachedExePath = p; return p; }
    return null;
  }
  const root = process.env.SPARK_ROOT_DIR || process.cwd();
  const candidates = [
    resolve(root, "native/ActiveWindowWatcher.exe"),
    // Self-contained publish (win-x64 RID) → preferred in dev
    resolve(root, "apps/desktop-native/windows/ActiveWindowWatcher/bin/Release/net6.0-windows/win-x64/publish/ActiveWindowWatcher.exe"),
    resolve(root, "apps/desktop-native/windows/ActiveWindowWatcher/bin/Release/net6.0-windows/win-x64/ActiveWindowWatcher.exe"),
    // Legacy framework-dependent path (may be stale)
    resolve(root, "apps/desktop-native/windows/ActiveWindowWatcher/bin/Release/net6.0-windows/ActiveWindowWatcher.exe"),
  ];
  // Diagnostic: log each candidate and whether it exists (once)
  console.log(`[spark:native:diag] SPARK_ROOT_DIR="${root}", cwd="${process.cwd()}", candidates:`);
  for (const c of candidates) {
    console.log(`[spark:native:diag]   ${c} → exists=${existsSync(c)}`);
  }
  const found = candidates.find(p => existsSync(p)) ?? null;
  if (found) cachedExePath = found;
  return found;
}

/** Spawn a native command, resolve true on exit code 0, false on error/timeout. */
function spawnNative(args: string[], timeoutMs: number): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  const exePath = getExePath();
  if (!exePath) return Promise.resolve(false);
  return new Promise(res => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; res(ok); } };
    const child = spawn(exePath, args, { stdio: "ignore", windowsHide: true });
    child.on("error", () => done(false));
    child.on("exit", code => done(code === 0));
    setTimeout(() => { try { child.kill(); } catch {} done(false); }, timeoutMs);
  });
}

// ── Persistent listener for active window context ──

let listenerStarted = false;
let lastContext: ActiveWindowContext | null = null;
let lastUpdatedAt = 0;

function startListener(exePath: string): void {
  if (listenerStarted) return;
  listenerStarted = true;
  try {
    const child = spawn(exePath, ["--watch"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    });
    let buffer = "";
    child.stdout?.on("data", chunk => {
      buffer += String(chunk);
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const p = JSON.parse(line) as { appName?: string; title?: string; url?: string | null; hwnd?: number };
          if (!p.appName || !p.title) continue;
          lastContext = {
            appName: String(p.appName).trim(),
            title: String(p.title).trim(),
            url: p.url ? String(p.url).trim() : undefined,
            hwnd: p.hwnd != null ? String(p.hwnd) : undefined
          };
          lastUpdatedAt = Date.now();
        } catch { /* ignore malformed lines */ }
      }
    });
    child.on("exit", () => { listenerStarted = false; });
  } catch {
    listenerStarted = false;
  }
}

function parseContext(raw: string): ActiveWindowContext | null {
  try {
    const p = JSON.parse(raw) as { appName?: string; title?: string; url?: string | null; hwnd?: number };
    if (!p.appName || !p.title) return null;
    return {
      appName: String(p.appName).trim(),
      title: String(p.title).trim(),
      url: p.url ? String(p.url).trim() : undefined,
      hwnd: p.hwnd != null ? String(p.hwnd) : undefined
    };
  } catch {
    return null;
  }
}

let nativeLoggedOnce = false;

export async function getActiveWindowWindowsNative(): Promise<ActiveWindowContext | null> {
  const exePath = getExePath();
  if (!exePath) {
    if (!nativeLoggedOnce) {
      nativeLoggedOnce = true;
      const root = process.env.SPARK_ROOT_DIR || process.cwd();
      console.warn(`[spark:native] ActiveWindowWatcher.exe NOT found. SPARK_ROOT_DIR=${root}, checked: native/ActiveWindowWatcher.exe, apps/.../bin/Release/.../ActiveWindowWatcher.exe → falling back to PowerShell`);
    }
    return null;
  }
  if (!nativeLoggedOnce) {
    nativeLoggedOnce = true;
    console.log(`[spark:native] using ActiveWindowWatcher.exe at ${exePath}`);
  }

  startListener(exePath);
  if (lastContext && Date.now() - lastUpdatedAt < 1_000) return lastContext;

  // Self-contained .NET exe needs extra time on first run (runtime extraction)
  const raw = await runCommand(exePath, [], 5000);
  return raw ? parseContext(raw) : null;
}

// ── Tab/window control ──

export function closeCurrentTab(hwnd?: string): Promise<boolean> {
  return spawnNative(hwnd ? ["--close-tab", hwnd] : ["--close-tab"], 4000);
}

export function closeWindow(hwnd?: string): Promise<boolean> {
  return spawnNative(hwnd ? ["--close-window", hwnd] : ["--close-window"], 2000);
}

export function navigateCurrentTab(hwnd: string | undefined, url: string): Promise<boolean> {
  return spawnNative(["--navigate-tab", hwnd || "0", url], 5000);
}

// ── UI helpers ──

export function showQuoteToast(text: string, author?: string): Promise<boolean> {
  const safe = (text || "").trim().slice(0, 260);
  if (!safe) return Promise.resolve(false);
  const args = ["--quote", safe];
  if (author?.trim()) args.push("--author", author.trim().slice(0, 120));
  // Toast stays visible for up to 60s — don't kill it early.
  // Fire-and-forget: detach the child so it lives independently.
  if (process.platform !== "win32") return Promise.resolve(false);
  const exePath = getExePath();
  if (!exePath) return Promise.resolve(false);
  try {
    const child = spawn(exePath, args, { stdio: "ignore", windowsHide: true, detached: true });
    child.unref();
    return Promise.resolve(true);
  } catch { return Promise.resolve(false); }
}

export function showPromptDialog(question: string): Promise<boolean> {
  const safe = (question || "").trim().slice(0, 240);
  if (!safe) return Promise.resolve(false);
  return spawnNative(["--prompt", safe], 2000);
}
