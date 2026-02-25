export type Platform = "youtube" | "x" | "other";
export type ContentMode = "shorts" | "feed" | "search" | "other";
export type ThumbFeedback = "up" | "down";
export type GoalIntention = "avoid" | "reduce" | "keep";
export type SiteVerdict = "good" | "bad" | "neutral";

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

export interface MemoryWrite {
  type: "longTerm" | "midTerm" | "shortTerm" | "insight" | "goal" | "media" | "preference";
  text?: string;
  platform?: Platform;
  intention?: GoalIntention;
  dailyLimitMinutes?: number;
  context?: string;
  url?: string;
  title?: string;
  key?: string;
  value?: string;
}

export interface EventDecisionResponse {
  shouldPrompt: boolean;
  promptId?: string;
  promptText?: string;
  reason: string;
  action?: AgentAction;
  redirectUrl?: string;
  redirectImmediately?: boolean;
  postRedirectReview?: {
    question: string;
    options: string[];
    fromUrl?: string;
  };
  siteVerdict?: SiteVerdict;
  nextCheckSeconds?: number;
  goalQuestion?: string;
  goalOptions?: string[];
  suggestMedia?: string;
  agentSkipped?: boolean;
  ai?: {
    provider: string;
    model: string;
    used: boolean;
    thought: string;
  };
}

export interface FeedbackEvent {
  promptId: string;
  feedback: ThumbFeedback;
  timestamp: string;
}

export interface GoalFeedbackEvent {
  promptId: string;
  selectedOption: string;
  platform: Platform;
  timestamp: string;
}

export interface RedirectReviewEvent {
  platform: Platform;
  selectedOption: string;
  fromUrl?: string;
  timestamp: string;
}

export interface FeedbackResponse {
  accepted: boolean;
  redirectUrl?: string;
}

export interface InteractionFeedbackEvent {
  promptId: string;
  selectedOption: string;
  timestamp: string;
}

export interface InteractionFeedbackResponse {
  accepted: boolean;
  redirectUrl?: string;
}

export interface ChatRequest {
  message: string;
  timestamp: string;
}

export interface ChatResponse {
  reply: string;
  memoryUpdated: boolean;
  /** Wenn gesetzt: diese URL in einem neuen Tab öffnen (z. B. nach Chat-Aufforderung). */
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

export type AgentActionType = "none" | "popup" | "redirect" | "popup_then_redirect";
export type AgentUiVariant = "binary" | "multi_choice" | "reflect";

export interface AgentUiSpec {
  variant: AgentUiVariant;
  title?: string;
  message: string;
  options?: string[];
}

export interface AgentAction {
  type: AgentActionType;
  redirectUrl?: string;
  ui?: AgentUiSpec;
}
