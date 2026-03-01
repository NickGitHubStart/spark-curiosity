import type { ActiveWindowContext } from "../domain/types.js";
import { readFileSync } from "node:fs";
import { getActiveWindowLinux } from "./linux.js";
import { getActiveWindowMac } from "./macos.js";
import { getActiveWindowWindows } from "./windows.js";

function isWsl(): boolean {
  if (Boolean(process.env.WSL_DISTRO_NAME)) return true;
  try {
    const version = readFileSync("/proc/version", "utf8").toLowerCase();
    return version.includes("microsoft");
  } catch {
    return false;
  }
}

export async function getActiveWindow(): Promise<ActiveWindowContext | null> {
  if (process.platform === "linux" && isWsl()) {
    // In WSL prefer native Windows foreground window detection.
    return getActiveWindowWindows();
  }
  if (process.platform === "linux") return getActiveWindowLinux();
  if (process.platform === "darwin") return getActiveWindowMac();
  if (process.platform === "win32") return getActiveWindowWindows();
  return null;
}
