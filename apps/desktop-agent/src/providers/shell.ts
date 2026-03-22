import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runCommand(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 2500, windowsHide: true });
    const text = String(stdout || "").trim();
    return text || null;
  } catch {
    return null;
  }
}
