/**
 * Persist Grok call count in KV (Workers are ephemeral; D1 row not required).
 * After EVERY_N memory-backed Grok round-trips (decision + chat), run MEMORY_CLEANUP.
 */

import type { Env } from "./types.js";
import { readMemory, writeMemory, applyMemoryOps } from "./d1-memory.js";

const kvKey = (token: string) => `spark_memcleanup:${token}`;
const EVERY_N = 50;

export async function bumpAfterGrokWithMemory(env: Env, token: string): Promise<void> {
  if (!env.XAI_API_KEY || !token) return;
  const cur = await env.TOKENS.get(kvKey(token));
  const prev = cur ? parseInt(cur, 10) : 0;
  const n = (Number.isFinite(prev) ? prev : 0) + 1;
  if (n < EVERY_N) {
    await env.TOKENS.put(kvKey(token), String(n));
    return;
  }
  await env.TOKENS.put(kvKey(token), "0");
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
  } catch {
    /* best-effort */
  }
}
