import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, currentLang } from "../config.js";
import { renderCuratedPage } from "../ui/curated-ui.js";
import { renderPairPage } from "../ui/pair-ui.js";
import { renderQuotePage } from "../ui/quote-ui.js";
import { renderBrainUi } from "../ui/brain-ui.js";
import { json, html } from "./helpers.js";

export async function handlePageRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/pair") {
    html(res, await renderPairPage());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/curated") {
    html(res, renderCuratedPage(currentLang()));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/quote") {
    html(res, renderQuotePage(url.searchParams, currentLang()));
    return true;
  }

  // Serve static assets (onboarding images etc.)
  if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
    const safePath = url.pathname.replace(/\.\./g, "").slice("/assets/".length);
    const filePath = join(DATA_DIR, "assets", safePath);
    if (existsSync(filePath)) {
      const ext = filePath.split(".").pop()?.toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
      res.writeHead(200, { "content-type": mime, "cache-control": "public, max-age=86400" });
      res.end(readFileSync(filePath));
      return true;
    }
    json(res, 404, { error: "not_found" });
    return true;
  }

  return false;
}
