import type { ActiveWindowContext } from "../domain/types.js";
import { runCommand } from "./shell.js";

export async function getActiveWindowLinux(): Promise<ActiveWindowContext | null> {
  const winId = await runCommand("xdotool", ["getactivewindow"]);
  if (!winId) return null;

  const title = (await runCommand("xdotool", ["getwindowname", winId])) || "(unknown window)";
  const pid = await runCommand("xdotool", ["getwindowpid", winId]);
  const appName = pid ? ((await runCommand("ps", ["-p", pid, "-o", "comm="])) || "unknown-app") : "unknown-app";
  return { appName, title };
}
