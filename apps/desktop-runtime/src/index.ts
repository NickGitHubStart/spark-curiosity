import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT_DIR = resolve(process.env.SPARK_ROOT_DIR || process.cwd());
const COMPANION_ENTRY = process.env.SPARK_COMPANION_ENTRY || resolve(ROOT_DIR, "dist/apps/companion/src/index.js");
const DESKTOP_AGENT_ENTRY = process.env.SPARK_DESKTOP_AGENT_ENTRY || resolve(ROOT_DIR, "dist/apps/desktop-agent/src/index.js");

const PORT = Number(process.env.SPARK_COMPANION_PORT || 4343);
const HOST = process.env.SPARK_COMPANION_HOST || "127.0.0.1";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const LOG_DIR = process.env.SPARK_RUNTIME_LOG_DIR || resolve(tmpdir(), "spark-curiosity-runtime");
const RUNTIME_LOG = resolve(LOG_DIR, `runtime-${PORT}.log`);
const PID_FILE = resolve(LOG_DIR, `runtime-${PORT}.pid`);

let companionProc: ChildProcess | null = null;
let desktopProc: ChildProcess | null = null;
let overlayProc: ChildProcess | null = null;
let stopping = false;

function log(message: string): void {
  const line = `[runtime] ${new Date().toISOString()} ${message}`;
  console.log(line);
  try { appendFileSync(RUNTIME_LOG, `${line}\n`); } catch { /* ignore */ }
}

function ensurePaths(): void {
  mkdirSync(LOG_DIR, { recursive: true });
}

function ensureSingleInstance(): void {
  if (!existsSync(PID_FILE)) return;
  const pidText = readFileSync(PID_FILE, "utf8").trim();
  const pid = Number(pidText);
  if (!Number.isFinite(pid) || pid <= 0) {
    rmSync(PID_FILE, { force: true });
    return;
  }
  let running = false;
  try {
    process.kill(pid, 0);
    running = true;
  } catch {
    running = false;
  }
  if (running) {
    throw new Error(`Runtime already running with PID ${pid}. Stop it first.`);
  }
  rmSync(PID_FILE, { force: true });
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForCompanionHealth(timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await pingLocalHealth(HOST, PORT);
    if (ok) return true;
    await wait(250);
  }
  return false;
}

function pingLocalHealth(host: string, port: number): Promise<boolean> {
  return new Promise(resolvePing => {
    const req = request(
      {
        host,
        port,
        path: "/health",
        method: "GET",
        timeout: 1000,
      },
      res => {
        resolvePing((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300);
        res.resume();
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolvePing(false);
    });
    req.on("error", () => resolvePing(false));
    req.end();
  });
}

function spawnNodeProcess(entryFile: string, env: Record<string, string | undefined>, name: string): ChildProcess {
  const child = spawn(process.execPath, [entryFile], {
    cwd: ROOT_DIR,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });

  child.stdout?.on("data", chunk => log(`${name}: ${String(chunk).trimEnd()}`));
  child.stderr?.on("data", chunk => log(`${name}: ${String(chunk).trimEnd()}`));
  child.on("error", (error) => {
    log(`${name} spawn error: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    log(`${name} exited (code=${String(code)} signal=${String(signal)})`);
    if (!stopping) {
      setTimeout(() => { void restartIfNeeded(name); }, 1000);
    }
  });

  return child;
}

function resolveNativeExePath(): string | null {
  if (process.platform !== "win32") return null;
  // Installed layout (dist-package / %LOCALAPPDATA%\SparkCuriosity\app): bundled node.exe + native/
  // Always use that native exe so upgrades and reboot autostart never pick up a stale SPARK_WINDOWS_NATIVE_EXE from runtime.env.
  const bundledNative = resolve(ROOT_DIR, "native/ActiveWindowWatcher.exe");
  const bundledNode = resolve(ROOT_DIR, "node.exe");
  if (existsSync(bundledNode) && existsSync(bundledNative)) {
    const explicit = process.env.SPARK_WINDOWS_NATIVE_EXE || "";
    if (explicit && resolve(explicit) !== bundledNative) {
      log(`resolveNativeExePath: ignoring SPARK_WINDOWS_NATIVE_EXE (installed bundle uses ${bundledNative})`);
    }
    return bundledNative;
  }
  const explicit = process.env.SPARK_WINDOWS_NATIVE_EXE || "";
  if (explicit) {
    const p = resolve(explicit);
    return existsSync(p) ? p : null;
  }
  // Try installed location first (dist-package/native/), then dev locations
  const candidates = [
    resolve(ROOT_DIR, "native/ActiveWindowWatcher.exe"),
    resolve(ROOT_DIR, "apps/desktop-native/windows/ActiveWindowWatcher/bin/Release/net6.0-windows/win-x64/publish/ActiveWindowWatcher.exe"),
    resolve(ROOT_DIR, "apps/desktop-native/windows/ActiveWindowWatcher/bin/Release/net6.0-windows/win-x64/ActiveWindowWatcher.exe"),
    resolve(ROOT_DIR, "apps/desktop-native/windows/ActiveWindowWatcher/bin/Release/net6.0-windows/ActiveWindowWatcher.exe"),
  ];
  // Diagnostic: log each candidate and whether it exists
  log(`resolveNativeExePath: ROOT_DIR="${ROOT_DIR}"`);
  for (const c of candidates) {
    log(`  candidate: ${c} → exists=${existsSync(c)}`);
  }
  return candidates.find(p => existsSync(p)) ?? null;
}

/** Resolve native exe with retries (handles AV scanning / installer timing). */
async function resolveNativeExePathWithRetry(retries = 3, delayMs = 3000): Promise<string | null> {
  for (let i = 0; i <= retries; i++) {
    const p = resolveNativeExePath();
    if (p) return p;
    if (i < retries) {
      log(`native exe not found, retrying in ${delayMs}ms (${i + 1}/${retries})...`);
      await wait(delayMs);
    }
  }
  return null;
}

async function startOverlay(): Promise<void> {
  if (process.platform !== "win32") return;
  const exePath = await resolveNativeExePathWithRetry();
  if (!exePath) {
    log("overlay not started: ActiveWindowWatcher.exe not found after retries");
    return;
  }
  overlayProc = spawn(exePath, ["--overlay"], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      SPARK_COMPANION_URL: BASE_URL
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });
  overlayProc.stdout?.on("data", chunk => log(`overlay: ${String(chunk).trimEnd()}`));
  overlayProc.stderr?.on("data", chunk => log(`overlay: ${String(chunk).trimEnd()}`));
  overlayProc.on("error", (error) => {
    log(`overlay spawn error: ${error.message}`);
  });
  overlayProc.on("exit", (code, signal) => {
    log(`overlay exited (code=${String(code)} signal=${String(signal)})`);
    if (!stopping) {
      setTimeout(() => { void restartIfNeeded("overlay"); }, 1000);
    }
  });
}

async function startCompanion(): Promise<void> {
  if (!existsSync(COMPANION_ENTRY)) {
    throw new Error(`Companion entry not found: ${COMPANION_ENTRY}. Build first (npm run build -w @spark/companion).`);
  }
  log(`starting companion on ${HOST}:${PORT}`);
  companionProc = spawnNodeProcess(COMPANION_ENTRY, {
    SPARK_COMPANION_PORT: String(PORT),
    SPARK_COMPANION_HOST: HOST,
    SPARK_SKIP_AUTOSTART: "0"
  }, "companion");

  const ok = await waitForCompanionHealth(30_000);
  if (!ok) {
    log(`companion health check timeout at ${BASE_URL}; continuing and letting process warm up`);
    return;
  }
  log(`companion healthy at ${BASE_URL}`);
}

function startDesktopAgent(): void {
  if (!existsSync(DESKTOP_AGENT_ENTRY)) {
    throw new Error(`Desktop agent entry not found: ${DESKTOP_AGENT_ENTRY}. Build first (npm run build -w @spark/desktop-agent).`);
  }
  log("starting desktop-agent");
  desktopProc = spawnNodeProcess(DESKTOP_AGENT_ENTRY, {
    SPARK_COMPANION_URL: BASE_URL
  }, "desktop-agent");
}

async function restartIfNeeded(name: string): Promise<void> {
  if (stopping) return;
  try {
    if (name === "companion") {
      companionProc = null;
      await startCompanion();
      if (!desktopProc) startDesktopAgent();
      if (!overlayProc) void startOverlay();
      return;
    }
    if (name === "desktop-agent") {
      desktopProc = null;
      startDesktopAgent();
      return;
    }
    if (name === "overlay") {
      overlayProc = null;
      void startOverlay();
    }
  } catch (error) {
    log(`restart failed for ${name}: ${String(error)}`);
  }
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("shutdown requested");

  const children = [desktopProc, companionProc].filter(Boolean) as ChildProcess[];
  if (overlayProc) children.push(overlayProc);
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
  }

  await wait(750);
  for (const child of children) {
    if (!child.killed) {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }
  }

  process.exit(0);
}

async function main(): Promise<void> {
  ensurePaths();
  ensureSingleInstance();
  writeFileSync(PID_FILE, `${process.pid}\n`, "utf8");
  log(`runtime root=${ROOT_DIR}`);
  log(`log file=${RUNTIME_LOG}`);

  await startCompanion();
  startDesktopAgent();
  void startOverlay();

  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
  process.on("exit", () => {
    try { rmSync(PID_FILE, { force: true }); } catch { /* ignore */ }
  });
}

void main().catch(error => {
  log(`fatal: ${String(error)}`);
  process.exitCode = 1;
});
