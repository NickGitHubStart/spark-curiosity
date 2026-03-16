import { runCommand } from "../providers/shell.js";

export async function openExternalUrl(url: string): Promise<boolean> {
  const target = url?.trim();
  if (!target) return false;

  if (process.platform === "darwin") {
    return Boolean(await runCommand("open", [target]));
  }
  if (process.platform === "win32") {
    return Boolean(await runCommand("cmd", ["/c", "start", "", target]));
  }
  return Boolean(await runCommand("xdg-open", [target]));
}
