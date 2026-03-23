import type {
  DesktopCommandAny,
  EventDecisionResponse,
  EventIngest,
  ToolCall,
  ToolOpenCuratedGateArgs,
  ToolRedirectArgs,
  ToolSetNextCheckArgs,
  ToolShowQuoteArgs,
  ToolUpdateMemoryArgs,
  ToolTarget
} from "@spark/shared";
import { PORT, currentModel, idleNextCheckSeconds, policyGateNextCheckSeconds } from "./config.js";
import { applyMemoryOps, readMemoryFile, writeMemoryFile } from "./memory.js";
import { runAiDecision, type AiDecisionResult } from "./ai.js";
import {
  MAX_RECENT_THOUGHTS,
  lastDecisions,
  recentAgentThoughts,
  ringPush,
  stats,
  extensionStatus
} from "./state.js";
import {
  applyCuratedGateUpdate,
  curatedGateMatches,
  curatedGateMatchesByTitle,
  getCuratedGatePolicy,
  isFeedPath,
  type CuratedGateUpdate
} from "./curated-gate.js";
import { recordBlock } from "./block-stats.js";

function curatedGateResponse(event: EventIngest, curatedUrl: string, thought: string): EventDecisionResponse {
  return {
    commands: [{ type: "redirect", url: curatedUrl, closeTab: true, reason: "curated_gate_policy" }],
    nextCheckSeconds: policyGateNextCheckSeconds(),
    reason: "curated_gate_policy",
    agentSkipped: false,
    ai: { provider: "grok", model: currentModel(), used: false, thought }
  };
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

function isUrlLike(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  if (/^[a-zA-Z]:\\/.test(value)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return true;
  return false;
}

function resolveTargetUrl(target: ToolTarget | undefined): string | null {
  if (!target || typeof target.value !== "string") return null;
  const value = target.value.trim();
  return value && isUrlLike(value) ? value : null;
}

function buildCuratedGateUrl(event: EventIngest, args: ToolOpenCuratedGateArgs): string {
  const site = (args.site || hostnameOf(event.url) || "").trim();
  const fromUrl = (args.fromUrl || event.url || "").trim();
  const params = new URLSearchParams();
  if (fromUrl) params.set("from", fromUrl);
  if (site) params.set("site", site);
  const suffix = params.toString();
  return `http://127.0.0.1:${PORT}/curated${suffix ? `?${suffix}` : ""}`;
}

function appendCommand(commands: DesktopCommandAny[], url: string | null, closeTab: boolean | undefined, reason?: string): void {
  if (!url) return;
  commands.push({
    type: "redirect",
    url,
    closeTab: closeTab !== false,
    reason
  });
}

function applyToolCalls(
  event: EventIngest,
  toolCalls: ToolCall[] | undefined,
  memoryBody: string
): { commands: DesktopCommandAny[]; nextCheckSeconds?: number; memoryBody: string } {
  const commands: DesktopCommandAny[] = [];
  let nextCheckSeconds: number | undefined;
  let updatedMemoryBody = memoryBody;

  for (const call of toolCalls || []) {
    switch (call.tool) {
      case "redirect_and_close": {
        const args = call.args as ToolRedirectArgs;
        const targetUrl = resolveTargetUrl(args?.target);
        appendCommand(commands, targetUrl, args?.closeTab, args?.reason);
        break;
      }
      case "open_curated_gate": {
        const args = call.args as ToolOpenCuratedGateArgs;
        const curatedUrl = buildCuratedGateUrl(event, args || {});
        appendCommand(commands, curatedUrl, true, args?.reason);
        break;
      }
      case "set_curated_gate": {
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
        break;
      }
      case "update_memory": {
        const args = call.args as ToolUpdateMemoryArgs;
        if (args?.ops?.length) {
          updatedMemoryBody = applyMemoryOps(updatedMemoryBody, args.ops);
        }
        break;
      }
      case "set_next_check": {
        const args = call.args as ToolSetNextCheckArgs;
        if (typeof args?.seconds === "number" && Number.isFinite(args.seconds)) {
          nextCheckSeconds = Math.max(10, Math.floor(args.seconds));
        }
        break;
      }
      case "show_quote": {
        const args = call.args as ToolShowQuoteArgs;
        const text = (args?.text || "").trim().slice(0, 260);
        const author = (args?.author || "").trim().slice(0, 120) || undefined;
        if (text) {
          commands.push({ type: "quote", text, author });
        }
        break;
      }
      case "show_prompt": {
        const args = call.args as { question?: string };
        const question = (args?.question || "").trim().slice(0, 240);
        if (question) {
          commands.push({ type: "prompt", question });
        }
        break;
      }
      default:
        break;
    }
  }

  return { commands, nextCheckSeconds, memoryBody: updatedMemoryBody };
}

function recordAgentResult(event: EventIngest, ai: AiDecisionResult): void {
  ringPush(recentAgentThoughts, {
    at: new Date().toISOString(),
    url: event.url,
    thought: ai.thought,
    toolCalls: ai.toolCalls
  }, MAX_RECENT_THOUGHTS);
}

function recordDecision(
  event: EventIngest,
  response: EventDecisionResponse,
  opts: { aiUsed: boolean; agentThinking: string; toolCalls?: ToolCall[] }
): void {
  ringPush(lastDecisions, {
    at: new Date().toISOString(),
    event,
    response,
    aiUsed: opts.aiUsed,
    agentThinking: opts.agentThinking,
    toolCalls: opts.toolCalls
  }, 500);
}

export async function decide(event: EventIngest): Promise<EventDecisionResponse> {
  const { body: memoryBody, onboardingComplete } = readMemoryFile();
  stats.agentCalls += 1;

  const policy = getCuratedGatePolicy();
  const hostMatch = policy.enabled ? curatedGateMatches(event.url) : false;
  const appMatch = policy.enabled ? curatedGateMatchesByTitle(event) : null;
  const feedMatch = hostMatch ? isFeedPath(event.url, event.platform) : false;
  const curatedGateDirect = Boolean(appMatch || feedMatch);
  // Non-feed pages (e.g. /watch?v=...) on gated hosts are allowed through —
  // only feeds/shorts/explore get blocked. The AI decides about content pages.

  if (curatedGateDirect) {
    const lastSeen = extensionStatus.lastSeen ? Date.parse(extensionStatus.lastSeen) : 0;
    const extensionActive = lastSeen > 0 && Date.now() - lastSeen < 120_000;
    if (extensionActive) {
      recordBlock(event.url);
      const response: EventDecisionResponse = {
        nextCheckSeconds: policyGateNextCheckSeconds(),
        reason: "extension_handled",
        agentSkipped: false,
        ai: { provider: "grok", model: currentModel(), used: false, thought: "extension_handled" }
      };
      recordDecision(event, response, { aiUsed: false, agentThinking: "extension_handled" });
      return response;
    }
    recordBlock(event.url);
    const curatedUrl = buildCuratedGateUrl(event, { site: appMatch || hostnameOf(event.url) || "" });
    const response = curatedGateResponse(event, curatedUrl, "curated_gate_policy");
    recordDecision(event, response, { aiUsed: false, agentThinking: "curated_gate_policy" });
    return response;
  }

  const ai = await runAiDecision(event, memoryBody);
  if (!ai.used) {
    stats.agentSkips += 1;
    const response: EventDecisionResponse = {
      reason: `agent_offline: ${ai.thought}`,
      agentSkipped: true,
      ai: { provider: "grok", model: currentModel(), used: false, thought: ai.thought }
    };
    recordDecision(event, response, { aiUsed: false, agentThinking: ai.thought });
    return response;
  }

  const { commands, nextCheckSeconds, memoryBody: updatedMemoryBody } = applyToolCalls(event, ai.toolCalls, memoryBody);
  if (updatedMemoryBody !== memoryBody) {
    writeMemoryFile(updatedMemoryBody, onboardingComplete);
  }

  recordAgentResult(event, ai);

  let effectiveNext = nextCheckSeconds;
  if (effectiveNext === undefined && commands.length === 0) {
    effectiveNext = idleNextCheckSeconds();
  }

  const response: EventDecisionResponse = {
    commands: commands.length ? commands : undefined,
    nextCheckSeconds: effectiveNext,
    reason: ai.reason || ai.thought,
    agentSkipped: false,
    ai: { provider: "grok", model: currentModel(), used: true, thought: ai.thought }
  };

  recordDecision(event, response, { aiUsed: true, agentThinking: ai.thought, toolCalls: ai.toolCalls });
  return response;
}
