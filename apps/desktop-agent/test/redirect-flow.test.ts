import test from "node:test";
import assert from "node:assert/strict";
import { performRedirect } from "../src/agent/redirect-flow.js";

const baseCtx = { appName: "chrome", title: "YouTube", url: "https://youtube.com", hwnd: "123" };

test("closeTab: closes first then opens", async () => {
  const calls: string[] = [];
  const result = await performRedirect(baseCtx, { url: "http://127.0.0.1:4343/curated", closeTab: true }, {
    getActiveWindow: async () => baseCtx,
    navigateCurrentTab: async () => { calls.push("navigate"); return true; },
    closeCurrentTab: async () => { calls.push("close"); return true; },
    openExternalUrl: async () => { calls.push("open"); return true; },
    closeTabsByUrl: async () => { calls.push("cdp-close"); return true; },
    openCdpUrl: async () => { calls.push("cdp-open"); return true; },
    sleep: async () => { /* no-op */ }
  });
  assert.deepEqual(calls, ["cdp-close", "cdp-open"]);
  assert.equal(result.closed, true);
  assert.equal(result.opened, true);
  assert.equal(result.navigated, false);
});

test("navigate success avoids open", async () => {
  const calls: string[] = [];
  const result = await performRedirect(baseCtx, { url: "http://127.0.0.1:4343/curated" }, {
    getActiveWindow: async () => ({ ...baseCtx, url: "http://127.0.0.1:4343/curated" }),
    navigateCurrentTab: async () => { calls.push("navigate"); return true; },
    closeCurrentTab: async () => { calls.push("close"); return true; },
    openExternalUrl: async () => { calls.push("open"); return true; },
    sleep: async () => { /* no-op */ }
  });
  assert.deepEqual(calls, ["navigate"]);
  assert.equal(result.navigated, true);
  assert.equal(result.verified, true);
  assert.equal(result.opened, false);
});

test("navigate failure falls back to open", async () => {
  const calls: string[] = [];
  const result = await performRedirect(baseCtx, { url: "http://127.0.0.1:4343/curated" }, {
    getActiveWindow: async () => baseCtx,
    navigateCurrentTab: async () => { calls.push("navigate"); return false; },
    closeCurrentTab: async () => { calls.push("close"); return true; },
    openExternalUrl: async () => { calls.push("open"); return true; },
    sleep: async () => { /* no-op */ }
  });
  assert.deepEqual(calls, ["navigate", "open"]);
  assert.equal(result.opened, true);
});
