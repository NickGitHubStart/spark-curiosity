import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ActiveWindowContext } from "../domain/types.js";
import { runCommand } from "./shell.js";

function resolveDefaultPath(): string {
  const repoRoot = process.env.SPARK_ROOT_DIR || process.cwd();
  return resolve(repoRoot, "apps/desktop-native/windows/ActiveWindowWatcher/bin/Release/net6.0-windows/ActiveWindowWatcher.exe");
}

export async function getActiveWindowWindowsNative(): Promise<ActiveWindowContext | null> {
  const explicit = process.env.SPARK_WINDOWS_NATIVE_EXE || "";
  const exePath = explicit ? resolve(explicit) : resolveDefaultPath();
  if (!existsSync(exePath)) return null;

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
