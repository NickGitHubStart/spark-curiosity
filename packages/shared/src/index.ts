export type Platform = "youtube" | "x" | "tiktok" | "instagram" | "reddit" | "other";
export type ContentMode = "shorts" | "feed" | "search" | "video" | "other";
export type GoalIntention = "avoid" | "reduce" | "keep";

/** Active media playback (from Android MediaSessionManager). */
export interface MediaSignal {
  pkg?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  positionMs?: number;
  state?: "playing" | "paused" | "stopped" | "buffering";
}

/** App usage statistics for today (from Android UsageStatsManager). */
export interface UsageSignal {
  todaySeconds?: number;
  last1hSeconds?: number;
  launchesToday?: number;
}

/** Structured client-side signals that enrich an event. Optional. */
export interface SignalBundle {
  media?: MediaSignal;
  usage?: UsageSignal;
  /** Hostnames recently contacted (e.g. via DNS). Newest first. */
  recentHosts?: string[];
}

export interface EventIngest {
  timestamp: string;
  platform: Platform;
  contentMode: ContentMode;
  url: string;
  title?: string;
  sessionSeconds: number;
  scrollCount: number;
  returnedAfterRedirect?: boolean;
  redirectedFromUrl?: string;
  /** Which device is sending this event. */
  thisPlatform?: "pc" | "android";
  /** Extended client-side signals (optional). */
  signals?: SignalBundle;
}

export interface UserGoal {
  platform: Platform;
  intention: GoalIntention;
  dailyLimitMinutes?: number;
  context?: string;
  setAt: string;
}

export interface MotivationalMedia {
  url: string;
  title: string;
  context?: string;
  addedAt: string;
  feedbackScore: number;
}

export type ToolName =
  | "redirect_and_close"
  | "open_curated_gate"
  | "set_curated_gate"
  | "update_memory"
  | "set_next_check"
  | "show_quote"
  | "show_prompt";

export type ToolTarget = { type: "url" | "app"; value: string };

export interface ToolRedirectArgs {
  target: ToolTarget;
  closeTab?: boolean;
  reason?: string;
}

export interface ToolOpenCuratedGateArgs {
  site?: string;
  fromUrl?: string;
  reason?: string;
}

export interface CuratedGateRule {
  id?: string;
  host?: string;
  hostSuffix?: string;
  pathPrefix?: string;
  pathRegex?: string;
  urlRegex?: string;
  note?: string;
}

export interface ToolSetCuratedGateArgs {
  mode: "set" | "add" | "remove" | "disable";
  rules?: CuratedGateRule[];
  ruleIds?: string[];
  note?: string;
}

export type MemorySection = "Long-Term" | "Mid-Term" | "Short-Term";

export interface MemoryOp {
  op: "add" | "remove" | "update";
  section: MemorySection;
  entry?: string;
  old?: string;
  new?: string;
}

export interface ToolUpdateMemoryArgs {
  ops: MemoryOp[];
}

export interface ToolSetNextCheckArgs {
  seconds: number;
}

export interface ToolShowQuoteArgs {
  text: string;
  author?: string;
}

export interface ToolPromptArgs {
  question: string;
}

export type ToolArgs =
  | ToolRedirectArgs
  | ToolOpenCuratedGateArgs
  | ToolSetCuratedGateArgs
  | ToolUpdateMemoryArgs
  | ToolSetNextCheckArgs
  | ToolShowQuoteArgs
  | ToolPromptArgs;

export interface ToolCall {
  tool: ToolName;
  args: ToolArgs;
}

export interface DesktopCommand {
  type: "redirect";
  url: string;
  closeTab?: boolean;
  reason?: string;
}

export interface QuoteCommand {
  type: "quote";
  text: string;
  author?: string;
}

export interface PromptCommand {
  type: "prompt";
  question: string;
}

export type DesktopCommandAny = DesktopCommand | QuoteCommand | PromptCommand;

export interface EventDecisionResponse {
  commands?: DesktopCommandAny[];
  nextCheckSeconds?: number;
  reason?: string;
  agentSkipped?: boolean;
  ai?: {
    provider: string;
    model: string;
    used: boolean;
    thought: string;
  };
  /** Set when the client supplied inline memory and the AI mutated it. */
  updatedMemoryBody?: string;
}

/** Alias used in cloud-proxy. */
export type Command = DesktopCommandAny;

export interface ChatRequest {
  message: string;
  timestamp: string;
}

export interface ChatResponse {
  reply: string;
  memoryUpdated: boolean;
  /** Wenn gesetzt: diese URL in einem neuen Tab öffnen (z. B. nach Chat-Aufforderung). */
  openUrl?: string;
  /** Kurze Stichpunkte was ins Memory eingetragen/geändert wurde. */
  memorySummary?: string[];
}

export interface MemoryEntry {
  text: string;
  at: string;
  source: "user" | "system" | "ai";
}

export interface MemorySnapshot {
  totalEvents: number;
  totalPrompts: number;
  totalFeedback: number;
  platformCounts: Record<string, number>;
  recentEvents: EventIngest[];
  notes: string[];
  goals: UserGoal[];
  motivationalMedia: MotivationalMedia[];
  shortTerm: MemoryEntry[];
  midTerm: MemoryEntry[];
  longTerm: MemoryEntry[];
  userPreferences: Record<string, string>;
  onboardingComplete?: boolean;
}

// Re-export shared pure-logic modules
export {
  stripCodeFences,
  stripLineCommentsOutsideStrings,
  extractBalancedJson,
  parseLooseJson,
} from "./json-utils.js";

export {
  DEFAULT_MEMORY_BODY,
  parseMemoryMarkdown,
  serializeMemoryToMarkdown,
  ensureTimestamp,
  applyMemoryOps,
  extractMemoryMarkdown,
  extractMemoryOps,
  buildWelcome,
} from "./memory-ops.js";
export type { MemoryEntry as ParsedMemoryEntry, ParsedMemory } from "./memory-ops.js";

export {
  normalizeCuratedGateRules,
  urlMatchesRules,
  titleMatchesRules,
  isFeedPath,
  applyCuratedGateOp,
} from "./curated-gate-matching.js";
export type { CuratedGatePolicy, CuratedGateUpdate } from "./curated-gate-matching.js";

export { parseToolCalls } from "./tool-calls.js";

