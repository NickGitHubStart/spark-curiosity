import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeCuratedGateRules,
  urlMatchesRules,
  isFeedPath,
  type CuratedGatePolicy,
} from "@spark/shared";

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

describe("urlMatchesRules (curated gate matching)", () => {
  it("matches exact host", () => {
    assert.equal(
      urlMatchesRules("https://youtube.com/", [{ host: "youtube.com" }]),
      true
    );
  });

  it("does not match different host", () => {
    assert.equal(
      urlMatchesRules("https://twitter.com/", [{ host: "youtube.com" }]),
      false
    );
  });

  it("hostSuffix matches subdomain", () => {
    assert.equal(
      urlMatchesRules("https://m.youtube.com/feed", [{ hostSuffix: "youtube.com" }]),
      true
    );
  });

  it("never matches localhost / 127.0.0.1 (safety)", () => {
    assert.equal(
      urlMatchesRules("http://127.0.0.1:8080/", [{ host: "127.0.0.1" }]),
      false
    );
    assert.equal(
      urlMatchesRules("http://localhost/", [{ host: "localhost" }]),
      false
    );
  });

  it("invalid URL returns false (no throw)", () => {
    assert.equal(urlMatchesRules("not a url", [{ host: "x.com" }]), false);
  });

  it("pathPrefix combined with host", () => {
    assert.equal(
      urlMatchesRules("https://youtube.com/shorts/abc", [{ host: "youtube.com", pathPrefix: "/shorts" }]),
      true
    );
    assert.equal(
      urlMatchesRules("https://youtube.com/watch?v=x", [{ host: "youtube.com", pathPrefix: "/shorts" }]),
      false
    );
  });

  it("invalid regex does not crash", () => {
    assert.doesNotThrow(() => {
      urlMatchesRules("https://x.com/", [{ pathRegex: "[invalid(" }]);
    });
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
