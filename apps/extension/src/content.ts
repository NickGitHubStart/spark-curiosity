import type { ContentMode, EventDecisionResponse, EventIngest, FeedbackResponse, Platform, ThumbFeedback } from "@spark/shared";

type BridgeResponse = { ok: boolean; status: number; json?: unknown };

let scrollCount = 0;
const startedAt = Date.now();
let overlayOpen = false;
let lastSentContext = "";

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

function detectPlatform(): Platform {
  if (location.hostname.includes("youtube.com")) return "youtube";
  if (
    location.hostname === "x.com" ||
    location.hostname.endsWith(".x.com") ||
    location.hostname === "twitter.com" ||
    location.hostname.endsWith(".twitter.com")
  ) return "x";
  return "other";
}

function detectContentMode(platform: Platform): ContentMode {
  const path = location.pathname;
  if (platform === "youtube" && path.startsWith("/shorts")) return "shorts";
  if (platform === "youtube" && path === "/") return "feed";
  if (platform === "x" && (path === "/" || path.startsWith("/home"))) return "feed";
  if (path.includes("search") || location.search.includes("search_query")) return "search";
  return "other";
}

function collectEvent(): EventIngest {
  const platform = detectPlatform();
  return {
    timestamp: new Date().toISOString(),
    platform,
    contentMode: detectContentMode(platform),
    url: location.href,
    title: document.title,
    sessionSeconds: Math.floor((Date.now() - startedAt) / 1000),
    scrollCount
  };
}

function contextKey(event: EventIngest): string {
  return `${event.platform}|${event.contentMode}|${location.pathname}`;
}

async function sendEvent(reason: string): Promise<void> {
  const event = collectEvent();
  if (event.platform === "other") return;

  const response = await bridge("/event", "POST", event);
  if (!response.ok) {
    await logClient("error", "event_failed", { reason, status: response.status, event });
    return;
  }

  const decision = response.json as EventDecisionResponse;
  await logClient("info", "event_ok", { reason, decision, event });

  if (decision.shouldPrompt && decision.promptId && decision.promptText) {
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
  box.style.maxWidth = "320px";
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
    await logClient("error", "feedback_failed", { feedback, status: response.status });
  }

  overlayOpen = false;
  box.remove();
}

window.addEventListener("scroll", () => {
  scrollCount += 1;
});

if (["youtube", "x"].includes(detectPlatform())) {
  void logClient("info", "content_script_initialized", { href: location.href, title: document.title });

  setTimeout(() => {
    void sendEvent("initial");
  }, 1000);

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
  }, 15000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void sendEvent("visibility");
    }
  });
}
