import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD_ID, DATA_DIR, DISCORD_BUG_WEBHOOK_URL } from "../config.js";
import { clientLogs, feedbackLog, chatLog, lastDecisions, stats, ringPush, type ClientLog } from "../state.js";
import { getBlockStats, updateSessionDurations } from "../block-stats.js";
import { renderDebugUi } from "../ui/debug-ui.js";
import { json, html, parseBody, paginatedJson } from "./helpers.js";

export async function handleDebugRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/debug/stats") {
    json(res, 200, stats);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/stats") {
    const range = (url.searchParams.get("range") || "total") as "today" | "week" | "total";
    json(res, 200, getBlockStats(range));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/stats/session-durations") {
    try {
      const body = await parseBody<Record<string, number>>(req);
      const updated = updateSessionDurations(body);
      json(res, 200, { ok: true, sessionDurations: updated });
    } catch (error) {
      json(res, 400, { ok: false, error: String(error) });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/debug/client-logs") { paginatedJson(res, clientLogs, "logs", url); return true; }
  if (req.method === "GET" && url.pathname === "/debug/traces") { paginatedJson(res, lastDecisions, "traces", url); return true; }
  if (req.method === "GET" && url.pathname === "/debug/feedback-traces") { paginatedJson(res, feedbackLog, "traces", url); return true; }
  if (req.method === "GET" && url.pathname === "/debug/chat-log") { paginatedJson(res, chatLog, "chats", url); return true; }
  if (req.method === "GET" && url.pathname === "/debug/ui") { html(res, renderDebugUi()); return true; }

  if (req.method === "POST" && url.pathname === "/debug/client-log") {
    try {
      const p = await parseBody<ClientLog>(req);
      ringPush(clientLogs, { at: p.at || new Date().toISOString(), level: p.level || "info", message: p.message || "unknown", context: p.context }, 500);
      json(res, 202, { accepted: true });
    } catch { json(res, 400, { accepted: false }); }
    return true;
  }

  // Bug reports
  if (req.method === "POST" && url.pathname === "/bug-report") {
    try {
      const body = await parseBody<{ description?: string; context?: string }>(req);
      const desc = (body.description || "").trim();
      if (!desc) { json(res, 400, { ok: false, error: "description_required" }); return true; }
      const entry = { at: new Date().toISOString(), description: desc, context: (body.context || "").trim() || undefined };

      const reportFile = join(DATA_DIR, "bug-reports.json");
      let reports: unknown[] = [];
      try { if (existsSync(reportFile)) reports = JSON.parse(readFileSync(reportFile, "utf-8")); } catch { reports = []; }
      reports.push(entry);
      writeFileSync(reportFile, JSON.stringify(reports, null, 2), "utf-8");

      if (DISCORD_BUG_WEBHOOK_URL) {
        try {
          const embed = {
            title: "\uD83D\uDC1B Bug Report",
            description: desc.slice(0, 2000),
            color: 0xfbbf24,
            timestamp: entry.at,
            fields: entry.context ? [{ name: "Kontext", value: entry.context.slice(0, 500) }] : [],
            footer: { text: `Spark ${BUILD_ID} \u00b7 PID ${process.pid}` }
          };
          await fetch(DISCORD_BUG_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed] })
          });
        } catch (e) {
          console.error("[spark:bug-report] discord webhook failed:", e);
        }
      }
      json(res, 201, { ok: true });
    } catch (error) {
      json(res, 400, { ok: false, error: String(error) });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/debug/bug-reports") {
    const reportFile = join(DATA_DIR, "bug-reports.json");
    let reports: unknown[] = [];
    try { if (existsSync(reportFile)) reports = JSON.parse(readFileSync(reportFile, "utf-8")); } catch { reports = []; }
    json(res, 200, { reports });
    return true;
  }

  return false;
}
