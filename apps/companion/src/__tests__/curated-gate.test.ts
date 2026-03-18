import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set SPARK_DATA_DIR before importing modules that read config at load time.
let tmpDataDir: string;

// We use dynamic imports so SPARK_DATA_DIR is set before config.ts runs.
let isFeedPath: typeof import("../curated-gate.js").isFeedPath;
let curatedGateMatches: typeof import("../curated-gate.js").curatedGateMatches;
let normalizeCuratedGateRules: typeof import("../curated-gate.js").normalizeCuratedGateRules;
let setCuratedGatePolicy: typeof import("../curated-gate.js").setCuratedGatePolicy;

before(async () => {
  tmpDataDir = mkdtempSync(join(tmpdir(), "spark-curated-gate-test-"));
  process.env.SPARK_DATA_DIR = tmpDataDir;
  const mod = await import("../curated-gate.js");
  isFeedPath = mod.isFeedPath;
  curatedGateMatches = mod.curatedGateMatches;
  normalizeCuratedGateRules = mod.normalizeCuratedGateRules;
  setCuratedGatePolicy = mod.setCuratedGatePolicy;
});

after(() => {
  rmSync(tmpDataDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/*  isFeedPath                                                         */
/* ------------------------------------------------------------------ */
describe("isFeedPath", () => {
  // YouTube
  it("detects YouTube feed (root)", () => {
    assert.equal(isFeedPath("https://www.youtube.com/", "youtube"), true);
  });

  it("detects YouTube shorts", () => {
    assert.equal(isFeedPath("https://www.youtube.com/shorts/abc123", "youtube"), true);
  });

  it("detects YouTube /feed path", () => {
    assert.equal(isFeedPath("https://www.youtube.com/feed/subscriptions", "youtube"), true);
  });

  it("does not match YouTube video pages", () => {
    assert.equal(isFeedPath("https://www.youtube.com/watch?v=abc123", "youtube"), false);
  });

  it("does not match YouTube channel pages", () => {
    assert.equal(isFeedPath("https://www.youtube.com/@channelname/videos", "youtube"), false);
  });

  // X / Twitter
  it("detects X/Twitter home", () => {
    assert.equal(isFeedPath("https://x.com/home", "x"), true);
    assert.equal(isFeedPath("https://x.com/", "x"), true);
  });

  it("detects X explore", () => {
    assert.equal(isFeedPath("https://x.com/explore", "x"), true);
  });

  it("detects X trends", () => {
    assert.equal(isFeedPath("https://x.com/i/trends", "x"), true);
  });

  it("does not match X profile pages", () => {
    assert.equal(isFeedPath("https://x.com/username/status/123", "x"), false);
  });

  // TikTok
  it("detects TikTok feed", () => {
    assert.equal(isFeedPath("https://www.tiktok.com/", "other"), true);
    assert.equal(isFeedPath("https://www.tiktok.com/foryou", "other"), true);
    assert.equal(isFeedPath("https://www.tiktok.com/following", "other"), true);
  });

  it("detects TikTok user feed", () => {
    assert.equal(isFeedPath("https://www.tiktok.com/@username", "other"), true);
  });

  // Instagram
  it("detects Instagram feed", () => {
    assert.equal(isFeedPath("https://www.instagram.com/", "other"), true);
    assert.equal(isFeedPath("https://www.instagram.com/reels", "other"), true);
    assert.equal(isFeedPath("https://www.instagram.com/explore", "other"), true);
  });

  // Reddit
  it("detects Reddit feed", () => {
    assert.equal(isFeedPath("https://www.reddit.com/", "other"), true);
    assert.equal(isFeedPath("https://www.reddit.com/r/popular", "other"), true);
    assert.equal(isFeedPath("https://www.reddit.com/r/all", "other"), true);
  });

  it("does not match Reddit subreddit pages", () => {
    assert.equal(isFeedPath("https://www.reddit.com/r/programming/comments/abc/test", "other"), false);
  });

  // Facebook
  it("detects Facebook feed", () => {
    assert.equal(isFeedPath("https://www.facebook.com/", "other"), true);
    assert.equal(isFeedPath("https://www.facebook.com/watch", "other"), true);
  });

  // Edge cases
  it("returns false for invalid URL", () => {
    assert.equal(isFeedPath("not-a-url", "other"), false);
  });
});

/* ------------------------------------------------------------------ */
/*  normalizeCuratedGateRules                                          */
/* ------------------------------------------------------------------ */
describe("normalizeCuratedGateRules", () => {
  it("normalizes valid rules", () => {
    const rules = normalizeCuratedGateRules([
      { host: "youtube.com", note: "block yt" },
      { hostSuffix: "tiktok.com" },
    ]);
    assert.equal(rules.length, 2);
    assert.equal(rules[0].host, "youtube.com");
    assert.equal(rules[1].hostSuffix, "tiktok.com");
  });

  it("filters out rules with no matcher", () => {
    const rules = normalizeCuratedGateRules([
      { note: "no matcher at all" },
      { id: "only-id" },
    ]);
    assert.equal(rules.length, 0);
  });

  it("returns empty array for undefined/non-array", () => {
    assert.deepEqual(normalizeCuratedGateRules(undefined), []);
    assert.deepEqual(normalizeCuratedGateRules("not array" as any), []);
  });

  it("lowercases host and hostSuffix", () => {
    const rules = normalizeCuratedGateRules([
      { host: "YouTube.COM" },
    ]);
    assert.equal(rules[0].host, "youtube.com");
  });

  it("trims whitespace from fields", () => {
    const rules = normalizeCuratedGateRules([
      { host: "  example.com  ", pathPrefix: "  /feed  " },
    ]);
    assert.equal(rules[0].host, "example.com");
    assert.equal(rules[0].pathPrefix, "/feed");
  });
});

/* ------------------------------------------------------------------ */
/*  curatedGateMatches                                                 */
/* ------------------------------------------------------------------ */
describe("curatedGateMatches", () => {
  it("returns false when policy is disabled", () => {
    setCuratedGatePolicy({ enabled: false, rules: [{ host: "youtube.com" }] });
    assert.equal(curatedGateMatches("https://youtube.com/"), false);
  });

  it("matches by host", () => {
    setCuratedGatePolicy({
      enabled: true,
      rules: [{ host: "www.youtube.com" }],
    });
    assert.equal(curatedGateMatches("https://www.youtube.com/"), true);
    assert.equal(curatedGateMatches("https://www.example.com/"), false);
  });

  it("matches by hostSuffix", () => {
    setCuratedGatePolicy({
      enabled: true,
      rules: [{ hostSuffix: "youtube.com" }],
    });
    assert.equal(curatedGateMatches("https://www.youtube.com/"), true);
    assert.equal(curatedGateMatches("https://youtube.com/"), true);
    assert.equal(curatedGateMatches("https://notyoutube.com/"), false);
  });

  it("matches by pathPrefix", () => {
    setCuratedGatePolicy({
      enabled: true,
      rules: [{ host: "example.com", pathPrefix: "/feed" }],
    });
    assert.equal(curatedGateMatches("https://example.com/feed/latest"), true);
    assert.equal(curatedGateMatches("https://example.com/other"), false);
  });

  it("matches by urlRegex", () => {
    setCuratedGatePolicy({
      enabled: true,
      rules: [{ urlRegex: "youtube\\.com.*shorts" }],
    });
    assert.equal(curatedGateMatches("https://www.youtube.com/shorts/abc"), true);
    assert.equal(curatedGateMatches("https://www.youtube.com/watch?v=abc"), false);
  });

  it("never matches localhost/127.0.0.1", () => {
    setCuratedGatePolicy({
      enabled: true,
      rules: [{ host: "127.0.0.1" }, { host: "localhost" }],
    });
    assert.equal(curatedGateMatches("http://127.0.0.1:3456/curated"), false);
    assert.equal(curatedGateMatches("http://localhost:3456/curated"), false);
  });

  it("returns false for invalid URL", () => {
    setCuratedGatePolicy({
      enabled: true,
      rules: [{ host: "example.com" }],
    });
    assert.equal(curatedGateMatches("not a url"), false);
  });
});
