import type { EventDecisionResponse, EventIngest, SiteVerdict } from "@spark/shared";
import { enforceBadVerdictAction, resolveCachedDecision, safeRedirectUrl } from "./decision-policy.js";
import { currentModel, currentProvider } from "./config.js";
import { buildCuratedGateDecision, isFeedPath } from "./curated-gate.js";
import { applyMemoryOps, readMemoryFile, readSocialMediaMode, writeMemoryFile } from "./memory.js";
import { runAiDecision, resolveNextCheckSeconds, type AiDecisionResult } from "./ai.js";
import {
  MAX_RECENT_THOUGHTS,
  lastDecisions,
  prompts,
  recentAgentThoughts,
  siteVerdicts,
  stats,
  ringPush
} from "./state.js";

function hostnameOf(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function recordAgentResult(event: EventIngest, ai: AiDecisionResult): void {
  const cacheKey = verdictCacheKey(event);
  const verdict: SiteVerdict = ai.siteVerdict || "neutral";
  const checkSec = resolveNextCheckSeconds(verdict, ai.nextCheckSeconds);
  const now = Date.now();
  const resolvedRedirect = safeRedirectUrl(ai.action?.redirectUrl) || safeRedirectUrl(ai.redirectUrl);

  siteVerdicts.set(cacheKey, {
    verdict,
    nextCheckAt: now + checkSec * 1000,
    thought: ai.thought.slice(0, 150),
    url: event.url,
    setAt: new Date().toISOString(),
    redirectUrl: resolvedRedirect
  });

  ringPush(recentAgentThoughts, {
    at: new Date().toISOString(),
    url: event.url,
    thought: ai.thought,
    verdict,
    prompted: ai.action?.type === "popup" || ai.action?.type === "popup_then_redirect" || Boolean(ai.shouldPrompt),
  }, MAX_RECENT_THOUGHTS);
}

export function verdictCacheKey(event: EventIngest): string {
  const url = event.url;
  let baseKey: string;

  if (!url.startsWith("app://")) {
    baseKey = hostnameOf(url);
  } else if (event.platform !== "other") {
    baseKey = event.platform;
  } else {
    const title = (event.title || "").toLowerCase();
    const knownDomains = ["youtube", "twitter", "x.com", "tiktok", "instagram", "reddit", "facebook"];
    baseKey = hostnameOf(url);
    for (const d of knownDomains) {
      if (title.includes(d)) {
        baseKey = d;
        break;
      }
    }
  }

  const isFeed = isFeedPath(url, event.platform);
  const curatedGatedDomains = ["youtube", "x.com", "twitter", "tiktok", "instagram", "reddit", "facebook"];
  const isCuratedGated = event.platform === "youtube" || event.platform === "x" ||
    curatedGatedDomains.some(d => baseKey.includes(d));

  if (isCuratedGated) {
    return `${baseKey}:${isFeed ? "feed" : "content"}`;
  }

  return baseKey;
}

export async function decide(event: EventIngest): Promise<EventDecisionResponse> {
  const cacheKey = verdictCacheKey(event);
  const { body: memoryBody, onboardingComplete } = readMemoryFile();
  const mode = readSocialMediaMode(memoryBody);
  const applyCuratedGate = mode !== "moderat";
  const curatedDecision = applyCuratedGate ? buildCuratedGateDecision(event) : null;
  if (curatedDecision) return curatedDecision;

  const cached = siteVerdicts.get(cacheKey);
  const now = Date.now();
  const cachedDecision = resolveCachedDecision({
    cached,
    nowMs: now,
    returnedAfterRedirect: event.returnedAfterRedirect,
    runtime: { provider: currentProvider(), model: currentModel() }
  });
  if (cachedDecision) {
    return cachedDecision;
  }

  stats.agentCalls += 1;
  const ai = await runAiDecision(event, memoryBody);
  if (ai.memoryMarkdown) {
    writeMemoryFile(ai.memoryMarkdown, onboardingComplete);
  } else if (ai.memoryOps?.length) {
    const newBody = applyMemoryOps(memoryBody, ai.memoryOps);
    writeMemoryFile(newBody, onboardingComplete);
  }

  if (ai.used) recordAgentResult(event, ai);

  let response: EventDecisionResponse;

  if (ai.used) {
    const baseAction = ai.action || { type: "none" as const };
    const verdict = ai.siteVerdict || "neutral";
    const action = enforceBadVerdictAction({
      verdict,
      baseAction,
      aiRedirectUrl: ai.redirectUrl,
      cachedRedirectUrl: cached?.redirectUrl
    });
    const actionIsPopup = action.type === "popup" || action.type === "popup_then_redirect";
    const actionNeedsImmediateRedirect = action.type === "redirect";
    const promptId = actionIsPopup ? `p-${Date.now()}` : undefined;
    const popupText = action.ui?.message || ai.promptText || "Hey, passt das gerade zu deinen Zielen?";

    if (promptId) {
      prompts.set(promptId, {
        platform: event.platform,
        url: event.url,
        text: popupText,
        actionType: action.type,
        options: action.ui?.options,
        redirectUrl: action.redirectUrl || ai.redirectUrl
      });
    }

    response = {
      shouldPrompt: actionIsPopup,
      promptId,
      promptText: actionIsPopup ? popupText : undefined,
      action,
      redirectUrl: action.redirectUrl || ai.redirectUrl,
      redirectImmediately: actionNeedsImmediateRedirect,
      siteVerdict: ai.siteVerdict,
      nextCheckSeconds: ai.nextCheckSeconds,
      reason: `agent: ${ai.reason || ai.thought}${(verdict === "bad" && action.type === "none") ? " [missing_redirect_url_for_bad]" : ""}`,
      goalQuestion: ai.goalQuestion,
      goalOptions: ai.goalOptions,
      suggestMedia: ai.suggestMedia,
      ai: { provider: currentProvider(), model: currentModel(), used: true, thought: ai.thought }
    };
  } else {
    response = {
      shouldPrompt: false,
      reason: `agent_offline: ${ai.thought}`,
      ai: { provider: currentProvider(), model: currentModel(), used: false, thought: ai.thought }
    };
  }

  ringPush(lastDecisions, { at: new Date().toISOString(), event, response, aiUsed: ai.used, agentThinking: ai.thought }, 500);
  return response;
}
