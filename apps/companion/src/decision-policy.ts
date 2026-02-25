import type { AgentAction, EventDecisionResponse, SiteVerdict } from "@spark/shared";

export interface CachedVerdictEntry {
  verdict: SiteVerdict;
  nextCheckAt: number;
  thought: string;
  redirectUrl?: string;
}

export interface RuntimeIdentity {
  provider: string;
  model: string;
}

export function safeRedirectUrl(candidate?: string): string | undefined {
  return (typeof candidate === "string" && candidate.startsWith("http")) ? candidate : undefined;
}

export function firstValidRedirectUrl(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const valid = safeRedirectUrl(candidate);
    if (valid) return valid;
  }
  return undefined;
}

export function resolveCachedDecision(args: {
  cached?: CachedVerdictEntry;
  nowMs: number;
  returnedAfterRedirect?: boolean;
  runtime: RuntimeIdentity;
}): EventDecisionResponse | null {
  const { cached, nowMs, returnedAfterRedirect, runtime } = args;
  if (!cached || returnedAfterRedirect || nowMs >= cached.nextCheckAt) return null;

  const expiresInSec = Math.max(1, Math.ceil((cached.nextCheckAt - nowMs) / 1000));
  if (cached.verdict === "bad") {
    const target = safeRedirectUrl(cached.redirectUrl);
    if (!target) return null;
    return {
      shouldPrompt: false,
      action: { type: "redirect", redirectUrl: target },
      redirectUrl: target,
      redirectImmediately: true,
      siteVerdict: "bad",
      nextCheckSeconds: expiresInSec,
      reason: `cached_bad_enforced (next check in ${expiresInSec}s)`,
      agentSkipped: true,
      ai: { provider: runtime.provider, model: runtime.model, used: false, thought: cached.thought || "cached bad verdict" }
    };
  }

  return {
    shouldPrompt: false,
    action: { type: "none" },
    siteVerdict: cached.verdict,
    nextCheckSeconds: expiresInSec,
    reason: `cached (next check in ${expiresInSec}s)`,
    agentSkipped: true,
    ai: { provider: runtime.provider, model: runtime.model, used: false, thought: cached.thought || "cached verdict" }
  };
}

export function enforceBadVerdictAction(args: {
  verdict: SiteVerdict;
  baseAction: AgentAction;
  aiRedirectUrl?: string;
  cachedRedirectUrl?: string;
}): AgentAction {
  const { verdict, baseAction, aiRedirectUrl, cachedRedirectUrl } = args;
  const resolvedRedirect = firstValidRedirectUrl(
    safeRedirectUrl(baseAction.redirectUrl),
    safeRedirectUrl(aiRedirectUrl),
    cachedRedirectUrl
  );

  if (baseAction.type === "popup_then_redirect") {
    if (resolvedRedirect) return { ...baseAction, redirectUrl: resolvedRedirect };
    return { type: "popup", ui: baseAction.ui };
  }

  if (verdict !== "bad") {
    return baseAction.type === "none"
      ? baseAction
      : resolvedRedirect
        ? { ...baseAction, redirectUrl: resolvedRedirect }
        : baseAction;
  }

  if (resolvedRedirect) return { type: "redirect", redirectUrl: resolvedRedirect };
  return { type: "none" };
}
