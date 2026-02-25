import type { ActiveWindowContext } from "../domain/types.js";
import { getActiveWindowLinux } from "./linux.js";
import { getActiveWindowMac } from "./macos.js";
import { getActiveWindowWindows } from "./windows.js";

export async function getActiveWindow(): Promise<ActiveWindowContext | null> {
  if (process.platform === "linux") return getActiveWindowLinux();
  if (process.platform === "darwin") return getActiveWindowMac();
  if (process.platform === "win32") return getActiveWindowWindows();
  return null;
}
