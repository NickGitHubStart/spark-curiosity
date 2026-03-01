import type { ActiveWindowContext } from "../domain/types.js";
import { runCommand } from "./shell.js";

function extractQuoted(text: string): string | null {
  const match = text.match(/=\s*\"(.*)\"$/);
  if (!match) return null;
  return match[1].trim();
}

export async function getActiveWindowLinux(): Promise<ActiveWindowContext | null> {
  const winId = await runCommand("xdotool", ["getactivewindow"]);
  if (winId) {
    const title = (await runCommand("xdotool", ["getwindowname", winId])) || "(unknown window)";
    const pid = await runCommand("xdotool", ["getwindowpid", winId]);
    const appName = pid ? ((await runCommand("ps", ["-p", pid, "-o", "comm="])) || "unknown-app") : "unknown-app";
    return { appName, title };
  }

  // Fallback path for systems without xdotool.
  const activeRoot = await runCommand("xprop", ["-root", "_NET_ACTIVE_WINDOW"]);
  const activeWindowId = activeRoot?.split(/\s+/).at(-1);
  if (!activeWindowId || activeWindowId === "0x0") return null;

  const nameRaw = await runCommand("xprop", ["-id", activeWindowId, "_NET_WM_NAME"]);
  const title = extractQuoted(nameRaw || "") || "(unknown window)";

  const pidRaw = await runCommand("xprop", ["-id", activeWindowId, "_NET_WM_PID"]);
  const pid = pidRaw?.trim().split(/\s+/).at(-1);
  const appName = pid ? ((await runCommand("ps", ["-p", pid, "-o", "comm="])) || "unknown-app") : "unknown-app";

  return { appName, title };
}
