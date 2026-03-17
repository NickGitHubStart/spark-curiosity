import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
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
  const base = basename(dir);
  const crxCandidates = [
    join(dir, `${base}.crx`),
    join(dirname(dir), `${base}.crx`),
    join(dir, "spark-extension.crx")
  ];
  const pemCandidates = [
    keyPath,
    join(dir, `${base}.pem`),
    join(dirname(dir), `${base}.pem`)
  ];
  const crxPath = crxCandidates.find(p => existsSync(p)) || "";
  const pemPath = pemCandidates.find(p => existsSync(p)) || "";
  if (!crxPath || !pemPath) return null;
  return { crxPath, keyPath: pemPath };
}

function psEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeRegistryPath(path: string): string {
  if (/^(HKCU|HKLM)\\/i.test(path)) return `Registry::${path}`;
  return path;
}

function setRegistryString(path: string, name: string, value: string): boolean {
  const regPath = normalizeRegistryPath(path);
  const cmd = `New-Item -Path '${psEscape(regPath)}' -Force | Out-Null; ` +
    `New-ItemProperty -Path '${psEscape(regPath)}' -Name '${psEscape(name)}' -Value '${psEscape(value)}' -PropertyType String -Force | Out-Null`;
  const res = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd], { windowsHide: true });
  return res.status === 0;
}

function registerExtension(id: string, crxPath: string, version: string, browser: "chrome" | "edge"): boolean {
  const base = browser === "chrome"
    ? "HKCU\\Software\\Google\\Chrome\\Extensions"
    : "HKCU\\Software\\Microsoft\\Edge\\Extensions";
  const key = `${base}\\${id}`;
  const ok1 = setRegistryString(key, "path", crxPath);
  const ok2 = setRegistryString(key, "version", version);
  return ok1 && ok2;
}

function registerForceInstall(id: string, updateUrl: string, browser: "chrome" | "edge"): boolean {
  const base = browser === "chrome"
    ? "HKCU\\Software\\Policies\\Google\\Chrome\\ExtensionInstallForcelist"
    : "HKCU\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallForcelist";
  const value = `${id};${updateUrl}`;
  return setRegistryString(base, "1", value);
}

function registerInstallSource(source: string, browser: "chrome" | "edge"): boolean {
  const base = browser === "chrome"
    ? "HKCU\\Software\\Policies\\Google\\Chrome\\ExtensionInstallSources"
    : "HKCU\\Software\\Policies\\Microsoft\\Edge\\ExtensionInstallSources";
  return setRegistryString(base, "1", source);
}

function userDataDir(browser: "chrome" | "edge"): string {
  if (browser === "chrome") return join(appDataRoot(), "Google", "Chrome", "User Data");
  return join(appDataRoot(), "Microsoft", "Edge", "User Data");
}

function writeExternalExtensionConfig(id: string, crxPath: string, version: string, browser: "chrome" | "edge"): boolean {
  try {
    const dir = join(userDataDir(browser), "External Extensions");
    mkdirSync(dir, { recursive: true });
    const payload = JSON.stringify({ external_crx: crxPath, external_version: version }, null, 2);
    writeFileSync(join(dir, `${id}.json`), payload, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function ensureExtensionInstalled(): InstallResult {
  const chromeExe = resolveChromeExe();
  if (!chromeExe) return { ok: false, reason: "chrome_not_found" };

  const dir = ensureCopied();
  const keyPath = join(dir, "spark-extension.pem");
  const packed = packExtension(chromeExe, dir, keyPath);
  if (!packed) return { ok: false, reason: "pack_failed" };

  const pem = readFileSync(packed.keyPath, "utf8");
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
  const source = "http://127.0.0.1:4343/*";
  const sourceChrome = registerInstallSource(source, "chrome");
  const sourceEdge = registerInstallSource(source, "edge");
  const externalChrome = writeExternalExtensionConfig(id, crxTarget, version, "chrome");
  const externalEdge = writeExternalExtensionConfig(id, crxTarget, version, "edge");
  const ok = okChrome || okEdge || policyChrome || policyEdge || sourceChrome || sourceEdge || externalChrome || externalEdge;
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
