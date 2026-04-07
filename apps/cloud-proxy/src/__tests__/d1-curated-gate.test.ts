import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeCuratedGateRules,
  curatedGateMatches,
  curatedGateMatchesByTitle,
  isFeedPath,
} from "../d1-curated-gate.js";
import type { CuratedGatePolicy } from "../types.js";

describe("normalizeCuratedGateRules", () => {
  it("filters out rules with no matcher", () => {
    const rules = normalizeCuratedGateRules([
      { note: "no matcher" },
      { host: "x.com" }
    ]);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].host, "x.com");
  });

  it("lowercases hosts", () => {
    const rules = normalizeCuratedGateRules([{ host: "  YouTube.COM " }]);
    assert.equal(rules[0].host, "youtube.com");
  });

  it("returns empty array on undefined input", () => {
    assert.deepEqual(normalizeCuratedGateRules(undefined), []);
  });

  it("preserves regex strings as-is (only trims)", () => {
    const rules = normalizeCuratedGateRules([{ urlRegex: "  ^https://x.com/i/.*$  " }]);
    assert.equal(rules[0].urlRegex, "^https://x.com/i/.*$");
  });
});

describe("curatedGateMatches", () => {
  const policy = (rules: CuratedGatePolicy["rules"]): CuratedGatePolicy => ({
    enabled: true, rules,
  });

  it("matches exact host", () => {
    assert.equal(
      curatedGateMatches(policy([{ host: "youtube.com" }]), "https://youtube.com/"),
      true
    );
  });

  it("does not match different host", () => {
    assert.equal(
      curatedGateMatches(policy([{ host: "youtube.com" }]), "https://twitter.com/"),
      false
    );
  });

  it("hostSuffix matches subdomain", () => {
    assert.equal(
      curatedGateMatches(policy([{ hostSuffix: "youtube.com" }]), "https://m.youtube.com/feed"),
      true
    );
  });

  it("never matches localhost / 127.0.0.1 (safety)", () => {
    assert.equal(
      curatedGateMatches(policy([{ host: "127.0.0.1" }]), "http://127.0.0.1:8080/"),
      false
    );
    assert.equal(
      curatedGateMatches(policy([{ host: "localhost" }]), "http://localhost/"),
      false
    );
  });

  it("disabled policy never matches", () => {
    const p: CuratedGatePolicy = { enabled: false, rules: [{ host: "youtube.com" }] };
    assert.equal(curatedGateMatches(p, "https://youtube.com/"), false);
  });

  it("invalid URL returns false (no throw)", () => {
    assert.equal(curatedGateMatches(policy([{ host: "x.com" }]), "not a url"), false);
  });

  it("pathPrefix combined with host", () => {
    assert.equal(
      curatedGateMatches(
        policy([{ host: "youtube.com", pathPrefix: "/shorts" }]),
        "https://youtube.com/shorts/abc"
      ),
      true
    );
    assert.equal(
      curatedGateMatches(
        policy([{ host: "youtube.com", pathPrefix: "/shorts" }]),
        "https://youtube.com/watch?v=x"
      ),
      false
    );
  });

  it("invalid regex does not crash", () => {
    assert.doesNotThrow(() => {
      curatedGateMatches(policy([{ pathRegex: "[invalid(" }]), "https://x.com/");
    });
  });
});

describe("curatedGateMatchesByTitle", () => {
  it("matches app:// URL by host substring in title", () => {
    const policy: CuratedGatePolicy = {
      enabled: true,
      rules: [{ host: "youtube.com" }],
    };
    assert.equal(
      curatedGateMatchesByTitle(policy, "YouTube — Trending now", "app://com.google.android.youtube"),
      "youtube.com"
    );
  });

  it("returns null for non-app URLs", () => {
    const policy: CuratedGatePolicy = { enabled: true, rules: [{ host: "youtube.com" }] };
    assert.equal(curatedGateMatchesByTitle(policy, "YouTube", "https://example.com"), null);
  });
});

describe("isFeedPath", () => {
  it("youtube root + shorts + feed", () => {
    assert.equal(isFeedPath("https://youtube.com/", "youtube"), true);
    assert.equal(isFeedPath("https://youtube.com/shorts/abc", "youtube"), true);
    assert.equal(isFeedPath("https://youtube.com/feed/trending", "youtube"), true);
    assert.equal(isFeedPath("https://youtube.com/watch?v=abc", "youtube"), false);
  });

  it("x/twitter home + explore + i/trends", () => {
    assert.equal(isFeedPath("https://x.com/home", "x"), true);
    assert.equal(isFeedPath("https://x.com/explore", "x"), true);
    assert.equal(isFeedPath("https://x.com/elonmusk", "x"), false);
  });

  it("tiktok foryou + user feeds", () => {
    assert.equal(isFeedPath("https://www.tiktok.com/foryou", "tiktok"), true);
    assert.equal(isFeedPath("https://www.tiktok.com/@someone", "tiktok"), true);
    assert.equal(isFeedPath("https://www.tiktok.com/@someone/video/123", "tiktok"), false);
  });

  it("instagram reels + explore", () => {
    assert.equal(isFeedPath("https://instagram.com/reels", "instagram"), true);
    assert.equal(isFeedPath("https://instagram.com/explore", "instagram"), true);
    assert.equal(isFeedPath("https://instagram.com/p/abc", "instagram"), false);
  });

  it("invalid URL returns false", () => {
    assert.equal(isFeedPath("not a url", "youtube"), false);
  });
});
