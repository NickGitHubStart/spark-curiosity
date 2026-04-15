/**
 * D1 helpers for the platform_context table.
 * Stores a short real-time summary of what the user is doing on each device.
 */

export interface PlatformContext {
  platform: "pc" | "android";
  summary: string;
  url?: string;
  updatedAt: string;
}

export async function writePlatformContext(
  db: D1Database,
  token: string,
  platform: "pc" | "android",
  summary: string,
  url?: string,
): Promise<void> {
  await db.prepare(`
    INSERT INTO platform_context (token, platform, summary, url, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(token, platform) DO UPDATE SET
      summary = excluded.summary,
      url = excluded.url,
      updated_at = excluded.updated_at
  `).bind(token, platform, summary.slice(0, 200), url || null).run();
}

export async function readPlatformContext(
  db: D1Database,
  token: string,
  platform: "pc" | "android",
): Promise<PlatformContext | null> {
  const row = await db.prepare(`
    SELECT platform, summary, url, updated_at FROM platform_context
    WHERE token = ? AND platform = ?
  `).bind(token, platform).first<{ platform: string; summary: string; url: string | null; updated_at: string }>();
  if (!row) return null;
  return {
    platform: row.platform as "pc" | "android",
    summary: row.summary,
    url: row.url ?? undefined,
    updatedAt: row.updated_at,
  };
}
