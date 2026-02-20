import type { ContentMode, ContentSnapshot, EventDecisionResponse, EventIngest, FeedbackResponse, Platform, ThumbFeedback } from "@spark/shared";

const sessionStartedAt = Date.now();
let scrollEvents = 0;
let overlayOpen = false;
let scheduledFlush: number | undefined;
let lastSentAt = 0;
let lastContextKey = "";
let tabSwitches = 0;

const LLM_EVENT_DEBOUNCE_MS = 3000;
const LLM_HEARTBEAT_MS = 60000;

type CompanionBridgeResponse = {
  ok: boolean;
  status: number;
  json?: unknown;
};

function requestCompanion(path: string, method: "GET" | "POST", body?: unknown): Promise<CompanionBridgeResponse> {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(
      {
        type: "spark_companion_request",
        path,
        method,
        body
      },
      (response: CompanionBridgeResponse) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            status: 0,
            json: { error: chrome.runtime.lastError.message || "runtime_error" }
          });
          return;
        }
        resolve(response || { ok: false, status: 0, json: { error: "empty_response" } });
      }
    );
  });
}

async function sendClientLog(level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>): Promise<void> {
  try {
    await requestCompanion("/debug/client-log", "POST", {
      at: new Date().toISOString(),
      level,
      message,
      context
    });
  } catch {
    // Swallow logging errors to avoid cascading failures in content scripts.
  }
}

window.addEventListener("scroll", () => {
  scrollEvents += 1;
});
window.addEventListener("focus", () => {
  tabSwitches += 1;
});

function detectPlatform(): Platform {
  if (location.hostname.includes("youtube.com")) return "youtube";
  if (
    location.hostname === "x.com" ||
    location.hostname.endsWith(".x.com") ||
    location.hostname === "twitter.com" ||
    location.hostname.endsWith(".twitter.com")
  ) {
    return "x";
  }
  return "other";
}

function detectContentMode(platform: Platform): ContentMode {
  const path = location.pathname;
  if (platform === "youtube" && path.startsWith("/shorts")) return "shorts";
  if (platform === "youtube" && path === "/") return "feed";
  if (platform === "x" && (path === "/" || path.startsWith("/home"))) return "feed";
  if (location.search.includes("search_query") || path.includes("search")) return "search";
  return "unknown";
}

function cleanText(input: string | null | undefined, max = 240): string | undefined {
  if (!input) return undefined;
  const text = input.replace(/\\s+/g, " ").trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

function buildContentSnapshot(platform: Platform, contentMode: ContentMode): ContentSnapshot {
  const snapshot: ContentSnapshot = {
    pageTitle: cleanText(document.title, 180)
  };

  const mainText = cleanText(document.body?.innerText, 500);
  if (mainText) snapshot.textSample = mainText;

  if (platform === "youtube") {
    const videoTitle = cleanText(
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent ||
        document.querySelector("#title h1")?.textContent ||
        document.querySelector("ytd-reel-video-renderer h2")?.textContent,
      180
    );
    const channelName = cleanText(
      document.querySelector("ytd-channel-name #text")?.textContent ||
        document.querySelector("#channel-name a")?.textContent,
      120
    );
    snapshot.youtube = {
      videoTitle,
      channelName,
      isShort: contentMode === "shorts"
    };
  }

  if (platform === "x") {
    const candidates = Array.from(document.querySelectorAll("article div[lang]"))
      .slice(0, 5)
      .map(node => cleanText(node.textContent, 220))
      .filter(Boolean) as string[];
    snapshot.x = { postSamples: candidates };
  }

  return snapshot;
}

async function postEvent(): Promise<void> {
  const platform = detectPlatform();
  const contentMode = detectContentMode(platform);
  if (!["youtube", "x"].includes(platform)) return;
  const event: EventIngest = {
    timestamp: new Date().toISOString(),
    platform,
    contentMode,
    url: location.href,
    signals: {
      sessionSeconds: Math.round((Date.now() - sessionStartedAt) / 1000),
      scrollEvents,
      tabSwitches
    },
    content: buildContentSnapshot(platform, contentMode)
  };

  let bridgeResponse: CompanionBridgeResponse;
  try {
    bridgeResponse = await requestCompanion("/event", "POST", event);
  } catch (err) {
    await sendClientLog("error", "event_post_failed", {
      error: String(err),
      platform,
      contentMode,
      url: location.href
    });
    return;
  }

  if (!bridgeResponse.ok) {
    await sendClientLog("warn", "event_post_non_ok", {
      status: bridgeResponse.status,
      platform,
      contentMode
    });
    return;
  }
  const payload = bridgeResponse.json as EventDecisionResponse;
  if (!payload.shouldPrompt || !payload.prompt) return;
  await sendClientLog("info", "popup_decision_true", {
    platform,
    contentMode,
    riskScore: payload.riskScore,
    reasonCodes: payload.reasonCodes,
    decisionSource: payload.decisionSource
  });
  showThumbOverlay(payload.prompt.id, payload.prompt.text);
}

function scheduleEventFlush(reason: string): void {
  if (scheduledFlush) window.clearTimeout(scheduledFlush);
  const _reason = reason;
  scheduledFlush = window.setTimeout(() => {
    void postEvent();
    lastSentAt = Date.now();
    scheduledFlush = undefined;
  }, LLM_EVENT_DEBOUNCE_MS);
  void _reason;
}

function contextKey(): string {
  const p = detectPlatform();
  const m = detectContentMode(p);
  return `${p}|${m}|${location.pathname}`;
}

function showThumbOverlay(promptId: string, text: string): void {
  if (overlayOpen || document.getElementById("spark-curiosity-overlay")) return;
  overlayOpen = true;

  const wrapper = document.createElement("div");
  wrapper.id = "spark-curiosity-overlay";
  wrapper.style.position = "fixed";
  wrapper.style.bottom = "20px";
  wrapper.style.right = "20px";
  wrapper.style.zIndex = "2147483647";
  wrapper.style.background = "#111";
  wrapper.style.color = "#fff";
  wrapper.style.padding = "12px";
  wrapper.style.borderRadius = "10px";
  wrapper.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
  wrapper.style.maxWidth = "320px";
  wrapper.innerHTML = `
    <div style="font: 14px/1.4 sans-serif; margin-bottom: 10px;">${text}</div>
    <button id="spark-thumb-up" style="margin-right:8px;">👍</button>
    <button id="spark-thumb-down">👎</button>
  `;

  document.body.appendChild(wrapper);

  const up = wrapper.querySelector("#spark-thumb-up") as HTMLButtonElement;
  const down = wrapper.querySelector("#spark-thumb-down") as HTMLButtonElement;

  up.addEventListener("click", () => submitFeedback(promptId, "up", wrapper));
  down.addEventListener("click", () => submitFeedback(promptId, "down", wrapper));
}

async function submitFeedback(promptId: string, feedback: ThumbFeedback, wrapper: HTMLElement): Promise<void> {
  const response = await requestCompanion("/feedback", "POST", {
    promptId,
    feedback,
    timestamp: new Date().toISOString()
  });

  if (response.ok) {
    const payload = response.json as FeedbackResponse;
    if (payload.action?.type === "redirect" && payload.action.url) {
      location.href = payload.action.url;
    }
  }

  overlayOpen = false;
  wrapper.remove();
}

if (["youtube", "x"].includes(detectPlatform())) {
  void sendClientLog("info", "content_script_initialized", {
    platform: detectPlatform(),
    href: location.href
  });

  setTimeout(() => {
    scheduleEventFlush("initial");
  }, 1200);

  // Trigger on meaningful context changes; companion LLM decides what to do.
  setInterval(() => {
    const currentKey = contextKey();
    if (currentKey !== lastContextKey) {
      lastContextKey = currentKey;
      scheduleEventFlush("context_change");
    }
  }, 1000);

  // Safety heartbeat so model can still reason when context stays stable.
  setInterval(() => {
    if (!document.hidden) {
      if (Date.now() - lastSentAt >= LLM_HEARTBEAT_MS) {
        scheduleEventFlush("heartbeat");
      }
    }
  }, 5000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleEventFlush("visibility");
    }
  });
}
