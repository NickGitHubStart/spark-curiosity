export const COMPANION_URL = process.env.SPARK_COMPANION_URL || "http://127.0.0.1:4343";
export const POLL_MS = Math.max(500, Number(process.env.SPARK_DESKTOP_POLL_MS || 2000));
export const HEARTBEAT_DEFAULT_SECONDS = Math.max(10, Number(process.env.SPARK_DESKTOP_HEARTBEAT_SECONDS || 300));
export const REDIRECT_TRACK_MS = 5 * 60 * 1000;
