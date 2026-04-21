import type { IncomingMessage, ServerResponse } from "node:http";
import { extensionStatus, type ExtensionPageContext } from "../state.js";
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
    json(res, 200, { action: "close" });
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
    json(res, 200, {
      lastSeen: extensionStatus.lastSeen,
      lastUrl: extensionStatus.lastUrl,
      lastPageContext: extensionStatus.lastPageContext
    });
    return true;
  }

  /** Content script → rich page context (post body, video title, pathKind) for the active tab URL */
  if (req.method === "POST" && url.pathname === "/extension/page") {
    extensionStatus.lastSeen = new Date().toISOString();
    try {
      const body = await parseBody<{
        url?: string;
        documentTitle?: string;
        contentLabel?: string;
        pathKind?: string;
      }>(req);
      const u = (body?.url || "").trim();
      if (u.startsWith("http")) {
        extensionStatus.lastUrl = u;
        const snap: ExtensionPageContext = {
          url: u,
          updatedAt: Date.now()
        };
        if (typeof body.documentTitle === "string" && body.documentTitle.trim()) snap.documentTitle = body.documentTitle.trim().slice(0, 500);
        if (typeof body.contentLabel === "string" && body.contentLabel.trim()) snap.contentLabel = body.contentLabel.trim().slice(0, 400);
        if (typeof body.pathKind === "string" && body.pathKind.trim()) snap.pathKind = body.pathKind.trim().slice(0, 32);
        extensionStatus.lastPageContext = snap;
      }
    } catch { /* ignore */ }
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
