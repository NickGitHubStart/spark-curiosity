import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { request } from "node:http";

const CDP_PORT = Number(process.env.SPARK_CDP_PORT || 9222);
const CDP_HOST = "127.0.0.1";

function httpGet(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: CDP_HOST, port: CDP_PORT, path, method: "GET", timeout: 1000 },
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

function httpPost(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: CDP_HOST, port: CDP_PORT, path, method: "POST", timeout: 1000 },
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
    const data = await httpGet("/json/version");
    return Boolean(data && data.includes("Browser"));
  } catch {
    return false;
  }
}

export function resolveChromeExe(): string | null {
  const env = process.env.CHROME_PATH || process.env.SPARky_CHROME_PATH;
  if (env && existsSync(env)) return env;
  const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const candidates = [
    join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

let cdpBooted = false;

export async function ensureCdpAvailable(): Promise<boolean> {
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
  // wait briefly for port to open
  for (let i = 0; i < 6; i += 1) {
    await new Promise(r => setTimeout(r, 250));
    if (await pingCdp()) return true;
  }
  return false;
}

type CdpTarget = { id?: string; url?: string; type?: string; title?: string };

export async function closeTabsByUrl(url: string): Promise<boolean> {
  if (!url) return false;
  const ok = await ensureCdpAvailable();
  if (!ok) return false;
  try {
    const data = await httpGet("/json/list");
    const list = JSON.parse(data) as CdpTarget[];
    const targetHost = new URL(url).host;
    const matches = list.filter(t => {
      if (!t.url) return false;
      try {
        return new URL(t.url).host === targetHost;
      } catch {
        return t.url.startsWith(url);
      }
    });
    let closed = false;
    for (const t of matches) {
      if (!t.id) continue;
      await httpPost(`/json/close/${t.id}`);
      closed = true;
    }
    return closed;
  } catch {
    return false;
  }
}

export async function openCdpUrl(url: string): Promise<boolean> {
  if (!url) return false;
  const ok = await ensureCdpAvailable();
  if (!ok) return false;
  try {
    await httpGet(`/json/new?${encodeURIComponent(url)}`);
    return true;
  } catch {
    return false;
  }
}

/** Check if CDP is currently reachable (without trying to launch Chrome). */
export async function isCdpReachable(): Promise<boolean> {
  return pingCdp();
}
