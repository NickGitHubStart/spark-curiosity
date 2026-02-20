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

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "spark-companion-test-"));
  process.env.SPARK_SKIP_AUTOSTART = "1";
  process.env.SPARK_DATA_DIR = dataDir;

  const mod = await import("../src/index.ts");
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
  assert.ok(t.includes("Spark Debug UI"));
});
