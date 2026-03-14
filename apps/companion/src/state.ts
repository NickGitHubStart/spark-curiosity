import type { Platform, SiteVerdict, AgentActionType } from "@spark/shared";

export interface ClientLog { at: string; level: "info" | "warn" | "error"; message: string; context?: Record<string, unknown> }

export interface SiteVerdictEntry {
  verdict: SiteVerdict;
  nextCheckAt: number;
  thought: string;
  url: string;
  setAt: string;
  redirectUrl?: string;
}

export interface AgentThought {
  at: string;
  url: string;
  thought: string;
  verdict: SiteVerdict;
  prompted: boolean;
}

export interface AiUsageMeta {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

export const clientLogs: ClientLog[] = [];
export const lastDecisions: Array<Record<string, unknown>> = [];
export const feedbackLog: Array<Record<string, unknown>> = [];
export const chatLog: Array<Record<string, unknown>> = [];
export const prompts = new Map<string, {
  platform: Platform;
  url: string;
  text: string;
  actionType: AgentActionType;
  options?: string[];
  redirectUrl?: string;
}>();
export const siteVerdicts = new Map<string, SiteVerdictEntry>();
export const recentAgentThoughts: AgentThought[] = [];
export const MAX_RECENT_THOUGHTS = 4;

export const stats = {
  eventsReceived: 0,
  feedbackReceived: 0,
  chatMessages: 0,
  agentCalls: 0,
  agentSkips: 0,
  lastEventAt: "",
  lastFeedbackAt: "",
  lastChatAt: "",
  aiPromptTokens: 0,
  aiCompletionTokens: 0,
  aiTotalTokens: 0,
  aiEstimatedCostUsd: 0,
  aiCostTrackedCalls: 0,
  aiUnpricedCalls: 0
};

export function recordAiUsage(usage?: AiUsageMeta): void {
  if (!usage) return;
  stats.aiPromptTokens += usage.promptTokens;
  stats.aiCompletionTokens += usage.completionTokens;
  stats.aiTotalTokens += usage.totalTokens || (usage.promptTokens + usage.completionTokens);
  if (typeof usage.estimatedCostUsd === "number") {
    stats.aiEstimatedCostUsd += usage.estimatedCostUsd;
    stats.aiCostTrackedCalls += 1;
  } else {
    stats.aiUnpricedCalls += 1;
  }
}

export function ringPush<T>(arr: T[], item: T, max: number): void {
  arr.push(item);
  if (arr.length > max) arr.shift();
}

// Allowlist removed: LLM decides per-event based on context and memory.
