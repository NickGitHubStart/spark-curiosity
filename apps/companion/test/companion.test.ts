import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { EventDecisionResponse, FeedbackResponse, MemorySnapshot } from "@spark/shared";

let server: Server;
let baseUrl = "";
let dataDir = "";

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "spark-companion-test-"));
  process.env.SPARK_SKIP_AUTOSTART = "1";
  process.env.SPARK_DATA_DIR = dataDir;
  process.env.SPARK_PROMPTS_DIR = join(dataDir, "prompts");
  process.env.SPARK_AI_PROVIDER = "none";

  const mod = await import("../src/index.ts");
  server = mod.startCompanionServer(0, "127.0.0.1");
  if (!server.listening) {
    await new Promise<void>(resolve => server.once("listening", () => resolve()));
  }
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(dataDir, { recursive: true, force: true });
});

test("health endpoint responds", async () => {
  const resp = await fetch(`${baseUrl}/health`);
  assert.equal(resp.status, 200);
  const body = await resp.json() as { ok: boolean };
  assert.equal(body.ok, true);
});

test("memory endpoint exists and returns snapshot", async () => {
  const resp = await fetch(`${baseUrl}/memory`);
  assert.equal(resp.status, 200);
  const body = await resp.json() as MemorySnapshot;
  assert.ok(Array.isArray(body.shortTermEvents));
  assert.ok(Array.isArray(body.longTermGoals));
  assert.ok(Array.isArray(body.midTermPatterns));
});

test("memory insights endpoint returns markdown text", async () => {
  const resp = await fetch(`${baseUrl}/memory/insights`);
  assert.equal(resp.status, 200);
  const body = await resp.json() as { text: string };
  assert.equal(typeof body.text, "string");
  assert.ok(body.text.includes("Spark Memory Insights"));
});

test("debug endpoint returns last decision object", async () => {
  await fetch(`${baseUrl}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      platform: "x",
      contentMode: "feed",
      url: "https://x.com/home",
      signals: { sessionSeconds: 20, scrollEvents: 5, tabSwitches: 0 },
      content: { pageTitle: "Home / X" }
    })
  });

  const resp = await fetch(`${baseUrl}/debug/last-decision`);
  assert.equal(resp.status, 200);
  const body = await resp.json() as { platform?: string; reasonCodes?: string[] };
  assert.ok(body.platform);
  assert.ok(Array.isArray(body.reasonCodes));
});

test("debug ui endpoint serves html", async () => {
  const resp = await fetch(`${baseUrl}/debug/ui`);
  assert.equal(resp.status, 200);
  const text = await resp.text();
  assert.ok(text.includes("Spark Companion Debug UI"));
});

test("debug traces endpoint returns traces array", async () => {
  const resp = await fetch(`${baseUrl}/debug/traces?limit=5`);
  assert.equal(resp.status, 200);
  const body = await resp.json() as { traces: unknown[] };
  assert.ok(Array.isArray(body.traces));
});

test("debug stats endpoint returns ingest counters", async () => {
  const resp = await fetch(`${baseUrl}/debug/stats`);
  assert.equal(resp.status, 200);
  const body = await resp.json() as { eventsReceived: number; feedbackReceived: number };
  assert.equal(typeof body.eventsReceived, "number");
  assert.equal(typeof body.feedbackReceived, "number");
});

test("client log endpoint accepts logs and exposes them", async () => {
  const post = await fetch(`${baseUrl}/debug/client-log`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      at: new Date().toISOString(),
      level: "info",
      message: "test_client_log",
      context: { from: "test" }
    })
  });
  assert.equal(post.status, 202);

  const get = await fetch(`${baseUrl}/debug/client-logs?limit=5`);
  assert.equal(get.status, 200);
  const body = await get.json() as { logs: Array<{ message: string }> };
  assert.ok(Array.isArray(body.logs));
  assert.ok(body.logs.some(l => l.message === "test_client_log"));
});

test("high-risk event prompts and down feedback triggers redirect", async () => {
  const eventResp = await fetch(`${baseUrl}/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      platform: "youtube",
      contentMode: "shorts",
      url: "https://www.youtube.com/shorts/test",
      signals: { sessionSeconds: 420, scrollEvents: 120, tabSwitches: 0 },
      content: {
        pageTitle: "AI shorts feed",
        youtube: { videoTitle: "AI motivation mix", channelName: "x", isShort: true }
      }
    })
  });
  assert.equal(eventResp.status, 200);
  const eventBody = await eventResp.json() as EventDecisionResponse;
  assert.equal(eventBody.shouldPrompt, true);
  assert.ok(eventBody.decisionSource);
  assert.ok(Array.isArray(eventBody.reasonCodes));
  assert.ok(eventBody.prompt?.id);

  const feedbackResp = await fetch(`${baseUrl}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      promptId: eventBody.prompt?.id,
      feedback: "down",
      timestamp: new Date().toISOString()
    })
  });
  assert.equal(feedbackResp.status, 202);
  const feedbackBody = await feedbackResp.json() as FeedbackResponse;
  assert.equal(feedbackBody.accepted, true);
  assert.ok(Array.isArray(feedbackBody.memoryChanges));
  assert.equal(feedbackBody.action?.type, "redirect");

  const feedbackTraceResp = await fetch(`${baseUrl}/debug/feedback-traces?limit=5`);
  assert.equal(feedbackTraceResp.status, 200);
  const feedbackTraceBody = await feedbackTraceResp.json() as { traces: unknown[] };
  assert.ok(Array.isArray(feedbackTraceBody.traces));
  assert.ok(feedbackTraceBody.traces.length >= 1);
});
