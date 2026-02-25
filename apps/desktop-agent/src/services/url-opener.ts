import { runCommand } from "../providers/shell.js";

export async function openExternalUrl(url: string): Promise<boolean> {
  if (!url.startsWith("http")) return false;

  if (process.platform === "darwin") {
    return Boolean(await runCommand("open", [url]));
  }
  if (process.platform === "win32") {
    return Boolean(await runCommand("cmd", ["/c", "start", "", url]));
  }
  return Boolean(await runCommand("xdg-open", [url]));
}
