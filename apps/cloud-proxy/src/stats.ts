/**
 * Stats aggregation from D1 block_events table.
 */

import type { Env } from "./types.js";

export interface StatsResult {
  range: string;
  totalBlocks: number;
  totalSessionSeconds: number;
  byPlatform: Record<string, { blocks: number; seconds: number }>;
  byAction: Record<string, number>;
}

function rangeFilter(range: string): { where: string; params: string[] } {
  const now = new Date();
  if (range === "today") {
    const today = now.toISOString().slice(0, 10);
    return { where: "AND timestamp >= ?", params: [today + "T00:00:00Z"] };
  }
  if (range === "week") {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { where: "AND timestamp >= ?", params: [weekAgo.toISOString()] };
  }
  // "total" — no filter
  return { where: "", params: [] };
}

export async function getStats(db: D1Database, token: string, range: string): Promise<StatsResult> {
  const { where, params } = rangeFilter(range);

  const rows = await db.prepare(
    `SELECT platform, action, session_seconds FROM block_events WHERE token = ? ${where}`
  ).bind(token, ...params).all<{
    platform: string | null; action: string | null; session_seconds: number | null;
  }>();

  const result: StatsResult = {
    range,
    totalBlocks: 0,
    totalSessionSeconds: 0,
    byPlatform: {},
    byAction: {}
  };

  for (const row of rows.results || []) {
    result.totalBlocks++;
    const sec = row.session_seconds || 0;
    result.totalSessionSeconds += sec;

    const platform = row.platform || "unknown";
    if (!result.byPlatform[platform]) result.byPlatform[platform] = { blocks: 0, seconds: 0 };
    result.byPlatform[platform].blocks++;
    result.byPlatform[platform].seconds += sec;

    const action = row.action || "unknown";
    result.byAction[action] = (result.byAction[action] || 0) + 1;
  }

  return result;
}

export async function recordBlockEvent(
  db: D1Database, token: string,
  opts: { platform?: string; url?: string; action?: string; sessionSeconds?: number }
): Promise<void> {
  await db.prepare(`
    INSERT INTO block_events (token, timestamp, platform, url, action, session_seconds)
    VALUES (?, datetime('now'), ?, ?, ?, ?)
  `).bind(
    token,
    opts.platform || null,
    opts.url || null,
    opts.action || null,
    opts.sessionSeconds || 0
  ).run();
}
