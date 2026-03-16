import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolveChromeExe } from "./chrome-cdp.js";

type InstallResult = { ok: true; id: string; needsRestart: boolean } | { ok: false; reason: string };

function appDataRoot(): string {
  return process.env.LOCALAPPDATA || "C:\\Users\\Default\\AppData\\Local";
}

function extRoot(): string {
  return join(appDataRoot(), "SparkCuriosity", "extension");
}

function srcRoot(): string {
  return join(process.cwd(), "apps", "desktop-agent", "extension");
}

function ensureCopied(): string {
  const dest = extRoot();
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(srcRoot(), "manifest.json"), join(dest, "manifest.json"));
  copyFileSync(join(srcRoot(), "service_worker.js"), join(dest, "service_worker.js"));
  return dest;
}

function readManifestVersion(dir: string): string {
  try {
    const raw = readFileSync(join(dir, "manifest.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function pemToId(pem: string): string {
  const body = pem.replace(/-----BEGIN[\s\S]+?-----/g, "")
    .replace(/-----END[\s\S]+?-----/g, "")
    .replace(/\s+/g, "");
  const der = Buffer.from(body, "base64");
  const hash = createHash("sha256").update(der).digest("hex").slice(0, 32);
  const map = (c: string) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16));
  return hash.split("").map(map).join("");
}

function packExtension(chromeExe: string, dir: string, keyPath: string): { crxPath: string; keyPath: string } | null {
  if (!existsSync(keyPath)) {
    const res = spawnSync(chromeExe, [`--pack-extension=${dir}`], { windowsHide: true });
    if (res.error) return null;
  } else {
    const res = spawnSync(chromeExe, [`--pack-extension=${dir}`, `--pack-extension-key=${keyPath}`], { windowsHide: true });
    if (res.error) return null;
  }
  const crxName = `${basename(dir)}.crx`;
  const crxPath = join(dir, "..", crxName);
  if (!existsSync(keyPath) || !existsSync(crxPath)) return null;
  return { crxPath, keyPath };
}

function registerExtension(id: string, crxPath: string, version: string, browser: "chrome" | "edge"): boolean {
  const base = browser === "chrome"
    ? "HKCU\\Software\\Google\\Chrome\\Extensions"
    : "HKCU\\Software\\Microsoft\\Edge\\Extensions";
  const key = `${base}\\${id}`;
  const res1 = spawnSync("reg", ["add", key, "/v", "path", "/t", "REG_SZ", "/d", crxPath, "/f"], { windowsHide: true });
  const res2 = spawnSync("reg", ["add", key, "/v", "version", "/t", "REG_SZ", "/d", version, "/f"], { windowsHide: true });
  return res1.status === 0 && res2.status === 0;
}

function registerForceInstall(id: string, updateUrl: string, browser: "chrome" | "edge"): boolean {
  const base = browser === "chrome"
    ? "HKCU\\Software\\Policies\\Google\\Chrome\\ExtensionInstallForcelist"
    : "HKCU\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist";
  const value = `${id};${updateUrl}`;
  const res = spawnSync("reg", ["add", base, "/v", "1", "/t", "REG_SZ", "/d", value, "/f"], { windowsHide: true });
  return res.status === 0;
}

export function ensureExtensionInstalled(): InstallResult {
  const chromeExe = resolveChromeExe();
  if (!chromeExe) return { ok: false, reason: "chrome_not_found" };

  const dir = ensureCopied();
  const keyPath = join(dir, "spark-extension.pem");
  const packed = packExtension(chromeExe, dir, keyPath);
  if (!packed) return { ok: false, reason: "pack_failed" };

  const pem = readFileSync(keyPath, "utf8");
  const id = pemToId(pem);
  const version = readManifestVersion(dir);

  const crxTarget = join(dir, "spark-extension.crx");
  if (!existsSync(crxTarget)) {
    copyFileSync(packed.crxPath, crxTarget);
  }

  const okChrome = registerExtension(id, crxTarget, version, "chrome");
  const okEdge = registerExtension(id, crxTarget, version, "edge");
  const updateUrl = "http://127.0.0.1:4343/extension/update.xml";
  const policyChrome = registerForceInstall(id, updateUrl, "chrome");
  const policyEdge = registerForceInstall(id, updateUrl, "edge");
  const ok = okChrome || okEdge || policyChrome || policyEdge;
  if (!ok) return { ok: false, reason: "registry_failed" };

  try {
    writeFileSync(join(dir, "install.json"), JSON.stringify({
      id,
      version,
      crxPath: crxTarget
    }), "utf8");
  } catch {
    // ignore
  }

  return { ok: true, id, needsRestart: true };
}
