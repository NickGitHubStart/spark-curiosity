import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { ActiveWindowContext } from "../domain/types.js";
import { runCommand } from "./shell.js";

function resolveDefaultPath(): string {
  const repoRoot = process.env.SPARK_ROOT_DIR || process.cwd();
  return resolve(repoRoot, "apps/desktop-native/windows/ActiveWindowWatcher/bin/Release/net6.0-windows/ActiveWindowWatcher.exe");
}

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
          const parsed = JSON.parse(line) as { appName?: string; title?: string; url?: string | null; hwnd?: number };
          if (!parsed.appName || !parsed.title) continue;
          lastContext = {
            appName: String(parsed.appName).trim(),
            title: String(parsed.title).trim(),
            url: parsed.url ? String(parsed.url).trim() : undefined,
            hwnd: parsed.hwnd != null ? String(parsed.hwnd) : undefined
          };
          lastUpdatedAt = Date.now();
        } catch {
          // ignore
        }
      }
    });

    child.on("exit", () => {
      listenerStarted = false;
    });
  } catch {
    listenerStarted = false;
  }
}

export async function getActiveWindowWindowsNative(): Promise<ActiveWindowContext | null> {
  const explicit = process.env.SPARK_WINDOWS_NATIVE_EXE || "";
  const exePath = explicit ? resolve(explicit) : resolveDefaultPath();
  if (!existsSync(exePath)) return null;

  startListener(exePath);
  if (lastContext && Date.now() - lastUpdatedAt < 1_000) {
    return lastContext;
  }

  const raw = await runCommand(exePath, []);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { appName?: string; title?: string; url?: string | null; hwnd?: number };
    if (!parsed.appName || !parsed.title) return null;
    return {
      appName: String(parsed.appName).trim(),
      title: String(parsed.title).trim(),
      url: parsed.url ? String(parsed.url).trim() : undefined,
      hwnd: parsed.hwnd != null ? String(parsed.hwnd) : undefined
    };
  } catch {
    return null;
  }
}

function getExePath(): string | null {
  const explicit = process.env.SPARK_WINDOWS_NATIVE_EXE || "";
  const exePath = explicit ? resolve(explicit) : resolveDefaultPath();
  return existsSync(exePath) ? exePath : null;
}

export function closeCurrentTab(hwnd?: string): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  const exePath = getExePath();
  if (!exePath) return Promise.resolve(false);
  const args = hwnd ? ["--close-tab", hwnd] : ["--close-tab"];
  return new Promise(resolve => {
    const child = spawn(exePath, args, {
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", () => resolve(false));
    child.on("exit", code => resolve(code === 0));
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve(false);
    }, 4000);
  });
}

export function closeWindow(hwnd?: string): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  const exePath = getExePath();
  if (!exePath) return Promise.resolve(false);
  const args = hwnd ? ["--close-window", hwnd] : ["--close-window"];
  return new Promise(resolve => {
    const child = spawn(exePath, args, {
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", () => resolve(false));
    child.on("exit", code => resolve(code === 0));
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve(false);
    }, 2000);
  });
}

/** Navigate browser's current tab to a new URL via Ctrl+L → paste → Enter. Much more reliable than close+open. */
export function navigateCurrentTab(hwnd: string | undefined, url: string): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  const exePath = getExePath();
  if (!exePath) return Promise.resolve(false);
  const args = ["--navigate-tab", hwnd || "0", url];
  return new Promise(resolve => {
    const child = spawn(exePath, args, {
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", () => resolve(false));
    child.on("exit", code => resolve(code === 0));
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve(false);
    }, 5000);
  });
}

export function showQuoteToast(text: string, author?: string): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  const exePath = getExePath();
  if (!exePath) return Promise.resolve(false);
  const safeText = (text || "").trim().slice(0, 260);
  if (!safeText) return Promise.resolve(false);
  const args = ["--quote", safeText];
  if (author && author.trim()) {
    args.push("--author", author.trim().slice(0, 120));
  }
  return new Promise(resolve => {
    const child = spawn(exePath, args, {
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", () => resolve(false));
    child.on("exit", code => resolve(code === 0));
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve(false);
    }, 2000);
  });
}

export function showPromptDialog(question: string): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  const exePath = getExePath();
  if (!exePath) return Promise.resolve(false);
  const safeQuestion = (question || "").trim().slice(0, 240);
  if (!safeQuestion) return Promise.resolve(false);
  const args = ["--prompt", safeQuestion];
  return new Promise(resolve => {
    const child = spawn(exePath, args, {
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", () => resolve(false));
    child.on("exit", code => resolve(code === 0));
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve(false);
    }, 2000);
  });
}
