import type { IncomingMessage, ServerResponse } from "node:http";
import { readMemoryFile } from "../memory.js";
import { runAiCuratedRecommendations, runAiCuratedSearch, runAiVideoSummary } from "../ai.js";
import { json, parseBody } from "./helpers.js";

const curatedCache = new Map<string, { items: Array<{ title: string; url: string; summary?: string; thumbnail?: string }>; updatedAt: number }>();

export async function handleCuratedRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/curated/recommendations") {
    const site = url.searchParams.get("site") || "";
    const limit = Math.max(1, Math.min(12, Number(url.searchParams.get("limit") || 10)));
    const cacheKey = `${site || "__all__"}:${limit}`;
    const cached = curatedCache.get(cacheKey);
    if (cached && Date.now() - cached.updatedAt < 5 * 60 * 1000) {
      json(res, 200, { items: cached.items });
      return true;
    }
    try {
      const { body } = readMemoryFile();
      const items = await runAiCuratedRecommendations(site, body, limit);
      curatedCache.set(cacheKey, { items, updatedAt: Date.now() });
      json(res, 200, { items });
    } catch (error) {
      json(res, 200, { items: [], error: String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/curated/search") {
    try {
      const body = await parseBody<{ query: string; site?: string }>(req);
      const query = body.query?.trim();
      if (!query) { json(res, 400, { error: "query_required" }); return true; }
      const { body: memoryBody } = readMemoryFile();
      const items = await runAiCuratedSearch(body.site || "", query, memoryBody, 5);
      json(res, 200, { ok: true, items });
    } catch (error) {
      json(res, 400, { error: String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/curated/summarize") {
    try {
      const body = await parseBody<{ url?: string; title?: string }>(req);
      const target = (body.url || "").trim();
      if (!target || !target.startsWith("http")) { json(res, 400, { ok: false, error: "url_required" }); return true; }
      const { body: memoryBody } = readMemoryFile();
      const summary = await runAiVideoSummary(target, body.title || "", memoryBody);
      if (!summary) { json(res, 200, { ok: false, error: "no_summary" }); return true; }
      json(res, 200, { ok: true, summary });
    } catch (error) {
      json(res, 200, { ok: false, error: String(error) });
    }
    return true;
  }

  return false;
}
