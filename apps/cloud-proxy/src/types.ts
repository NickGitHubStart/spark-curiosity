/**
 * Re-exports shared types + Worker-specific Env binding.
 */

export type {
  Platform,
  ContentMode,
  MemorySection,
  EventIngest,
  MemoryOp,
  ToolName,
  ToolCall,
  CloseTabCommand,
  QuoteCommand,
  PromptCommand,
  DesktopCommandAny as Command,
  EventDecisionResponse,
  ChatRequest,
  ChatResponse,
  CuratedGateRule,
} from "@spark/shared";

export { type CuratedGatePolicy } from "@spark/shared";

export interface Env {
  TOKENS: KVNamespace;
  DB: D1Database;
  AI: Ai;
  OPENAI_API_KEY: string;
  XAI_API_KEY: string;
  REGISTER_SECRET?: string;
}
