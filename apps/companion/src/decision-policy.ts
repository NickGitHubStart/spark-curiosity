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

export function fallbackRedirectUrl(defaultRedirectUrl: string, ...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const valid = safeRedirectUrl(candidate);
    if (valid) return valid;
  }
  return defaultRedirectUrl;
}

export function resolveCachedDecision(args: {
  cached?: CachedVerdictEntry;
  nowMs: number;
  returnedAfterRedirect?: boolean;
  defaultRedirectUrl: string;
  runtime: RuntimeIdentity;
}): EventDecisionResponse | null {
  const { cached, nowMs, returnedAfterRedirect, defaultRedirectUrl, runtime } = args;
  if (!cached || returnedAfterRedirect || nowMs >= cached.nextCheckAt) return null;

  const expiresInSec = Math.max(1, Math.ceil((cached.nextCheckAt - nowMs) / 1000));
  if (cached.verdict === "bad") {
    const target = fallbackRedirectUrl(defaultRedirectUrl, cached.redirectUrl);
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
  defaultRedirectUrl: string;
}): AgentAction {
  const { verdict, baseAction, aiRedirectUrl, cachedRedirectUrl, defaultRedirectUrl } = args;
  const resolvedRedirect = fallbackRedirectUrl(
    defaultRedirectUrl,
    safeRedirectUrl(baseAction.redirectUrl),
    safeRedirectUrl(aiRedirectUrl),
    cachedRedirectUrl
  );

  if (verdict !== "bad") {
    return baseAction.type === "none"
      ? baseAction
      : { ...baseAction, redirectUrl: baseAction.redirectUrl || aiRedirectUrl };
  }

  if (baseAction.type === "popup_then_redirect") {
    return { ...baseAction, redirectUrl: resolvedRedirect };
  }

  return { type: "redirect", redirectUrl: resolvedRedirect };
}
