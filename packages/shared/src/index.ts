export type Platform = "youtube" | "x" | "other";
export type ContentMode = "shorts" | "feed" | "search" | "other";
export type ThumbFeedback = "up" | "down";

export interface EventIngest {
  timestamp: string;
  platform: Platform;
  contentMode: ContentMode;
  url: string;
  title?: string;
  sessionSeconds: number;
  scrollCount: number;
}

export interface EventDecisionResponse {
  shouldPrompt: boolean;
  promptId?: string;
  promptText?: string;
  reason: string;
}

export interface FeedbackEvent {
  promptId: string;
  feedback: ThumbFeedback;
  timestamp: string;
}

export interface FeedbackResponse {
  accepted: boolean;
  redirectUrl?: string;
}

export interface MemorySnapshot {
  totalEvents: number;
  totalPrompts: number;
  totalFeedback: number;
  platformCounts: Record<string, number>;
  recentEvents: EventIngest[];
  notes: string[];
}
