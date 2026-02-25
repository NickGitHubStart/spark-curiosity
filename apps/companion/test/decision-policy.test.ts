import assert from "node:assert/strict";
import { test } from "node:test";
import { enforceBadVerdictAction, resolveCachedDecision } from "../src/decision-policy.ts";

test("resolveCachedDecision enforces redirect for cached bad verdict", () => {
  const now = Date.now();
  const result = resolveCachedDecision({
    cached: {
      verdict: "bad",
      nextCheckAt: now + 60_000,
      thought: "stay focused",
      redirectUrl: "https://todoist.com/app"
    },
    nowMs: now,
    returnedAfterRedirect: false,
    runtime: { provider: "ollama", model: "phi3:mini" }
  });

  assert.ok(result);
  assert.equal(result.action?.type, "redirect");
  assert.equal(result.redirectImmediately, true);
  assert.equal(result.redirectUrl, "https://todoist.com/app");
});

test("enforceBadVerdictAction upgrades non-redirect bad action", () => {
  const action = enforceBadVerdictAction({
    verdict: "bad",
    baseAction: { type: "popup", ui: { variant: "binary", message: "x", options: ["Weiter", "Zurück"] } },
    aiRedirectUrl: "https://todoist.com/app",
    cachedRedirectUrl: undefined
  });

  assert.equal(action.type, "redirect");
  assert.equal(action.redirectUrl, "https://todoist.com/app");
});

test("enforceBadVerdictAction downgrades popup_then_redirect without url to popup", () => {
  const action = enforceBadVerdictAction({
    verdict: "neutral",
    baseAction: {
      type: "popup_then_redirect",
      ui: { variant: "binary", message: "x", options: ["A", "B"] }
    },
    aiRedirectUrl: undefined,
    cachedRedirectUrl: undefined
  });

  assert.equal(action.type, "popup");
});
