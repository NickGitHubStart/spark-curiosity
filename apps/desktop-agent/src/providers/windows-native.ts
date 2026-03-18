import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { ActiveWindowContext } from "../domain/types.js";
import { runCommand } from "./shell.js";

function resolveDefaultPath(): string {
  const repoRoot = process.env.SPARK_ROOT_DIR || process.cwd();
  return resolve(repoRoot, "apps/desktop-native/windows/ActiveWindowWatcher/bin/Release/net6.0-windows/ActiveWindowWatcher.exe");
}

function getExePath(): string | null {
  const explicit = process.env.SPARK_WINDOWS_NATIVE_EXE || "";
  const p = explicit ? resolve(explicit) : resolveDefaultPath();
  return existsSync(p) ? p : null;
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

export async function getActiveWindowWindowsNative(): Promise<ActiveWindowContext | null> {
  const explicit = process.env.SPARK_WINDOWS_NATIVE_EXE || "";
  const exePath = explicit ? resolve(explicit) : resolveDefaultPath();
  if (!existsSync(exePath)) return null;

  startListener(exePath);
  if (lastContext && Date.now() - lastUpdatedAt < 1_000) return lastContext;

  const raw = await runCommand(exePath, []);
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
  return spawnNative(args, 2000);
}

export function showPromptDialog(question: string): Promise<boolean> {
  const safe = (question || "").trim().slice(0, 240);
  if (!safe) return Promise.resolve(false);
  return spawnNative(["--prompt", safe], 2000);
}
