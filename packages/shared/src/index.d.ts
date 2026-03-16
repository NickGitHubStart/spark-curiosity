export type Platform = "youtube" | "x" | "other";
export type ContentMode = "shorts" | "feed" | "search" | "other";
export type GoalIntention = "avoid" | "reduce" | "keep";

export interface EventIngest {
  timestamp: string;
  platform: Platform;
  contentMode: ContentMode;
  url: string;
  title?: string;
  sessionSeconds: number;
  scrollCount: number;
  lastProductiveUrl?: string;
  lastProductiveTitle?: string;
  returnedAfterRedirect?: boolean;
  redirectedFromUrl?: string;
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
}

export interface ChatRequest {
  message: string;
  timestamp: string;
}

export interface ChatResponse {
  reply: string;
  memoryUpdated: boolean;
  openUrl?: string;
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
