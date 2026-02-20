export type Platform = "youtube" | "x" | "other";
export type ContentMode = "shorts" | "feed" | "search" | "other";
export type ThumbFeedback = "up" | "down";
export type GoalIntention = "avoid" | "reduce" | "keep";

export interface EventIngest {
  timestamp: string;
  platform: Platform;
  contentMode: ContentMode;
  url: string;
  title?: string;
  sessionSeconds: number;
  scrollCount: number;
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
  type: "insight" | "goal" | "media" | "preference";
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
  goalQuestion?: string;
  goalOptions?: string[];
  suggestMedia?: string;
  ai?: {
    provider: string;
    model: string;
    used: boolean;
    thought: string;
  };
  recommendation?: string;
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

export interface MemorySnapshot {
  totalEvents: number;
  totalPrompts: number;
  totalFeedback: number;
  platformCounts: Record<string, number>;
  recentEvents: EventIngest[];
  notes: string[];
  goals: UserGoal[];
  motivationalMedia: MotivationalMedia[];
  llmInsights: string[];
  userPreferences: Record<string, string>;
}
