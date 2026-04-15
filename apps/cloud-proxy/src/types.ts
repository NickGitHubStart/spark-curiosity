/**
 * Shared types for the Spark Cloud Companion.
 * Mirrors @spark/shared but standalone (no npm dependency needed in Worker).
 */

export type Platform = "youtube" | "x" | "tiktok" | "instagram" | "reddit" | "other";
export type ContentMode = "shorts" | "feed" | "search" | "other";
export type MemorySection = "Long-Term" | "Mid-Term" | "Short-Term";

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
  /** Which device is sending this event. Used to identify the "other" platform for shared context. */
  thisPlatform?: "pc" | "android";
}

export interface MemoryOp {
  op: "add" | "remove" | "update";
  section: MemorySection;
  entry?: string;
  old?: string;
  new?: string;
}

export type ToolName =
  | "redirect_and_close"
  | "open_curated_gate"
  | "set_curated_gate"
  | "update_memory"
  | "set_next_check"
  | "show_quote"
  | "show_prompt";

export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
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

export type Command = DesktopCommand | QuoteCommand | PromptCommand;

export interface EventDecisionResponse {
  commands?: Command[];
  nextCheckSeconds?: number;
  reason?: string;
  agentSkipped?: boolean;
  ai?: { provider: string; model: string; used: boolean; thought: string };
  /** Set when the client supplied inline memory and the AI mutated it.
   *  Client must re-encrypt and POST /memory/encrypted. */
  updatedMemoryBody?: string;
}

export interface ChatRequest {
  message: string;
  timestamp: string;
}

export interface ChatResponse {
  reply: string;
  memoryUpdated: boolean;
  openUrl?: string;
  memorySummary?: string[];
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

export interface CuratedGatePolicy {
  enabled: boolean;
  rules: CuratedGateRule[];
  updatedAt?: string;
  note?: string;
}

export interface Env {
  TOKENS: KVNamespace;
  DB: D1Database;
  AI: Ai;
  OPENAI_API_KEY: string;
  XAI_API_KEY: string;
  REGISTER_SECRET?: string;
}
