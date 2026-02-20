export type Platform = "youtube" | "x" | "other";
export type ContentMode = "shorts" | "feed" | "search" | "article" | "unknown";
export type ThumbFeedback = "up" | "down";
export interface BehaviorSignals {
    sessionSeconds: number;
    scrollEvents: number;
    tabSwitches: number;
}
export interface EventIngest {
    timestamp: string;
    platform: Platform;
    contentMode: ContentMode;
    url: string;
    signals: BehaviorSignals;
    content?: ContentSnapshot;
}
export interface ContentSnapshot {
    pageTitle?: string;
    textSample?: string;
    youtube?: {
        videoTitle?: string;
        channelName?: string;
        isShort?: boolean;
    };
    x?: {
        postSamples?: string[];
    };
}
export interface Recommendation {
    title: string;
    url: string;
}
export interface AdaptiveCheckPrompt {
    id: string;
    text: string;
    createdAt: string;
}
export interface VisualPayload {
    type: "generated" | "static";
    url: string;
    caption?: string;
}
export interface Intervention {
    id: string;
    kind: "intent_check" | "redirect" | "block";
    message: string;
    visual?: VisualPayload;
    options?: string[];
    recommendations?: Recommendation[];
}
export interface FeedbackEvent {
    promptId: string;
    feedback: ThumbFeedback;
    timestamp: string;
}
export interface EventDecisionResponse {
    shouldPrompt: boolean;
    riskScore: number;
    decisionSource?: "llm" | "fallback";
    reasonCodes?: string[];
    modelUsed?: string;
    prompt?: AdaptiveCheckPrompt;
    intervention?: Intervention;
}
export interface FeedbackResponse {
    accepted: boolean;
    memoryChanges?: string[];
    action?: {
        type: "none" | "redirect";
        url?: string;
    };
}
export interface MemorySnapshot {
    shortTermEvents?: Array<{
        id: string;
        timestamp: string;
        platform: Platform;
        contentMode: ContentMode;
        summary: string;
    }>;
    longTermGoals: Array<{
        name: string;
        confidence: number;
        lastSeen: string;
    }>;
    midTermPatterns: Array<{
        pattern: string;
        confidence: number;
        lastSeen: string;
    }>;
    motivationalMedia?: Array<{
        title: string;
        url: string;
        confidence: number;
        lastSeen: string;
    }>;
    shortTermState: {
        activeIntent?: string;
        agentStyleHint?: string;
        currentRiskScore: number;
        lastUpdated: string;
    };
}
export interface LlmDecision {
    riskDelta?: number;
    popupText?: string;
    intentGuess?: string;
    styleHint?: string;
    interests?: string[];
    patterns?: string[];
    recommendations?: Recommendation[];
}
