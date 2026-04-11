import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGrokModelName, GROK_MODEL_NON_REASONING } from "../src/config.js";

test("normalizeGrokModelName maps grok-4.1-fast typo to grok-4-1-fast", () => {
  assert.equal(normalizeGrokModelName("grok-4.1-fast"), "grok-4-1-fast");
  assert.equal(normalizeGrokModelName("GROK-4.1-FAST"), "grok-4-1-fast");
  assert.equal(normalizeGrokModelName("grok-4-1-fast"), "grok-4-1-fast");
});

test("normalizeGrokModelName maps legacy reasoning sku to non-reasoning", () => {
  assert.equal(normalizeGrokModelName("grok-4-1-fast-reasoning"), GROK_MODEL_NON_REASONING);
  assert.equal(normalizeGrokModelName("grok-4.1-fast-reasoning"), GROK_MODEL_NON_REASONING);
});

test("normalizeGrokModelName empty falls back to default", () => {
  assert.equal(normalizeGrokModelName(""), GROK_MODEL_NON_REASONING);
});
