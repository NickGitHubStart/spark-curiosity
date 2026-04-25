import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChatRequest, ChatResponse, EventIngest, MemoryOp } from "@spark/shared";
import { applyMemoryOps, loadMemory, readMemoryFile, writeMemoryFile, recordApiCallForMemoryCleanup } from "../memory.js";
import { runAiChat } from "../ai.js";
import { decide, invalidateDecisionCache } from "../decision.js";
import { applyCuratedGateUpdate, type CuratedGateUpdate } from "../curated-gate.js";
import { stats, chatLog, feedbackLog, ringPush } from "../state.js";
import { json, parseBody } from "./helpers.js";

function buildMemorySummary(ops: MemoryOp[] | undefined, hasMarkdown: boolean): string[] | undefined {
  if (hasMarkdown) return ["Memory vollständig aktualisiert"];
  if (!ops?.length) return undefined;
  return ops.map(op => {
    const sec = op.section.replace("-Term", "");
    if (op.op === "remove") return `${sec}: "${(op.old || "").slice(0, 60)}" entfernt`;
    if (op.op === "update") return `${sec}: "${(op.new || "").slice(0, 60)}"`;
    return `${sec}: "${(op.entry || "").slice(0, 60)}"`;
  });
}

async function onChat(req: ChatRequest): Promise<ChatResponse> {
  const { body: memoryBody, onboardingComplete } = readMemoryFile();
  stats.chatMessages += 1;
  stats.lastChatAt = new Date().toISOString();

  const { reply, memoryMarkdown, memoryOps, openUrl, toolCalls } = await runAiChat(req.message, memoryBody);
  const userMsg = req.message.toLowerCase();
  const wantsOpen = /\b(oeffne|öffne|open|go to|geh zu|zeige mir|öffnen)\b/.test(userMsg);
  if (memoryMarkdown) {
    writeMemoryFile(memoryMarkdown, onboardingComplete);
  } else if (memoryOps?.length) {
    writeMemoryFile(applyMemoryOps(memoryBody, memoryOps), onboardingComplete);
  }

  if (toolCalls?.length) {
    for (const call of toolCalls) {
      if (call.tool === "set_curated_gate") {
        const args = call.args as { mode?: string; rules?: unknown[]; ruleIds?: string[]; note?: string };
        const validModes: CuratedGateUpdate["mode"][] = ["set", "add", "remove", "disable"];
        if (args?.mode && validModes.includes(args.mode as CuratedGateUpdate["mode"])) {
          applyCuratedGateUpdate({
            mode: args.mode as CuratedGateUpdate["mode"],
            rules: Array.isArray(args.rules) ? args.rules as CuratedGateUpdate["rules"] : undefined,
            ruleIds: args.ruleIds,
            note: typeof args.note === "string" ? args.note : undefined
          });
        }
      }
    }
  }

  const memoryUpdated = Boolean(memoryMarkdown || memoryOps?.length);
  if (memoryUpdated || toolCalls?.length) invalidateDecisionCache();
  const memorySummary = buildMemorySummary(memoryOps, Boolean(memoryMarkdown));
  const safeOpenUrl = wantsOpen ? openUrl : undefined;
  ringPush(chatLog, { at: new Date().toISOString(), userMessage: req.message, reply, memoryUpdated, openUrl: safeOpenUrl }, 200);
  return { reply, memoryUpdated, memorySummary, openUrl: safeOpenUrl };
}

export async function handleChatRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/event") {
    try {
      const event = await parseBody<EventIngest>(req);
      stats.eventsReceived += 1;
      stats.lastEventAt = new Date().toISOString();
      const out = await decide(event);
      recordApiCallForMemoryCleanup();
      json(res, 200, out);
    } catch (error) {
      json(res, 400, { reason: `bad_event:${String(error)}`, agentSkipped: true });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/chat") {
    try {
      const p = await parseBody<ChatRequest>(req);
      json(res, 200, await onChat(p));
    } catch (error) {
      json(res, 400, { reply: `Fehler: ${String(error)}`, memoryUpdated: false });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/memory") {
    json(res, 200, loadMemory());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/memory/insights") {
    const { body, onboardingComplete } = readMemoryFile();
    const text = `---\nonboardingComplete: ${onboardingComplete}\n---\n\n${body}`;
    json(res, 200, { text });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/quote/feedback") {
    try {
      const body = await parseBody<{ text?: string; author?: string; feedback?: string }>(req);
      const rating = body.feedback === "down" ? "down" : "up";
      const text = (body.text || "").trim().slice(0, 260);
      const author = (body.author || "").trim().slice(0, 120);
      const entry = `Quote-Feedback (${rating}): "${text}"${author ? ` - ${author}` : ""}`;
      const { body: memoryBody, onboardingComplete } = readMemoryFile();
      const newBody = applyMemoryOps(memoryBody, [{ op: "add", section: "Short-Term", entry }]);
      writeMemoryFile(newBody, onboardingComplete);
      stats.feedbackReceived += 1;
      stats.lastFeedbackAt = new Date().toISOString();
      ringPush(feedbackLog, { at: new Date().toISOString(), payload: { feedback: "quote", rating, text, author } }, 500);
      json(res, 202, { accepted: true });
    } catch (error) {
      json(res, 400, { accepted: false, error: String(error) });
    }
    return true;
  }

  return false;
}
