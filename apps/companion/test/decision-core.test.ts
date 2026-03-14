import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCuratedGateDecision, isFeedPath, setCuratedGatePolicy } from "../src/curated-gate.ts";
import { verdictCacheKey, decide } from "../src/decision.ts";
import { readSocialMediaMode, writeMemoryFile } from "../src/memory.ts";
import { setTestForcedAiJson } from "../src/ai.ts";

test("isFeedPath detects feeds vs content", () => {
  assert.equal(isFeedPath("https://www.youtube.com/", "youtube"), true);
  assert.equal(isFeedPath("https://www.youtube.com/watch?v=abc", "youtube"), false);
  assert.equal(isFeedPath("https://x.com/home", "x"), true);
  assert.equal(isFeedPath("https://x.com/someuser/status/123", "x"), false);
});

test("verdictCacheKey splits feed vs content for curated domains", () => {
  const feedKey = verdictCacheKey({
    timestamp: new Date().toISOString(),
    platform: "youtube",
    contentMode: "feed",
    url: "https://youtube.com/feed/subscriptions",
    sessionSeconds: 10,
    scrollCount: 2,
    title: "subs"
  });
  const contentKey = verdictCacheKey({
    timestamp: new Date().toISOString(),
    platform: "youtube",
    contentMode: "other",
    url: "https://youtube.com/watch?v=abc",
    sessionSeconds: 10,
    scrollCount: 2,
    title: "watch"
  });
  assert.notEqual(feedKey, contentKey);
  assert.ok(feedKey.endsWith(":feed"));
  assert.ok(contentKey.endsWith(":content"));
});

test("moderate mode skips curated gate redirect", async () => {
  setCuratedGatePolicy({ enabled: true, rules: [{ host: "youtube.com" }] });
  writeMemoryFile(`## Long-Term\n- Social-Media-Modus: moderat\n\n## Mid-Term\n- (leer)\n\n## Short-Term\n- (leer)\n`, true);
  setTestForcedAiJson(JSON.stringify({
    action: { type: "none" },
    siteVerdict: "neutral",
    nextCheckSeconds: 60,
    reason: "ok"
  }));

  const decision = await decide({
    timestamp: new Date().toISOString(),
    platform: "youtube",
    contentMode: "feed",
    url: "https://youtube.com",
    sessionSeconds: 20,
    scrollCount: 3,
    title: "YouTube"
  });

  setTestForcedAiJson(null);
  assert.notEqual(decision.action?.type, "redirect");
  assert.notEqual(decision.reason, "curated_gate_redirect");
});

test("buildCuratedGateDecision only redirects feeds", () => {
  setCuratedGatePolicy({ enabled: true, rules: [{ host: "youtube.com" }] });
  const feed = buildCuratedGateDecision({
    timestamp: new Date().toISOString(),
    platform: "youtube",
    contentMode: "feed",
    url: "https://youtube.com",
    sessionSeconds: 10,
    scrollCount: 1,
    title: "YouTube"
  });
  const content = buildCuratedGateDecision({
    timestamp: new Date().toISOString(),
    platform: "youtube",
    contentMode: "other",
    url: "https://youtube.com/watch?v=abc",
    sessionSeconds: 10,
    scrollCount: 1,
    title: "Watch"
  });
  assert.ok(feed);
  assert.equal(content, null);
});

test("komplett-vermeiden mode triggers curated gate redirect", async () => {
  setCuratedGatePolicy({ enabled: true, rules: [{ host: "youtube.com" }] });
  writeMemoryFile(`## Long-Term\n- Social-Media-Modus: komplett-vermeiden\n\n## Mid-Term\n- (leer)\n\n## Short-Term\n- (leer)\n`, true);

  const decision = await decide({
    timestamp: new Date().toISOString(),
    platform: "youtube",
    contentMode: "feed",
    url: "https://youtube.com",
    sessionSeconds: 20,
    scrollCount: 3,
    title: "YouTube"
  });

  assert.equal(decision.action?.type, "redirect");
  assert.equal(decision.reason, "curated_gate_redirect");
});

test("readSocialMediaMode parses memory line", () => {
  const mode = readSocialMediaMode("## Long-Term\n- Social-Media-Modus: moderat\n");
  assert.equal(mode, "moderat");
});
