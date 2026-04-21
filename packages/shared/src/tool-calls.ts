/**
 * Tool-call parsing from LLM JSON responses.
 * No I/O — works identically on Node.js and Cloudflare Workers.
 */

import type { ToolCall, ToolName } from "./index.js";

const TOOL_NAMES: ToolName[] = [
  "close_tab",
  "redirect_and_close",
  "open_curated_gate",
  "set_curated_gate",
  "update_memory",
  "set_next_check",
  "show_quote",
  "show_prompt"
];

export function parseToolCalls(parsed: Record<string, unknown>): ToolCall[] {
  const raw = parsed.toolCalls;
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const tool = typeof rec.tool === "string" ? rec.tool : "";
    if (!TOOL_NAMES.includes(tool as ToolName)) continue;
    const args = (rec.args && typeof rec.args === "object") ? rec.args as Record<string, unknown> : {};
    out.push({ tool: tool as ToolName, args });
  }
  return out;
}
