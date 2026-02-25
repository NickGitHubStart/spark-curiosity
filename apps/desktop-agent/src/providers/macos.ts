import type { ActiveWindowContext } from "../domain/types.js";
import { runCommand } from "./shell.js";

export async function getActiveWindowMac(): Promise<ActiveWindowContext | null> {
  const script = [
    'tell application "System Events"',
    '  set frontApp to first application process whose frontmost is true',
    '  set appName to name of frontApp',
    '  set winTitle to ""',
    '  try',
    '    set winTitle to name of front window of frontApp',
    '  end try',
    'end tell',
    'return appName & "\\t" & winTitle'
  ];

  const raw = await runCommand("osascript", script.flatMap(line => ["-e", line]));
  if (!raw) return null;

  const [appNameRaw, titleRaw] = raw.split("\t");
  const appName = (appNameRaw || "unknown-app").trim();
  const title = (titleRaw || "(unknown window)").trim();

  let url: string | undefined;
  if (/safari/i.test(appName)) {
    const safariUrl = await runCommand("osascript", ["-e", 'tell application "Safari" to try', "-e", "URL of front document", "-e", "end try"]);
    if (safariUrl?.startsWith("http")) url = safariUrl;
  }
  if (!url && /(google chrome|chromium|arc|brave)/i.test(appName)) {
    const chromeUrl = await runCommand("osascript", ["-e", 'tell application "Google Chrome" to try', "-e", "URL of active tab of front window", "-e", "end try"]);
    if (chromeUrl?.startsWith("http")) url = chromeUrl;
  }

  return { appName, title, url };
}
