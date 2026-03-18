import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { request } from "node:http";

const CDP_PORT = Number(process.env.SPARK_CDP_PORT || 9222);
const CDP_HOST = "127.0.0.1";

function cdpRequest(method: "GET" | "POST", path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: CDP_HOST, port: CDP_PORT, path, method, timeout: 1000 },
      res => {
        let data = "";
        res.on("data", chunk => { data += String(chunk); });
        res.on("end", () => resolve(data));
      }
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("cdp_timeout")); });
    req.on("error", reject);
    req.end();
  });
}

async function pingCdp(): Promise<boolean> {
  try {
    const data = await cdpRequest("GET", "/json/version");
    return Boolean(data && data.includes("Browser"));
  } catch {
    return false;
  }
}

export function resolveChromeExe(): string | null {
  const env = process.env.CHROME_PATH || process.env.SPARK_CHROME_PATH;
  if (env && existsSync(env)) return env;
  const pf = process.env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  for (const p of [
    join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(pf86, "Microsoft", "Edge", "Application", "msedge.exe")
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

let cdpBooted = false;

async function ensureCdp(): Promise<boolean> {
  if (await pingCdp()) return true;
  if (cdpBooted) return false;

  const exe = resolveChromeExe();
  if (!exe) return false;

  const userDir = process.env.SPARK_CDP_PROFILE_DIR
    || join(process.env.LOCALAPPDATA || "C:\\Users\\Default\\AppData\\Local", "SparkCuriosity", "chrome-cdp");

  spawn(exe, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDir}`,
    "--no-first-run",
    "--no-default-browser-check"
  ], { detached: true, stdio: "ignore" }).unref();

  cdpBooted = true;
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (await pingCdp()) return true;
  }
  return false;
}

// ── Public API ──

type CdpTarget = { id?: string; url?: string; type?: string; title?: string };

export async function closeTabsByUrl(url: string): Promise<boolean> {
  if (!url || !(await ensureCdp())) return false;
  try {
    const list = JSON.parse(await cdpRequest("GET", "/json/list")) as CdpTarget[];
    // Match by host: a redirect to the curated page may land on a different path
    const host = new URL(url).host;
    const matches = list.filter(t => {
      try { return t.url ? new URL(t.url).host === host : false; } catch { return false; }
    });
    let closed = false;
    for (const t of matches) {
      if (!t.id) continue;
      await cdpRequest("POST", `/json/close/${t.id}`);
      closed = true;
    }
    return closed;
  } catch {
    return false;
  }
}

export async function openCdpUrl(url: string): Promise<boolean> {
  if (!url || !(await ensureCdp())) return false;
  try {
    await cdpRequest("GET", `/json/new?${encodeURIComponent(url)}`);
    return true;
  } catch {
    return false;
  }
}
