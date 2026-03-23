import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "./config.js";

/** Per-platform default session durations (minutes), based on research data. */
const DEFAULT_SESSION_DURATIONS: Record<string, number> = {
  "youtube.com": 15,
  "x.com": 8,
  "twitter.com": 8,
  "tiktok.com": 12,
  "instagram.com": 10,
  "reddit.com": 12,
  "facebook.com": 10,
};

export interface BlockEntry {
  /** ISO timestamp */
  at: string;
  /** Normalized platform key (e.g. "youtube.com") */
  platform: string;
  /** Original URL that was blocked */
  url: string;
}

export interface BlockStatsFile {
  /** All individual block events */
  blocks: BlockEntry[];
  /** User-customizable session durations per platform (minutes) */
  sessionDurations: Record<string, number>;
}

export interface PlatformStats {
  platform: string;
  count: number;
  sessionDurationMin: number;
  minutesSaved: number;
}

export interface AggregatedStats {
  totalBlocks: number;
  totalMinutes: number;
  platforms: PlatformStats[];
  sessionDurations: Record<string, number>;
}

const STATS_PATH = join(DATA_DIR, "block-stats.json");

let cache: BlockStatsFile | null = null;

function load(): BlockStatsFile {
  if (cache) return cache;
  if (!existsSync(STATS_PATH)) {
    cache = { blocks: [], sessionDurations: { ...DEFAULT_SESSION_DURATIONS } };
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(STATS_PATH, "utf8")) as Partial<BlockStatsFile>;
    cache = {
      blocks: Array.isArray(raw.blocks) ? raw.blocks : [],
      sessionDurations: { ...DEFAULT_SESSION_DURATIONS, ...(raw.sessionDurations || {}) },
    };
    return cache;
  } catch {
    cache = { blocks: [], sessionDurations: { ...DEFAULT_SESSION_DURATIONS } };
    return cache;
  }
}

function save(): void {
  if (!cache) return;
  const dir = dirname(STATS_PATH);
  mkdirSync(dir, { recursive: true });
  writeFileSync(STATS_PATH, JSON.stringify(cache, null, 2), "utf8");
}

/** Normalize hostname to a canonical platform key. */
function normalizePlatform(hostname: string): string {
  const h = hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  // twitter.com → x.com for unified tracking
  if (h === "twitter.com") return "x.com";
  return h;
}

/** Record a block event. Called from decision.ts when a curated gate block happens. */
export function recordBlock(url: string): void {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return;
  }
  const platform = normalizePlatform(hostname);
  if (!platform) return;

  const data = load();
  data.blocks.push({ at: new Date().toISOString(), platform, url });
  // Ensure platform has a session duration
  if (!(platform in data.sessionDurations) && !(platform in DEFAULT_SESSION_DURATIONS)) {
    data.sessionDurations[platform] = 10; // fallback
  }
  save();
}

/** Update session durations (user-configurable). */
export function updateSessionDurations(durations: Record<string, number>): Record<string, number> {
  const data = load();
  for (const [key, val] of Object.entries(durations)) {
    if (typeof val === "number" && val > 0 && val <= 120) {
      data.sessionDurations[normalizePlatform(key)] = Math.round(val);
    }
  }
  save();
  return data.sessionDurations;
}

/** Get aggregated stats for a time range. */
export function getBlockStats(range: "today" | "week" | "total" = "total"): AggregatedStats {
  const data = load();
  const now = Date.now();
  let cutoff = 0;
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    cutoff = d.getTime();
  } else if (range === "week") {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    d.setHours(0, 0, 0, 0);
    cutoff = d.getTime();
  }

  const counts: Record<string, number> = {};
  for (const block of data.blocks) {
    const ts = Date.parse(block.at);
    if (ts < cutoff) continue;
    counts[block.platform] = (counts[block.platform] || 0) + 1;
  }

  const platforms: PlatformStats[] = [];
  let totalBlocks = 0;
  let totalMinutes = 0;

  for (const [platform, count] of Object.entries(counts)) {
    const dur = data.sessionDurations[platform] ?? DEFAULT_SESSION_DURATIONS[platform] ?? 10;
    const mins = count * dur;
    platforms.push({ platform, count, sessionDurationMin: dur, minutesSaved: mins });
    totalBlocks += count;
    totalMinutes += mins;
  }

  // Sort by minutes saved descending
  platforms.sort((a, b) => b.minutesSaved - a.minutesSaved);

  return { totalBlocks, totalMinutes, platforms, sessionDurations: { ...data.sessionDurations } };
}
