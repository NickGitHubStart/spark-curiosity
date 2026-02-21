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
  redirectUrl?: string;
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

export interface FeedbackResponse {
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
}
