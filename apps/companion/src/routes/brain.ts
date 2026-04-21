import type { IncomingMessage, ServerResponse } from "node:http";
import { readMemoryFile } from "../memory.js";
import { currentModel } from "../config.js";
import { runAiBrainClassification, runAiBrainCompression } from "../ai.js";
import { captureVaultEntry, getVaultStatus, initializeVault, listVaultEntries } from "../obsidian-vault.js";
import { json, parseBody } from "./helpers.js";

export async function handleBrainRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/brain") {
    res.writeHead(302, { Location: "/setup" });
    res.end();
    return true;
  }

  if (req.method === "GET" && url.pathname === "/brain/status") {
    json(res, 200, getVaultStatus());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/brain/entries") {
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));
    json(res, 200, { entries: listVaultEntries(undefined, limit) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/brain/init") {
    try {
      const body = await parseBody<{ importCurrentMemory?: boolean }>(req).catch(() => ({ importCurrentMemory: false }));
      const memory = body.importCurrentMemory ? readMemoryFile().body : "";
      json(res, 200, initializeVault({ importCurrentMemory: memory }));
    } catch (error) {
      json(res, 400, { ok: false, error: String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/brain/compress-preview") {
    try {
      const body = await parseBody<{ content?: string }>(req);
      const content = await runAiBrainCompression(body.content || "");
      json(res, 200, { content, model: currentModel() });
    } catch (error) {
      json(res, 400, { ok: false, error: String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/brain/classify") {
    try {
      const body = await parseBody<{ content?: string; preferredType?: string }>(req);
      const content = (body.content || "").trim();
      if (!content) { json(res, 400, { ok: false, error: "brain_content_required" }); return true; }
      const classification = await runAiBrainClassification(content, listVaultEntries(undefined, 300), body.preferredType);
      json(res, 200, classification);
    } catch (error) {
      json(res, 400, { ok: false, error: String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/brain/save") {
    try {
      const body = await parseBody<{
        content?: string; title?: string;
        type?: "thought" | "knowledge" | "mental_model" | "principle" | "maxim" | "log" | "limiting_step";
        source?: string; themenpfad?: string; parentIndex?: string;
        relatedIndices?: string[]; originalSource?: string; userNotes?: string; aiModel?: string;
      }>(req);
      json(res, 200, captureVaultEntry({
        content: body.content || "", title: body.title, type: body.type,
        source: body.source || "brain", themenpfad: body.themenpfad,
        parentIndex: body.parentIndex, relatedIndices: body.relatedIndices,
        originalSource: body.originalSource, userNotes: body.userNotes, aiModel: body.aiModel,
      }));
    } catch (error) {
      json(res, 400, { ok: false, error: String(error) });
    }
    return true;
  }

  return false;
}
