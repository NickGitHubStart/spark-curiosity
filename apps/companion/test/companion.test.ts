import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

let server: Server;
let baseUrl = "";
let dataDir = "";
let setTestForcedAiJson: (json: string | null) => void = () => {};

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "spark-companion-test-"));
  process.env.SPARK_SKIP_AUTOSTART = "1";
  process.env.SPARK_DATA_DIR = dataDir;

  const mod = await import("../src/index.ts");
  setTestForcedAiJson = mod.setTestForcedAiJson as (json: string | null) => void;
  server = mod.startCompanionServer(0, "127.0.0.1");
  if (!server.listening) {
    await new Promise<void>(resolve => server.once("listening", () => resolve()));
  }
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

test("health", async () => {
  const r = await fetch(`${baseUrl}/health`);
  assert.equal(r.status, 200);
});

test("event increases stats", async () => {
  const r1 = await fetch(`${baseUrl}/debug/stats`);
  const s1 = await r1.json() as { eventsReceived: number };

  await fetch(`${baseUrl}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      platform: "youtube",
      contentMode: "shorts",
      url: "https://youtube.com/shorts/test",
      sessionSeconds: 240,
      scrollCount: 100,
      title: "test"
    })
  });

  const r2 = await fetch(`${baseUrl}/debug/stats`);
  const s2 = await r2.json() as { eventsReceived: number };
  assert.equal(s2.eventsReceived, s1.eventsReceived + 1);
});

test("client logs endpoint", async () => {
  await fetch(`${baseUrl}/debug/client-log`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ at: new Date().toISOString(), level: "info", message: "hello" })
  });

  const r = await fetch(`${baseUrl}/debug/client-logs?limit=10`);
  const body = await r.json() as { logs: Array<{ message: string }> };
  assert.ok(body.logs.some(l => l.message === "hello"));
});

test("debug ui", async () => {
  const r = await fetch(`${baseUrl}/debug/ui`);
  const t = await r.text();
  assert.equal(r.status, 200);
  assert.ok(t.includes("Spark Curiosity — Debug Dashboard"));
});

test("bad verdict is enforced to redirect", async () => {
  setTestForcedAiJson(JSON.stringify({
    action: { type: "none" },
    siteVerdict: "bad",
    nextCheckSeconds: 120,
    reason: "bad site"
  }));

  const r = await fetch(`${baseUrl}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      platform: "other",
      contentMode: "other",
      url: "https://strict-bad-test.local/case-a",
      sessionSeconds: 30,
      scrollCount: 5,
      title: "test"
    })
  });
  const body = await r.json() as { action?: { type?: string; redirectUrl?: string }; redirectImmediately?: boolean };
  setTestForcedAiJson(null);

  assert.equal(r.status, 200);
  assert.equal(body.action?.type, "redirect");
  assert.equal(body.redirectImmediately, true);
  assert.ok(typeof body.action?.redirectUrl === "string" && body.action.redirectUrl.startsWith("http"));
});

test("cached bad host remains enforced on next request", async () => {
  setTestForcedAiJson(JSON.stringify({
    action: { type: "redirect", redirectUrl: "https://todoist.com/app" },
    siteVerdict: "bad",
    nextCheckSeconds: 180,
    reason: "bad host"
  }));

  await fetch(`${baseUrl}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      platform: "other",
      contentMode: "other",
      url: "https://cache-bad-test.local/first",
      sessionSeconds: 15,
      scrollCount: 2,
      title: "first"
    })
  });

  setTestForcedAiJson(JSON.stringify({
    action: { type: "none" },
    siteVerdict: "good",
    nextCheckSeconds: 600,
    reason: "would allow"
  }));

  const r = await fetch(`${baseUrl}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      platform: "other",
      contentMode: "other",
      url: "https://cache-bad-test.local/second",
      sessionSeconds: 20,
      scrollCount: 3,
      title: "second"
    })
  });
  const body = await r.json() as { action?: { type?: string; redirectUrl?: string }; reason?: string; agentSkipped?: boolean };
  setTestForcedAiJson(null);

  assert.equal(r.status, 200);
  assert.equal(body.agentSkipped, true);
  assert.equal(body.action?.type, "redirect");
  assert.ok((body.reason || "").includes("cached_bad_enforced"));
});

test("popup_then_redirect interaction redirects on focus option", async () => {
  setTestForcedAiJson(JSON.stringify({
    action: {
      type: "popup_then_redirect",
      redirectUrl: "https://todoist.com/app",
      ui: { variant: "binary", message: "stay focused?", options: ["Weiter", "Zurück zum Fokus"] }
    },
    siteVerdict: "neutral",
    nextCheckSeconds: 60,
    reason: "ask user"
  }));

  const eventResp = await fetch(`${baseUrl}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      platform: "x",
      contentMode: "feed",
      url: "https://x.com/home",
      sessionSeconds: 45,
      scrollCount: 8,
      title: "x feed"
    })
  });
  const decision = await eventResp.json() as { promptId?: string };
  assert.ok(decision.promptId);

  const feedbackResp = await fetch(`${baseUrl}/interaction-feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      promptId: decision.promptId,
      selectedOption: "Zurück zum Fokus",
      timestamp: new Date().toISOString()
    })
  });
  const feedback = await feedbackResp.json() as { redirectUrl?: string };
  setTestForcedAiJson(null);

  assert.equal(feedbackResp.status, 202);
  assert.equal(feedback.redirectUrl, "https://todoist.com/app");
});
