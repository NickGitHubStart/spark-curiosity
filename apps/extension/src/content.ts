import type { EventDecisionResponse, EventIngest, FeedbackResponse, ThumbFeedback } from "@spark/shared";

type BridgeResponse = { ok: boolean; status: number; json?: unknown };

let overlayOpen = false;
let lastSentContext = "";
let scrollDistancePx = 0;
let lastScrollY = window.scrollY;

function bridge(path: string, method: "GET" | "POST", body?: unknown): Promise<BridgeResponse> {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      { type: "spark_bridge", path, method, body },
      (response: BridgeResponse) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, status: 0, json: { error: chrome.runtime.lastError.message || "runtime_error" } });
          return;
        }
        resolve(response || { ok: false, status: 0, json: { error: "empty" } });
      }
    );
  });
}

async function logClient(level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>): Promise<void> {
  await bridge("/debug/client-log", "POST", {
    at: new Date().toISOString(),
    level,
    message,
    context
  });
}

function bestTitle(): string {
  const ytTitle = document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim();
  if (ytTitle) return ytTitle;

  const og = document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim();
  if (og) return og;

  const tw = document.querySelector('meta[name="twitter:title"]')?.getAttribute("content")?.trim();
  if (tw) return tw;

  const heading = document.querySelector("h1")?.textContent?.trim();
  if (heading) return heading;

  return document.title || "";
}

function detectPlatformFromUrl(url: string): "youtube" | "x" | "other" {
  try {
    const host = new URL(url).hostname;
    if (host.includes("youtube.com")) return "youtube";
    if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) return "x";
    return "other";
  } catch {
    return "other";
  }
}

function detectContentModeFromUrl(url: string): "shorts" | "feed" | "search" | "other" {
  const platform = detectPlatformFromUrl(url);
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

function collectEvent(): EventIngest {
  const url = location.href;
  return {
    timestamp: new Date().toISOString(),
    platform: detectPlatformFromUrl(url),
    contentMode: detectContentModeFromUrl(url),
    url,
    title: bestTitle(),
    sessionSeconds: 0,
    scrollCount: Math.floor(scrollDistancePx / 280)
  };
}

function contextKey(event: EventIngest): string {
  return `${event.platform}|${event.contentMode}|${event.url}`;
}

async function sendEvent(reason: string): Promise<void> {
  const event = collectEvent();
  console.log("[spark] sendEvent", reason, event.platform, event.contentMode, event.url);
  const response = await bridge("/event", "POST", event);
  if (!response.ok) {
    console.warn("[spark] event failed", response.status, response.json);
    await logClient("error", "event_failed", { reason, status: response.status, event, response: response.json });
    return;
  }

  const decision = response.json as EventDecisionResponse;
  console.log("[spark] decision", decision.shouldPrompt, decision.reason);
  await logClient("info", "event_ok", { reason, decision, event });

  if (decision.shouldPrompt && decision.promptId && decision.promptText) {
    console.log("[spark] showing popup:", decision.promptText);
    showOverlay(decision.promptId, decision.promptText);
  }
}

function showOverlay(promptId: string, text: string): void {
  if (overlayOpen || document.getElementById("spark-overlay")) return;
  overlayOpen = true;

  const box = document.createElement("div");
  box.id = "spark-overlay";
  box.style.position = "fixed";
  box.style.right = "20px";
  box.style.bottom = "20px";
  box.style.zIndex = "2147483647";
  box.style.background = "#111";
  box.style.color = "#fff";
  box.style.padding = "12px";
  box.style.borderRadius = "10px";
  box.style.maxWidth = "360px";
  box.style.boxShadow = "0 10px 24px rgba(0,0,0,0.4)";
  box.innerHTML = `
    <div style="margin-bottom:10px;font:14px/1.4 sans-serif;">${text}</div>
    <button id="spark-up" style="margin-right:8px;">👍</button>
    <button id="spark-down">👎</button>
  `;

  document.body.appendChild(box);

  const up = box.querySelector("#spark-up") as HTMLButtonElement;
  const down = box.querySelector("#spark-down") as HTMLButtonElement;

  up.addEventListener("click", () => submitFeedback(promptId, "up", box));
  down.addEventListener("click", () => submitFeedback(promptId, "down", box));
}

async function submitFeedback(promptId: string, feedback: ThumbFeedback, box: HTMLElement): Promise<void> {
  const response = await bridge("/feedback", "POST", {
    promptId,
    feedback,
    timestamp: new Date().toISOString()
  });

  if (response.ok) {
    const payload = response.json as FeedbackResponse;
    await logClient("info", "feedback_ok", { feedback, payload });
    if (payload.redirectUrl) location.href = payload.redirectUrl;
  } else {
    await logClient("error", "feedback_failed", { feedback, status: response.status, response: response.json });
  }

  overlayOpen = false;
  box.remove();
}

function handleScroll(): void {
  const y = window.scrollY;
  const delta = Math.abs(y - lastScrollY);
  if (delta > 0) {
    scrollDistancePx += delta;
    lastScrollY = y;
  }
}

function installSpaNavigationHooks(): void {
  const notify = () => {
    void sendEvent("route_change");
  };

  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);

  const originalPush = history.pushState.bind(history);
  history.pushState = ((...args: Parameters<History["pushState"]>) => {
    originalPush(...args);
    notify();
  }) as History["pushState"];

  const originalReplace = history.replaceState.bind(history);
  history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
    originalReplace(...args);
    notify();
  }) as History["replaceState"];
}

console.log("[spark] content script loaded on", location.href);

void logClient("info", "content_script_initialized", { href: location.href, title: bestTitle() });

installSpaNavigationHooks();
window.addEventListener("scroll", handleScroll, { passive: true });

setTimeout(() => {
  console.log("[spark] sending initial event");
  void sendEvent("initial");
}, 700);

setInterval(() => {
  const evt = collectEvent();
  const key = contextKey(evt);
  if (key !== lastSentContext) {
    lastSentContext = key;
    void sendEvent("context_change");
  }
}, 1000);

setInterval(() => {
  if (!document.hidden) {
    void sendEvent("heartbeat");
  }
}, 10000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void sendEvent("visibility");
  }
});
