import test from "node:test";
import assert from "node:assert/strict";
import { performRedirect, type RedirectDeps } from "../src/agent/redirect-flow.js";

/* ── helpers ── */

const withHwnd = { appName: "chrome", title: "YouTube", url: "https://youtube.com", hwnd: "123" };
const noHwnd = { appName: "chrome", title: "YouTube", url: "https://youtube.com" };

function mockDeps(overrides: Partial<RedirectDeps> = {}): RedirectDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getActiveWindow: async () => withHwnd,
    navigateCurrentTab: async () => { calls.push("navigate"); return true; },
    closeCurrentTab: async () => { calls.push("close"); return true; },
    openExternalUrl: async () => { calls.push("open"); return true; },
    sleep: async () => {},
    ...overrides
  };
}

const curatedUrl = "http://127.0.0.1:4343/curated";

/* ── Strategy 1: navigate-in-place ── */

test("navigate-in-place succeeds on first attempt → no close/open", async () => {
  const deps = mockDeps({
    getActiveWindow: async () => ({ ...withHwnd, url: curatedUrl })
  });
  const result = await performRedirect(withHwnd, { url: curatedUrl }, deps);
  assert.deepEqual(deps.calls, ["navigate"]);
  assert.equal(result.navigated, true);
  assert.equal(result.verified, true);
  assert.equal(result.closed, false);
  assert.equal(result.opened, false);
});

test("navigate-in-place fails verification → falls back to close+open", async () => {
  const deps = mockDeps({
    getActiveWindow: async () => withHwnd // URL stays youtube.com → verification fails
  });
  const result = await performRedirect(withHwnd, { url: curatedUrl, closeTab: true }, deps);
  // 3 navigate attempts, then close+open
  assert.deepEqual(deps.calls, ["navigate", "navigate", "navigate", "close", "open"]);
  assert.equal(result.closed, true);
  assert.equal(result.opened, true);
});

test("navigate returns false → stops retrying, falls back to close+open", async () => {
  const deps = mockDeps({
    navigateCurrentTab: async () => { deps.calls.push("navigate"); return false; }
  });
  const result = await performRedirect(withHwnd, { url: curatedUrl }, deps);
  assert.deepEqual(deps.calls, ["navigate", "close", "open"]);
  assert.equal(result.navigated, false);
  assert.equal(result.opened, true);
});

/* ── Strategy 2: close + open ── */

test("closeTab:true with hwnd → close then open", async () => {
  const deps = mockDeps({
    navigateCurrentTab: async () => { deps.calls.push("navigate"); return false; }
  });
  const result = await performRedirect(withHwnd, { url: curatedUrl, closeTab: true }, deps);
  const closeIdx = deps.calls.indexOf("close");
  const openIdx = deps.calls.indexOf("open");
  assert.ok(closeIdx >= 0, "close should be called");
  assert.ok(openIdx > closeIdx, "open should come after close");
  assert.equal(result.closed, true);
  assert.equal(result.opened, true);
});

test("closeTab:false → open only, no close", async () => {
  const deps = mockDeps({
    navigateCurrentTab: async () => { deps.calls.push("navigate"); return false; }
  });
  const result = await performRedirect(withHwnd, { url: curatedUrl, closeTab: false }, deps);
  assert.ok(!deps.calls.includes("close"), "should not close");
  assert.ok(deps.calls.includes("open"), "should open");
  assert.equal(result.closed, false);
  assert.equal(result.opened, true);
});

/* ── BUG FIX: no hwnd → tab should still close ── */

test("no hwnd → skips navigate, still closes tab + opens", async () => {
  const deps = mockDeps();
  const result = await performRedirect(noHwnd, { url: curatedUrl, closeTab: true }, deps);
  // No navigate (requires hwnd), but close + open should happen
  assert.ok(!deps.calls.includes("navigate"), "navigate needs hwnd");
  assert.deepEqual(deps.calls, ["close", "open"]);
  assert.equal(result.closed, true);
  assert.equal(result.opened, true);
});

test("no hwnd + closeTab:false → open only", async () => {
  const deps = mockDeps();
  const result = await performRedirect(noHwnd, { url: curatedUrl, closeTab: false }, deps);
  assert.deepEqual(deps.calls, ["open"]);
  assert.equal(result.closed, false);
  assert.equal(result.opened, true);
});

/* ── Edge cases ── */

test("close fails → still opens", async () => {
  const deps = mockDeps({
    navigateCurrentTab: async () => { deps.calls.push("navigate"); return false; },
    closeCurrentTab: async () => { deps.calls.push("close"); return false; }
  });
  const result = await performRedirect(withHwnd, { url: curatedUrl, closeTab: true }, deps);
  assert.equal(result.closed, false);
  assert.equal(result.opened, true);
});

test("closeTab defaults to true when undefined", async () => {
  const deps = mockDeps({
    navigateCurrentTab: async () => { deps.calls.push("navigate"); return false; }
  });
  // closeTab not set → should default to true (closeTab !== false)
  const result = await performRedirect(withHwnd, { url: curatedUrl }, deps);
  assert.ok(deps.calls.includes("close"), "should close when closeTab is undefined");
  assert.equal(result.closed, true);
});
