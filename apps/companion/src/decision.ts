import type {
  DesktopCommandAny,
  EventDecisionResponse,
  EventIngest,
  PageContextSignal,
  ToolCall,
  ToolOpenCuratedGateArgs,
  ToolRedirectArgs,
  ToolSetNextCheckArgs,
  ToolShowQuoteArgs,
  ToolUpdateMemoryArgs
} from "@spark/shared";
import { currentModel, idleNextCheckSeconds, policyGateNextCheckSeconds, CLOUD_PROXY_URL, currentGrokApiKey } from "./config.js";
import { applyMemoryOps, readMemoryFile, writeMemoryFile } from "./memory.js";
import { runAiDecision, runAiMemoryCleanup, type AiDecisionResult } from "./ai.js";
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

/* ── Cloud context sync (fire-and-forget, best-effort) ── */
function pushPcContextToCloud(event: EventIngest): void {
  if (!CLOUD_PROXY_URL) return;
  const token = currentGrokApiKey();
  if (!token) return;
  const pageHint = event.signals?.pageContext?.contentLabel?.trim().slice(0, 120);
  const summary = [event.title, pageHint, event.platform !== "other" ? event.platform : "", hostnameOf(event.url)]
    .filter(Boolean).join(", ").slice(0, 200) || event.url.slice(0, 100);
  fetch(`${CLOUD_PROXY_URL}/context`, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${token}` },
    body: JSON.stringify({ platform: "pc", summary, url: event.url }),
  }).catch(() => {});
}

/* ── Decision cache: avoid repeated LLM calls for the same host ── */
const CACHE_MULTIPLIER = 5;

interface CachedDecision {
  response: EventDecisionResponse;
  expiresAt: number;
}

const decisionCache = new Map<string, CachedDecision>();

function getCacheKey(event: EventIngest): string {
  return hostnameOf(event.url) || event.url;
}

function getCachedDecision(event: EventIngest): EventDecisionResponse | null {
  const key = getCacheKey(event);
  const cached = decisionCache.get(key);
  if (!cached || Date.now() > cached.expiresAt) {
    if (cached) decisionCache.delete(key);
    return null;
  }
  return cached.response;
}

function cacheDecision(event: EventIngest, response: EventDecisionResponse): void {
  const nextSec = response.nextCheckSeconds;
  if (typeof nextSec !== "number" || !Number.isFinite(nextSec) || nextSec <= 0) return;
  const ttlMs = nextSec * CACHE_MULTIPLIER * 1000;
  const key = getCacheKey(event);
  decisionCache.set(key, { response, expiresAt: Date.now() + ttlMs });
}

/** Invalidate cache (e.g. when user changes rules via chat) */
export function invalidateDecisionCache(): void {
  decisionCache.clear();
}

/* ── Memory cleanup trigger ── */
const CLEANUP_EVERY_N_CALLS = 100;
let callsSinceLastCleanup = 0;
let cleanupRunning = false;

async function maybeRunMemoryCleanup(): Promise<void> {
  callsSinceLastCleanup += 1;
  if (callsSinceLastCleanup < CLEANUP_EVERY_N_CALLS || cleanupRunning) return;
  callsSinceLastCleanup = 0;
  cleanupRunning = true;
  try {
    const { body: memBody, onboardingComplete } = readMemoryFile();
    const result = await runAiMemoryCleanup(memBody);
    if (result.memoryOps?.length) {
      const updated = applyMemoryOps(memBody, result.memoryOps);
      if (updated !== memBody) writeMemoryFile(updated, onboardingComplete);
    } else if (result.memoryMarkdown) {
      writeMemoryFile(result.memoryMarkdown, onboardingComplete);
    }
  } catch { /* cleanup is best-effort */ }
  cleanupRunning = false;
}

function curatedGateResponse(_event: EventIngest, thought: string): EventDecisionResponse {
  return {
    commands: [{ type: "close_tab", reason: "curated_gate_policy" }],
    nextCheckSeconds: policyGateNextCheckSeconds(),
    reason: "curated_gate_policy",
    agentSkipped: false,
    ai: { provider: "grok", model: currentModel(), used: false, thought }
  };
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

const PAGE_CTX_MAX_AGE_MS = 90_000;

function normalizeUrlStem(u: string): string {
  try {
    const x = new URL(u);
    const path = x.pathname.replace(/\/+$/, "") || "/";
    return `${x.origin}${path}`;
  } catch {
    return u;
  }
}

/** Merge latest Chrome extension page snapshot when URL matches the desktop event. */
function enrichEventWithExtensionPageContext(event: EventIngest): void {
  if (!event.url?.startsWith("http")) return;
  const snap = extensionStatus.lastPageContext;
  if (!snap?.url) return;
  if (Date.now() - snap.updatedAt > PAGE_CTX_MAX_AGE_MS) return;
  if (normalizeUrlStem(snap.url) !== normalizeUrlStem(event.url)) return;

  const pageContext: PageContextSignal = {};
  if (snap.documentTitle) pageContext.documentTitle = snap.documentTitle;
  if (snap.contentLabel) pageContext.contentLabel = snap.contentLabel;
  if (snap.pathKind) pageContext.pathKind = snap.pathKind as PageContextSignal["pathKind"];
  if (!Object.keys(pageContext).length) return;

  const prev = event.signals;
  event.signals = {
    ...prev,
    pageContext,
    media: prev?.media,
    usage: prev?.usage,
    recentHosts: prev?.recentHosts
  };
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
      case "close_tab": {
        const args = call.args as { reason?: string };
        commands.push({ type: "close_tab", reason: typeof args?.reason === "string" ? args.reason : undefined });
        break;
      }
      case "redirect_and_close": {
        const args = call.args as ToolRedirectArgs;
        commands.push({ type: "close_tab", reason: args?.reason });
        break;
      }
      case "open_curated_gate": {
        const args = call.args as ToolOpenCuratedGateArgs;
        commands.push({ type: "close_tab", reason: args?.reason || "curated_gate" });
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
          const taggedOps = args.ops.map(op => ({ ...op, entry: op.entry ? `[PC] ${op.entry}` : op.entry }));
          updatedMemoryBody = applyMemoryOps(updatedMemoryBody, taggedOps);
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
  // Tag event as coming from PC for shared context feature
  (event as EventIngest & { thisPlatform?: string }).thisPlatform = "pc";
  enrichEventWithExtensionPageContext(event);
  // Push current PC context to cloud so Android agent can see what we're doing
  pushPcContextToCloud(event);

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

    // Check if extension JUST handled a redirect for this host (prevents double-redirect race condition)
    const eventHost = hostnameOf(event.url);
    const extensionJustRedirected = extensionStatus.lastRedirectAt > 0
      && Date.now() - extensionStatus.lastRedirectAt < 10_000
      && extensionStatus.lastRedirectHost === eventHost;

    if (extensionActive || extensionJustRedirected) {
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
    const response = curatedGateResponse(event, "curated_gate_policy");
    recordDecision(event, response, { aiUsed: false, agentThinking: "curated_gate_policy" });
    return response;
  }

  // ── Decision cache: reuse previous LLM decision if still valid ──
  const cached = getCachedDecision(event);
  if (cached) {
    const cacheResponse: EventDecisionResponse = {
      ...cached,
      reason: `cached: ${cached.reason || "previous_decision"}`,
    };
    recordDecision(event, cacheResponse, { aiUsed: false, agentThinking: "decision_cache_hit" });
    return cacheResponse;
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

  // Cache the decision for this host (TTL = nextCheckSeconds × 5)
  cacheDecision(event, response);

  // Fire-and-forget: periodic memory cleanup (non-blocking)
  maybeRunMemoryCleanup().catch(() => {});

  return response;
}
