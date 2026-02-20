type BridgeRequest = {
  type: "spark_bridge";
  path: string;
  method: "GET" | "POST";
  body?: unknown;
};

type TabSession = {
  startedAtMs: number;
  lastSeenAtMs: number;
  lastAbsoluteScroll: number;
  cumulativeScroll: number;
};

const COMPANION_URL = "http://localhost:4343";
const tabSessions = new Map<number, TabSession>();

function detectPlatform(url: string): "youtube" | "x" | "other" {
  try {
    const host = new URL(url).hostname;
    if (host.includes("youtube.com")) return "youtube";
    if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) return "x";
    return "other";
  } catch {
    return "other";
  }
}

function detectContentMode(platform: "youtube" | "x" | "other", url: string): "shorts" | "feed" | "search" | "other" {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (platform === "youtube" && path.startsWith("/shorts")) return "shorts";
    if (platform === "youtube" && path === "/") return "feed";
    if (platform === "x" && (path === "/" || path.startsWith("/home"))) return "feed";
    if (path.includes("search") || u.searchParams.has("search_query") || u.searchParams.has("q")) return "search";
    return "other";
  } catch {
    return "other";
  }
}

function enrichEvent(messageBody: unknown, sender: chrome.runtime.MessageSender): unknown {
  if (!messageBody || typeof messageBody !== "object") return messageBody;

  const raw = messageBody as Record<string, unknown>;
  const tabId = sender.tab?.id;
  const now = Date.now();

  if (typeof tabId !== "number") {
    const fallbackUrl = typeof raw.url === "string" ? raw.url : sender.tab?.url || "";
    const platform = detectPlatform(fallbackUrl);
    return {
      ...raw,
      timestamp: new Date().toISOString(),
      url: fallbackUrl,
      title: typeof raw.title === "string" ? raw.title : sender.tab?.title || "",
      platform,
      contentMode: detectContentMode(platform, fallbackUrl)
    };
  }

  const existing = tabSessions.get(tabId);
  const state: TabSession = existing || {
    startedAtMs: now,
    lastSeenAtMs: now,
    lastAbsoluteScroll: 0,
    cumulativeScroll: 0
  };

  const absoluteScroll = typeof raw.scrollCount === "number" ? Math.max(0, Math.floor(raw.scrollCount)) : 0;
  const delta = absoluteScroll >= state.lastAbsoluteScroll ? absoluteScroll - state.lastAbsoluteScroll : absoluteScroll;
  state.cumulativeScroll += delta;
  state.lastAbsoluteScroll = absoluteScroll;
  state.lastSeenAtMs = now;
  tabSessions.set(tabId, state);

  const url = typeof raw.url === "string" ? raw.url : sender.tab?.url || "";
  const platform = detectPlatform(url);

  return {
    ...raw,
    timestamp: new Date().toISOString(),
    url,
    title: sender.tab?.title || (typeof raw.title === "string" ? raw.title : ""),
    platform,
    contentMode: detectContentMode(platform, url),
    sessionSeconds: Math.max(0, Math.floor((now - state.startedAtMs) / 1000)),
    scrollCount: state.cumulativeScroll
  };
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Spark extension installed");
});

chrome.tabs.onRemoved.addListener(tabId => {
  tabSessions.delete(tabId);
});

chrome.runtime.onMessage.addListener((message: BridgeRequest, sender, sendResponse) => {
  if (!message || message.type !== "spark_bridge") return false;

  console.log("[spark:bg] bridge request", message.method, message.path);

  void (async () => {
    try {
      const body = message.path === "/event" ? enrichEvent(message.body, sender) : message.body;
      const url = `${COMPANION_URL}${message.path}`;
      const response = await fetch(url, {
        method: message.method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      console.log("[spark:bg] bridge response", message.path, response.status);
      sendResponse({ ok: response.ok, status: response.status, json });
    } catch (error) {
      console.error("[spark:bg] bridge error", message.path, String(error));
      sendResponse({ ok: false, status: 0, json: { error: String(error) } });
    }
  })();

  return true;
});
