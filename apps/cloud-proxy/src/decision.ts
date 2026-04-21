/**
 * Decision engine — ported from apps/companion/src/decision.ts
 * Stateless per-request (no in-memory cache; Worker instances are ephemeral).
 * Uses D1 for memory + curated gate reads/writes.
 */

import type { EventIngest, ToolCall, Command, EventDecisionResponse, Env } from "./types.js";
import { runAiDecision, type AiDecisionResult } from "./ai.js";
import { readMemory, writeMemory, applyMemoryOps } from "./d1-memory.js";
import {
  readCuratedGate, applyCuratedGateUpdate, curatedGateMatches,
  curatedGateMatchesByTitle, isFeedPath, type CuratedGateUpdate
} from "./d1-curated-gate.js";
import { recordBlockEvent } from "./stats.js";
import { writePlatformContext, readPlatformContext, type PlatformContext } from "./d1-platform-context.js";

const GROK_MODEL = "grok-4-1-fast";
const IDLE_NEXT_CHECK_SECONDS = 1200;
const POLICY_GATE_NEXT_CHECK_SECONDS = 180;

function applyToolCalls(
  event: EventIngest,
  toolCalls: ToolCall[] | undefined,
  memoryBody: string
): { commands: Command[]; nextCheckSeconds?: number; memoryBody: string; gateUpdate?: CuratedGateUpdate } {
  const commands: Command[] = [];
  let nextCheckSeconds: number | undefined;
  let updatedMemoryBody = memoryBody;
  let gateUpdate: CuratedGateUpdate | undefined;

  for (const call of toolCalls || []) {
    switch (call.tool) {
      case "close_tab": {
        const args = call.args as { reason?: string };
        commands.push({ type: "close_tab", reason: typeof args?.reason === "string" ? args.reason : undefined });
        break;
      }
      case "redirect_and_close": {
        const args = call.args as { reason?: string };
        commands.push({ type: "close_tab", reason: args?.reason });
        break;
      }
      case "open_curated_gate": {
        const args = call.args as { site?: string; fromUrl?: string; reason?: string };
        commands.push({ type: "close_tab", reason: args?.reason || "curated_gate" });
        break;
      }
      case "set_curated_gate": {
        const args = call.args as { mode?: string; rules?: unknown[]; ruleIds?: string[]; note?: string };
        const validModes = ["set", "add", "remove", "disable"] as const;
        if (args?.mode && (validModes as readonly string[]).includes(args.mode)) {
          gateUpdate = {
            mode: args.mode as CuratedGateUpdate["mode"],
            rules: Array.isArray(args.rules) ? args.rules as CuratedGateUpdate["rules"] : undefined,
            ruleIds: args.ruleIds,
            note: typeof args.note === "string" ? args.note : undefined
          };
        }
        break;
      }
      case "update_memory": {
        const args = call.args as { ops?: Array<{ op: string; section: string; entry?: string; old?: string; new?: string }> };
        if (args?.ops?.length) {
          const deviceLabel = event.thisPlatform === "pc" ? "[PC]" : event.thisPlatform === "android" ? "[Phone]" : null;
          const taggedOps = deviceLabel
            ? args.ops.map(op => ({ ...op, entry: op.entry ? `${deviceLabel} ${op.entry}` : op.entry }))
            : args.ops;
          updatedMemoryBody = applyMemoryOps(updatedMemoryBody, taggedOps as Parameters<typeof applyMemoryOps>[1]);
        }
        break;
      }
      case "set_next_check": {
        const args = call.args as { seconds?: number };
        if (typeof args?.seconds === "number" && Number.isFinite(args.seconds)) {
          nextCheckSeconds = Math.max(10, Math.floor(args.seconds));
        }
        break;
      }
      case "show_quote": {
        const args = call.args as { text?: string; author?: string };
        const text = (args?.text || "").trim().slice(0, 260);
        const author = (args?.author || "").trim().slice(0, 120) || undefined;
        if (text) commands.push({ type: "quote", text, author });
        break;
      }
      case "show_prompt": {
        const args = call.args as { question?: string };
        const question = (args?.question || "").trim().slice(0, 240);
        if (question) commands.push({ type: "prompt", question });
        break;
      }
    }
  }

  return { commands, nextCheckSeconds, memoryBody: updatedMemoryBody, gateUpdate };
}

function buildContextSummary(event: EventIngest): string {
  // Build a short human-readable description of what the user is doing right now.
  const parts: string[] = [];
  if (event.title) parts.push(event.title);
  else if (event.url) {
    try { parts.push(new URL(event.url).hostname); } catch { parts.push(event.url.slice(0, 60)); }
  }
  if (event.platform !== "other") parts.push(event.platform);
  if (event.contentMode !== "other") parts.push(event.contentMode);
  return parts.join(", ").slice(0, 200);
}

export async function decide(
  event: EventIngest,
  token: string,
  env: Env,
  inlineMemory?: { body: string; onboardingComplete: boolean },
): Promise<EventDecisionResponse> {
  const db = env.DB;
  // If the client supplied memory inline (encrypted-memory mode), use it and
  // return the updated body for the client to re-encrypt + persist. Otherwise
  // fall back to the legacy D1-plaintext path (Windows companion until phase 4).
  const useInline = inlineMemory != null;
  const { body: memoryBody, onboardingComplete } = useInline
    ? inlineMemory!
    : await readMemory(db, token);

  // ── Platform context: write own + read other ──
  const thisPlatform = event.thisPlatform; // "pc" | "android" | undefined
  let otherPlatformContext: PlatformContext | null = null;
  if (thisPlatform) {
    const otherPlatform: "pc" | "android" = thisPlatform === "pc" ? "android" : "pc";
    const summary = buildContextSummary(event);
    // Fire-and-forget: write own context (don't block on it)
    void writePlatformContext(db, token, thisPlatform, summary, event.url).catch(() => {});
    // Read other platform's context (best-effort, max 30s staleness is fine)
    otherPlatformContext = await readPlatformContext(db, token, otherPlatform).catch(() => null);
  }

  // ── Curated Gate fast path ──
  const policy = await readCuratedGate(db, token);
  const hostMatch = policy.enabled ? curatedGateMatches(policy, event.url) : false;
  const appMatch = policy.enabled ? curatedGateMatchesByTitle(policy, event.title || "", event.url) : null;
  const feedMatch = hostMatch ? isFeedPath(event.url, event.platform) : false;
  const curatedGateDirect = Boolean(appMatch || feedMatch);

  if (curatedGateDirect) {
    await recordBlockEvent(db, token, {
      platform: event.platform, url: event.url, action: "curated_gate", sessionSeconds: event.sessionSeconds
    });

    return {
      commands: [{
        type: "close_tab",
        reason: "curated_gate_policy"
      }],
      nextCheckSeconds: POLICY_GATE_NEXT_CHECK_SECONDS,
      reason: "curated_gate_policy",
      agentSkipped: false,
      ai: { provider: "grok", model: GROK_MODEL, used: false, thought: "curated_gate_policy" }
    };
  }

  // ── AI Decision ──
  const ai = await runAiDecision(event, memoryBody, env, otherPlatformContext);

  if (!ai.used) {
    return {
      reason: `agent_offline: ${ai.thought}`,
      agentSkipped: true,
      ai: { provider: "grok", model: GROK_MODEL, used: false, thought: ai.thought }
    };
  }

  const { commands, nextCheckSeconds, memoryBody: updatedMemoryBody, gateUpdate } = applyToolCalls(event, ai.toolCalls, memoryBody);

  // Persist memory changes.
  // Always write plaintext to D1 so Windows (legacy) and Android stay in sync.
  // In inline mode the client ALSO persists its encrypted blob.
  const memoryChanged = updatedMemoryBody !== memoryBody;
  if (memoryChanged) {
    await writeMemory(db, token, updatedMemoryBody, onboardingComplete);
  }

  // Persist curated gate changes
  if (gateUpdate) {
    await applyCuratedGateUpdate(db, token, gateUpdate);
  }

  const hadCloseTab = commands.some(c => c.type === "close_tab");
  if (hadCloseTab) {
    await recordBlockEvent(db, token, {
      platform: event.platform, url: event.url, action: "ai_close_tab", sessionSeconds: event.sessionSeconds
    });
  }

  let effectiveNext = nextCheckSeconds;
  if (effectiveNext === undefined && commands.length === 0) {
    effectiveNext = IDLE_NEXT_CHECK_SECONDS;
  }

  return {
    commands: commands.length ? commands : undefined,
    nextCheckSeconds: effectiveNext,
    reason: ai.reason || ai.thought,
    agentSkipped: false,
    ai: { provider: "grok", model: GROK_MODEL, used: true, thought: ai.thought },
    // Inline-mode clients re-encrypt and persist this themselves.
    updatedMemoryBody: useInline && memoryChanged ? updatedMemoryBody : undefined,
  };
}
