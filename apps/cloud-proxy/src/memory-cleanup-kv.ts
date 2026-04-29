/**
 * Count successful POST /event (decide) per user in KV. After EVERY_N, run MEMORY_CLEANUP
 * in the background (do not block the HTTP response on the extra LLM round).
 *
 * Only decision events — not /chat, not health. One increment per event whether or not Grok ran
 * (cache hit, curated-gate short path, or full LLM).
 */

import type { Env } from "./types.js";
import { readMemory, writeMemory, applyMemoryOps } from "./d1-memory.js";

const kvKey = (token: string) => `mcev:${token}`;
export const EVERY_N_API_FOR_MEMORY_CLEANUP = 100;

const runningForToken = new Set<string>();

export async function recordEventForMemoryCleanup(env: Env, token: string): Promise<void> {
  if (!env.XAI_API_KEY || !token) return;
  const cur = await env.TOKENS.get(kvKey(token));
  const prev = cur ? parseInt(cur, 10) : 0;
  const n = (Number.isFinite(prev) ? prev : 0) + 1;
  if (n < EVERY_N_API_FOR_MEMORY_CLEANUP) {
    await env.TOKENS.put(kvKey(token), String(n));
    return;
  }
  await env.TOKENS.put(kvKey(token), "0");
  if (runningForToken.has(token)) return;
  runningForToken.add(token);
  void (async () => {
    try {
      const { runAiMemoryCleanup } = await import("./ai.js");
      const { body, onboardingComplete } = await readMemory(env.DB, token);
      const result = await runAiMemoryCleanup(body, env);
      let nextBody = body;
      let changed = false;
      if (result.memoryOps?.length) {
        const updated = applyMemoryOps(body, result.memoryOps);
        if (updated !== body) {
          nextBody = updated;
          changed = true;
        }
      } else if (result.memoryMarkdown) {
        nextBody = result.memoryMarkdown;
        changed = true;
      }
      if (changed) await writeMemory(env.DB, token, nextBody, onboardingComplete);
      // eslint-disable-next-line no-console
      if (changed) console.log(`[memory-cleanup] token=${token.slice(0, 6)}… updated`);
      // eslint-disable-next-line no-console
      else console.log(`[memory-cleanup] token=${token.slice(0, 6)}… no changes from model`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[memory-cleanup] failed", e);
    } finally {
      runningForToken.delete(token);
    }
  })();
}
