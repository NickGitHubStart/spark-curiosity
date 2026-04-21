import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  AI_TIMEOUT_MS, CLOUD_PROXY_URL, CLOUD_REGISTER_SECRET, HOST, PORT,
  currentGrokApiKey, currentGrokBaseUrl, currentGrokModel, currentModel,
} from "./config.js";
import { ensureFiles, migrateTemplateIfNeeded, registerCloudToken, writeRuntimeConfig, syncFromCloud } from "./memory.js";
import { setTestForcedAiJson } from "./ai.js";
import { initCuratedGatePolicy } from "./curated-gate.js";
import { json } from "./routes/helpers.js";
import { handleExtensionRoutes } from "./routes/extension.js";
import { handleDesktopRoutes } from "./routes/desktop.js";
import { handleBrainRoutes } from "./routes/brain.js";
import { handleCuratedRoutes } from "./routes/curated.js";
import { handleDebugRoutes } from "./routes/debug.js";
import { handleOnboardingRoutes } from "./routes/onboarding.js";
import { handleChatRoutes } from "./routes/chat.js";
import { handleSttRoutes } from "./routes/stt.js";
import { handlePageRoutes } from "./routes/pages.js";

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  // Legacy /vault/* aliases → /brain/*
  if (url.pathname.startsWith("/vault/")) {
    url.pathname = url.pathname.replace("/vault/", "/brain/");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" });
    return void res.end();
  }

  if (await handleDesktopRoutes(req, res, url)) return;
  if (await handleExtensionRoutes(req, res, url)) return;
  if (await handleBrainRoutes(req, res, url)) return;
  if (await handleCuratedRoutes(req, res, url)) return;
  if (await handleDebugRoutes(req, res, url)) return;
  if (await handleOnboardingRoutes(req, res, url)) return;
  if (await handleChatRoutes(req, res, url)) return;
  if (await handleSttRoutes(req, res, url)) return;
  if (await handlePageRoutes(req, res, url)) return;

  return json(res, 404, { error: "not_found" });
}

export function createCompanionServer() {
  return createServer((req, res) => { void handle(req, res); });
}

/** Auto-register cloud proxy token if proxy is configured but no API key is present. */
async function ensureCloudToken(): Promise<void> {
  if (!CLOUD_PROXY_URL) return;
  if (currentGrokApiKey()) return;
  console.log(`[spark:startup] No API key found but cloud proxy configured — auto-registering token at ${CLOUD_PROXY_URL}`);
  try {
    const reg = await registerCloudToken(CLOUD_PROXY_URL, CLOUD_REGISTER_SECRET || undefined);
    if (!reg.ok) {
      console.error("[spark:startup] cloud token registration failed:", reg.error);
      return;
    }
    const writeResult = writeRuntimeConfig({ grokApiKey: reg.token, grokModel: currentGrokModel() });
    if (writeResult.ok) {
      console.log("[spark:startup] cloud token auto-registered and saved to runtime.env");
    } else {
      console.error("[spark:startup] token obtained but write failed:", writeResult.error);
    }
  } catch (err) {
    console.error("[spark:startup] cloud token auto-registration error:", err);
  }
}

export function startCompanionServer(port = PORT, host = HOST) {
  ensureFiles();
  migrateTemplateIfNeeded();
  initCuratedGatePolicy();
  const server = createCompanionServer();
  server.listen(port, host, () => {
    const model = currentModel();
    console.log(`Spark companion running on http://${host}:${port}`);
    console.log(`[spark] AI: Grok (${model}) — Timeout: ${AI_TIMEOUT_MS}ms`);
    // One-shot encrypted memory migration if user provided a SPARK_INSTALL_TOKEN
    void (async () => {
      const installToken = process.env.SPARK_INSTALL_TOKEN;
      if (!installToken) return;
      try {
        const { migrateLocalMemoryToCloud } = await import("./cloud-memory.js");
        const r = await migrateLocalMemoryToCloud(installToken);
        if (r.ok && r.reason !== "already_migrated") {
          console.log("[spark:cloud-memory] local memory pushed to cloud (encrypted)");
        } else if (!r.ok) {
          console.warn("[spark:cloud-memory] migration skipped:", r.reason);
        }
      } catch (e) {
        console.warn("[spark:cloud-memory] migration error:", e);
      }
    })();
    // Auto-register cloud token if missing, then kick off the cross-device memory sync loop
    void ensureCloudToken().then(() => {
      const grokApiKey = currentGrokApiKey();
      if (grokApiKey) {
        console.log(`[spark] Grok aktiv: ${currentGrokBaseUrl()}`);
        // Initial pull so the PC agent immediately sees any phone-side memory changes
        void syncFromCloud().catch(() => {});
        // Background sync every 2 minutes — keeps PC memory in step with phone
        const CLOUD_SYNC_MS = 2 * 60 * 1000;
        setInterval(() => { void syncFromCloud().catch(() => {}); }, CLOUD_SYNC_MS);
      } else {
        console.warn("[spark] WARN: SPARK_GROK_API_KEY fehlt. Agent-Entscheidungen werden fehlschlagen.");
      }
    });
  });
  return server;
}

export { setTestForcedAiJson };

if (process.env.SPARK_SKIP_AUTOSTART !== "1") {
  startCompanionServer();
}
