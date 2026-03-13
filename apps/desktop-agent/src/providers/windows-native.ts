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
          const parsed = JSON.parse(line) as { appName?: string; title?: string; url?: string | null };
          if (!parsed.appName || !parsed.title) continue;
          lastContext = {
            appName: String(parsed.appName).trim(),
            title: String(parsed.title).trim(),
            url: parsed.url ? String(parsed.url).trim() : undefined
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
  if (lastContext && Date.now() - lastUpdatedAt < 5_000) {
    return lastContext;
  }

  const raw = await runCommand(exePath, []);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { appName?: string; title?: string; url?: string | null };
    if (!parsed.appName || !parsed.title) return null;
    return {
      appName: String(parsed.appName).trim(),
      title: String(parsed.title).trim(),
      url: parsed.url ? String(parsed.url).trim() : undefined
    };
  } catch {
    return null;
  }
}
