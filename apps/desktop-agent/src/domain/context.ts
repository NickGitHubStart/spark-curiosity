import type { ContentMode, EventIngest, Platform } from "@spark/shared";
import type { ActiveWindowContext } from "./types.js";

export function parseHttpUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)\]]+/i);
  return match?.[0];
}

export function inferPlatform(url: string, appName: string, title: string): Platform {
  const host = (() => {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
  })();

  if (host.includes("youtube.com") || /youtube/i.test(appName) || /youtube/i.test(title)) return "youtube";
  if (host === "x.com" || host.endsWith(".x.com") || host.includes("twitter.com") || /x\.com|twitter/i.test(title)) return "x";
  return "other";
}

export function inferContentMode(platform: Platform, url: string, title: string): ContentMode {
  const lowerTitle = title.toLowerCase();
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (platform === "youtube" && path.startsWith("/shorts")) return "shorts";
    if (platform === "youtube" && path === "/") return "feed";
    if (platform === "x" && (path === "/" || path.startsWith("/home"))) return "feed";
    if (path.includes("search") || u.searchParams.has("search_query") || u.searchParams.has("q")) return "search";
  } catch {
    // ignore invalid URL
  }

  if (lowerTitle.includes("search")) return "search";
  return "other";
}

export function contextToUrl(ctx: ActiveWindowContext): string {
  if (ctx.url?.startsWith("http")) return ctx.url;
  const fromTitle = parseHttpUrl(ctx.title);
  if (fromTitle) return fromTitle;
  const app = encodeURIComponent(ctx.appName.toLowerCase().replace(/\s+/g, "-"));
  const title = encodeURIComponent(ctx.title.slice(0, 120));
  return `app://${app}?title=${title}`;
}

export function buildEvent(ctx: ActiveWindowContext, sessionStartMs: number): EventIngest {
  const url = contextToUrl(ctx);
  const platform = inferPlatform(url, ctx.appName, ctx.title);
  return {
    timestamp: new Date().toISOString(),
    platform,
    contentMode: inferContentMode(platform, url, ctx.title),
    url,
    title: `${ctx.appName} - ${ctx.title}`,
    sessionSeconds: Math.max(1, Math.round((Date.now() - sessionStartMs) / 1000)),
    scrollCount: 0
  };
}

export function contextKeyFromEvent(event: EventIngest): string {
  return `${event.platform}|${event.contentMode}|${event.url}`;
}
