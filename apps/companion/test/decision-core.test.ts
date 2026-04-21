import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../src/decision.ts";
import { readMemoryFile, writeMemoryFile } from "../src/memory.ts";
import { setTestForcedAiJson } from "../src/ai.ts";

const baseEvent = {
  timestamp: new Date().toISOString(),
  platform: "youtube",
  contentMode: "feed",
  url: "https://youtube.com",
  sessionSeconds: 20,
  scrollCount: 3,
  title: "YouTube"
} as const;

test("decide applies close_tab tool (legacy redirect_and_close maps to close only)", async () => {
  setTestForcedAiJson(JSON.stringify({
    toolCalls: [
      { tool: "redirect_and_close", args: { target: { type: "url", value: "https://notion.so" }, closeTab: true, reason: "focus" } }
    ],
    reason: "focus"
  }));

  const decision = await decide({ ...baseEvent });
  setTestForcedAiJson(null);

  assert.ok(decision.commands?.length);
  assert.equal(decision.commands?.[0].type, "close_tab");
  assert.equal((decision.commands?.[0] as { reason?: string }).reason, "focus");
});

test("decide applies update_memory tool", async () => {
  writeMemoryFile("## Long-Term\n- (leer)\n\n## Mid-Term\n- (leer)\n\n## Short-Term\n- (leer)\n", true);
  setTestForcedAiJson(JSON.stringify({
    toolCalls: [
      { tool: "update_memory", args: { ops: [{ op: "add", section: "Short-Term", entry: "Test-Eintrag" }] } }
    ],
    reason: "log"
  }));

  await decide({ ...baseEvent, url: "https://example.com" });
  setTestForcedAiJson(null);

  const { body } = readMemoryFile();
  assert.ok(body.includes("Test-Eintrag"));
});

test("open_curated_gate tool emits close_tab only", async () => {
  setTestForcedAiJson(JSON.stringify({
    toolCalls: [
      { tool: "open_curated_gate", args: { site: "youtube.com", fromUrl: "https://youtube.com" } }
    ],
    reason: "curate"
  }));

  const decision = await decide({ ...baseEvent });
  setTestForcedAiJson(null);

  assert.equal(decision.commands?.[0].type, "close_tab");
  assert.equal((decision.commands?.[0] as { reason?: string }).reason, "curated_gate");
});
