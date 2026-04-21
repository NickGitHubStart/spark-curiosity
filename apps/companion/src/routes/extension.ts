import type { IncomingMessage, ServerResponse } from "node:http";
import { PORT } from "../config.js";
import { extensionStatus } from "../state.js";
import { curatedGateMatches, getCuratedGatePolicy, isFeedPath } from "../curated-gate.js";
import { json, parseBody } from "./helpers.js";

export async function handleExtensionRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/extension/decide") {
    const target = url.searchParams.get("url") || "";
    if (!target) { json(res, 200, { action: "none" }); return true; }
    extensionStatus.lastSeen = new Date().toISOString();
    extensionStatus.lastUrl = target;
    const policy = getCuratedGatePolicy();
    if (!policy.enabled) { json(res, 200, { action: "none" }); return true; }
    if (!curatedGateMatches(target)) { json(res, 200, { action: "none" }); return true; }
    if (!isFeedPath(target, "other")) { json(res, 200, { action: "none" }); return true; }
    try { extensionStatus.lastRedirectHost = new URL(target).hostname; } catch { extensionStatus.lastRedirectHost = target; }
    extensionStatus.lastRedirectAt = Date.now();
    const curatedUrl = `http://127.0.0.1:${PORT}/curated?from=${encodeURIComponent(target)}`;
    json(res, 200, { action: "close", openUrl: curatedUrl });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/extension/ping") {
    extensionStatus.lastSeen = new Date().toISOString();
    try {
      const body = await parseBody<{ url?: string }>(req);
      if (body?.url) extensionStatus.lastUrl = body.url;
    } catch { /* ignore */ }
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/extension/status") {
    json(res, 200, { lastSeen: extensionStatus.lastSeen, lastUrl: extensionStatus.lastUrl });
    return true;
  }

  return false;
}
