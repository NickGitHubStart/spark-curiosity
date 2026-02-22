import type { ChatResponse, EventDecisionResponse, EventIngest, FeedbackResponse, ThumbFeedback } from "@spark/shared";

type BridgeResponse = { ok: boolean; status: number; json?: unknown };

let overlayOpen = false;
let chatOpen = false;
let lastSentContext = "";
let scrollDistancePx = 0;
let lastScrollY = window.scrollY;
let sessionStartMs = Date.now();
let lastProductiveUrl = "";
let lastProductiveTitle = "";

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
  await bridge("/debug/client-log", "POST", { at: new Date().toISOString(), level, message, context });
}

function bestTitle(): string {
  const ytTitle = document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim();
  if (ytTitle) return ytTitle;
  const og = document.querySelector('meta[property="og:title"]')?.getAttribute("content")?.trim();
  if (og) return og;
  const heading = document.querySelector("h1")?.textContent?.trim();
  if (heading) return heading;
  return document.title || "";
}

function detectPlatform(): "youtube" | "x" | "other" {
  const host = location.hostname;
  if (host.includes("youtube.com")) return "youtube";
  if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) return "x";
  return "other";
}

function detectContentMode(platform: string): "shorts" | "feed" | "search" | "other" {
  const path = location.pathname;
  if (platform === "youtube" && path.startsWith("/shorts")) return "shorts";
  if (platform === "youtube" && path === "/") return "feed";
  if (platform === "x" && (path === "/" || path.startsWith("/home"))) return "feed";
  if (path.includes("search") || location.search.includes("search_query")) return "search";
  return "other";
}

function trackPreviousUrl(): void {
  if (location.href !== lastProductiveUrl) {
    lastProductiveUrl = location.href;
    lastProductiveTitle = bestTitle() || document.title || "";
  }
}

function collectEvent(): EventIngest {
  const platform = detectPlatform();
  const sessionSeconds = Math.round((Date.now() - sessionStartMs) / 1000);
  return {
    timestamp: new Date().toISOString(),
    platform,
    contentMode: detectContentMode(platform),
    url: location.href,
    title: bestTitle(),
    sessionSeconds,
    scrollCount: Math.floor(scrollDistancePx / 280),
    lastProductiveUrl: lastProductiveUrl || undefined,
    lastProductiveTitle: lastProductiveTitle || undefined,
  };
}

function contextKey(event: EventIngest): string {
  return `${event.platform}|${event.contentMode}|${event.url}`;
}

// --- Overlay: Intervention Popup (zentriert) ---

function showOverlay(promptId: string, text: string, agentRedirectUrl?: string): void {
  if (overlayOpen || document.getElementById("spark-backdrop")) return;
  overlayOpen = true;

  const backdrop = document.createElement("div");
  backdrop.id = "spark-backdrop";
  backdrop.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);
    z-index:2147483646;display:flex;align-items:center;justify-content:center;
    animation:spark-fade-in .25s ease;
  `;

  const box = document.createElement("div");
  box.id = "spark-overlay";
  box.style.cssText = `
    background:linear-gradient(135deg,#141825 0%,#1a1f35 100%);
    color:#e8edf5;padding:28px 32px;border-radius:16px;
    max-width:440px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5),0 0 0 1px rgba(120,160,255,0.1);
    font-family:'Segoe UI',system-ui,sans-serif;
    animation:spark-slide-up .3s ease;z-index:2147483647;
  `;

  box.innerHTML = `
    <style>
      @keyframes spark-fade-in{from{opacity:0}to{opacity:1}}
      @keyframes spark-slide-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      #spark-overlay .spark-text{font-size:17px;line-height:1.55;margin-bottom:20px;color:#d0d8e8}
      #spark-overlay .spark-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#5a6a8a;margin-bottom:12px;font-weight:600}
      #spark-overlay .spark-actions{display:flex;gap:12px}
      #spark-overlay .spark-btn{
        flex:1;padding:12px 16px;border:none;border-radius:10px;
        font-size:15px;font-weight:600;cursor:pointer;
        transition:transform .15s,box-shadow .15s;
      }
      #spark-overlay .spark-btn:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,0.3)}
      #spark-overlay .spark-btn:active{transform:translateY(0)}
      #spark-overlay .spark-btn-yes{background:#0d3320;color:#34d399}
      #spark-overlay .spark-btn-no{background:#331a1a;color:#f87171}
    </style>
    <div class="spark-label">Spark Curiosity</div>
    <div class="spark-text">${text}</div>
    <div class="spark-actions">
      <button class="spark-btn spark-btn-yes" id="spark-up">Ja, passt schon</button>
      <button class="spark-btn spark-btn-no" id="spark-down">Nee, zurück zum Fokus</button>
    </div>
  `;

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  (box.querySelector("#spark-up") as HTMLButtonElement).addEventListener("click", () => submitFeedback(promptId, "up", backdrop, undefined));
  (box.querySelector("#spark-down") as HTMLButtonElement).addEventListener("click", () => submitFeedback(promptId, "down", backdrop, agentRedirectUrl));
}

// --- Goal-Setting Popup ---

function showGoalPopup(promptId: string, question: string, options: string[], platform: "youtube" | "x" | "other"): void {
  if (overlayOpen || document.getElementById("spark-backdrop")) return;
  overlayOpen = true;

  const backdrop = document.createElement("div");
  backdrop.id = "spark-backdrop";
  backdrop.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);
    z-index:2147483646;display:flex;align-items:center;justify-content:center;
    animation:spark-fade-in .25s ease;
  `;

  const box = document.createElement("div");
  box.style.cssText = `
    background:linear-gradient(135deg,#141825 0%,#1a1f35 100%);
    color:#e8edf5;padding:28px 32px;border-radius:16px;
    max-width:460px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5),0 0 0 1px rgba(80,160,255,0.15);
    font-family:'Segoe UI',system-ui,sans-serif;animation:spark-slide-up .3s ease;
  `;

  const buttonColors = ["#0d3320;color:#34d399", "#1a2540;color:#60a5fa", "#252015;color:#a0906a"];
  const buttonsHtml = options.map((opt, i) =>
    `<button class="spark-goal-btn" data-option="${opt}" style="
      display:block;width:100%;padding:12px;margin-bottom:8px;border:none;border-radius:10px;
      font-size:15px;font-weight:600;cursor:pointer;background:#${buttonColors[i] || buttonColors[0]};
      transition:transform .15s;
    ">${opt}</button>`
  ).join("");

  box.innerHTML = `
    <style>
      .spark-goal-btn:hover{transform:translateY(-1px)}
      .spark-goal-btn:active{transform:translateY(0)}
    </style>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#5a6a8a;margin-bottom:12px;font-weight:600">Spark Curiosity — Ziel setzen</div>
    <div style="font-size:17px;line-height:1.55;margin-bottom:20px;color:#d0d8e8">${question}</div>
    ${buttonsHtml}
  `;

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  box.querySelectorAll(".spark-goal-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const selected = (btn as HTMLElement).dataset.option || "";
      console.log("[spark] goal selected:", selected, platform);
      await bridge("/goal-feedback", "POST", {
        promptId, selectedOption: selected, platform, timestamp: new Date().toISOString()
      });
      overlayOpen = false;
      backdrop.remove();
    });
  });
}

// --- Chat Widget ---

function injectChatWidget(): void {
  if (document.getElementById("spark-chat-bubble")) return;

  const style = document.createElement("style");
  style.textContent = `
    #spark-chat-bubble:hover{transform:scale(1.1) !important;box-shadow:0 6px 28px rgba(0,0,0,0.5),0 0 0 1px rgba(120,160,255,0.25) !important}
    #spark-chat-panel{
      position:fixed !important;bottom:90px !important;right:20px !important;z-index:2147483641 !important;
      width:360px !important;max-height:460px !important;background:#10172a !important;border:1px solid #1a2545 !important;
      border-radius:14px !important;box-shadow:0 12px 40px rgba(0,0,0,0.5) !important;
      display:none !important;flex-direction:column !important;font-family:'Segoe UI',system-ui,sans-serif !important;
      overflow:hidden !important;
    }
    #spark-chat-panel.spark-open{display:flex !important}
    #spark-chat-header{padding:12px 16px !important;background:#131c33 !important;border-bottom:1px solid #1a2545 !important;display:flex !important;justify-content:space-between !important;align-items:center !important}
    #spark-chat-header h4{color:#7eb8ff !important;font-size:14px !important;margin:0 !important;font-weight:600 !important}
    #spark-chat-close{background:none !important;border:none !important;color:#5a6a8a !important;font-size:18px !important;cursor:pointer !important;padding:0 4px !important}
    #spark-chat-close:hover{color:#fff !important}
    #spark-chat-messages{flex:1 !important;overflow-y:auto !important;padding:12px !important;max-height:300px !important}
    .spark-msg{margin-bottom:10px !important;max-width:85% !important;padding:8px 12px !important;border-radius:10px !important;font-size:14px !important;line-height:1.45 !important}
    .spark-msg.user{background:#1a2545 !important;color:#c0d0e8 !important;margin-left:auto !important}
    .spark-msg.ai{background:#0d2520 !important;color:#a0d8c0 !important}
    .spark-msg.system{background:#1a1a25 !important;color:#6a6a8a !important;font-size:12px !important;text-align:center !important;margin:0 auto !important}
    #spark-chat-input-area{padding:10px !important;border-top:1px solid #1a2545 !important;display:flex !important;gap:8px !important}
    #spark-chat-input{flex:1 !important;background:#0d1225 !important;border:1px solid #2a3a5a !important;border-radius:8px !important;padding:8px 12px !important;color:#d0d8e8 !important;font-size:14px !important;outline:none !important;font-family:inherit !important}
    #spark-chat-input:focus{border-color:#4a6a9a !important}
    #spark-chat-send{background:#1a3040 !important;color:#60a5fa !important;border:none !important;border-radius:8px !important;padding:8px 14px !important;cursor:pointer !important;font-size:14px !important;font-weight:600 !important}
    #spark-chat-send:hover{background:#243a50 !important}
    #spark-chat-send:disabled{opacity:0.5 !important;cursor:default !important}
  `;
  document.head.appendChild(style);

  const bubble = document.createElement("div");
  bubble.id = "spark-chat-bubble";
  bubble.style.cssText = `
    position:fixed !important;bottom:24px !important;right:24px !important;z-index:2147483640 !important;
    width:50px !important;height:50px !important;border-radius:50% !important;
    background:linear-gradient(135deg,#1a2540,#243060) !important;
    box-shadow:0 4px 20px rgba(0,0,0,0.4),0 0 0 1px rgba(120,160,255,0.15) !important;
    cursor:pointer !important;display:flex !important;align-items:center !important;justify-content:center !important;
    transition:transform .2s,box-shadow .2s !important;
  `;
  bubble.textContent = "⚡";
  bubble.style.fontSize = "22px";
  bubble.style.lineHeight = "1";
  bubble.title = "Spark Chat öffnen";

  const panel = document.createElement("div");
  panel.id = "spark-chat-panel";
  panel.innerHTML = `
    <div id="spark-chat-header">
      <h4>⚡ Spark Chat</h4>
      <button id="spark-chat-close">×</button>
    </div>
    <div id="spark-chat-messages">
      <div class="spark-msg system">Schreib mir was du brauchst — Ziele setzen, Musik teilen, Feedback geben.</div>
    </div>
    <div id="spark-chat-input-area">
      <input id="spark-chat-input" type="text" placeholder="Nachricht an Spark..." autocomplete="off"/>
      <button id="spark-chat-send">→</button>
    </div>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  bubble.addEventListener("click", (e) => {
    e.stopPropagation();
    chatOpen = !chatOpen;
    panel.classList.toggle("spark-open", chatOpen);
    if (chatOpen) {
      (panel.querySelector("#spark-chat-input") as HTMLInputElement).focus();
    }
  });

  panel.querySelector("#spark-chat-close")!.addEventListener("click", () => {
    chatOpen = false;
    panel.classList.remove("spark-open");
  });

  const input = panel.querySelector("#spark-chat-input") as HTMLInputElement;
  const sendBtn = panel.querySelector("#spark-chat-send") as HTMLButtonElement;
  const messages = panel.querySelector("#spark-chat-messages") as HTMLDivElement;

  async function sendChatMessage(): Promise<void> {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    sendBtn.disabled = true;

    const userMsg = document.createElement("div");
    userMsg.className = "spark-msg user";
    userMsg.textContent = text;
    messages.appendChild(userMsg);
    messages.scrollTop = messages.scrollHeight;

    const response = await bridge("/chat", "POST", { message: text, timestamp: new Date().toISOString() });
    sendBtn.disabled = false;

    const aiMsg = document.createElement("div");
    aiMsg.className = "spark-msg ai";
    if (response.ok && response.json) {
      const data = response.json as ChatResponse;
      aiMsg.textContent = data.reply;
      if (data.memoryUpdated) {
        const note = document.createElement("div");
        note.className = "spark-msg system";
        note.textContent = "✓ Memory aktualisiert";
        messages.appendChild(note);
      }
    } else {
      aiMsg.textContent = "Konnte keine Antwort erhalten.";
    }
    messages.appendChild(aiMsg);
    messages.scrollTop = messages.scrollHeight;
    input.focus();
  }

  sendBtn.addEventListener("click", () => { void sendChatMessage(); });
  input.addEventListener("keydown", e => { if (e.key === "Enter") void sendChatMessage(); });
}

// --- Feedback ---

async function submitFeedback(promptId: string, feedback: ThumbFeedback, container: HTMLElement, agentRedirectUrl?: string): Promise<void> {
  const response = await bridge("/feedback", "POST", { promptId, feedback, timestamp: new Date().toISOString() });
  if (response.ok) {
    const payload = response.json as FeedbackResponse;
    await logClient("info", "feedback_ok", { feedback, payload });
    const redirect = payload.redirectUrl || agentRedirectUrl;
    if (redirect) location.href = redirect;
  } else {
    await logClient("error", "feedback_failed", { feedback, status: response.status });
  }
  overlayOpen = false;
  container.remove();
}

// --- Event Sending ---

async function sendEvent(reason: string): Promise<void> {
  const event = collectEvent();

  console.log("[spark] sendEvent", reason, event.platform, event.url);
  await logClient("info", "event_send", { reason, platform: event.platform, url: event.url, contentMode: event.contentMode });
  const response = await bridge("/event", "POST", event);

  if (!response.ok) {
    console.warn("[spark] event failed", response.status);
    await logClient("error", "event_failed", { reason, status: response.status, bridgeResponse: response.json });
    return;
  }

  const decision = response.json as EventDecisionResponse;
  console.log("[spark] decision", decision.shouldPrompt, decision.reason);
  await logClient("info", "event_ok", {
    reason,
    shouldPrompt: decision.shouldPrompt,
    agentSkipped: decision.agentSkipped || false,
    aiUsed: Boolean(decision.ai?.used),
    decisionReason: decision.reason
  });

  if (decision.goalQuestion && decision.goalOptions?.length) {
    showGoalPopup(
      decision.promptId || `goal-${Date.now()}`,
      decision.goalQuestion,
      decision.goalOptions,
      event.platform
    );
    return;
  }

  if (decision.shouldPrompt && decision.promptId && decision.promptText) {
    console.log("[spark] showing popup:", decision.promptText);
    if (decision.redirectUrl) {
      console.log("[spark] agent suggests redirect to:", decision.redirectUrl);
    }
    showOverlay(decision.promptId, decision.promptText, decision.redirectUrl);
  }
}

// --- Scroll Tracking ---

function handleScroll(): void {
  const y = window.scrollY;
  const delta = Math.abs(y - lastScrollY);
  if (delta > 0) {
    scrollDistancePx += delta;
    lastScrollY = y;
  }
}

// --- SPA Navigation ---

function installSpaNavigationHooks(): void {
  const notify = () => {
    sessionStartMs = Date.now();
    scrollDistancePx = 0;
    trackPreviousUrl();
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

// --- Init ---

const platform = detectPlatform();
console.log("[spark] content script loaded on", location.href, "platform:", platform);
void logClient("info", "content_script_initialized", { href: location.href, platform });

trackPreviousUrl();
injectChatWidget();
installSpaNavigationHooks();
window.addEventListener("scroll", handleScroll, { passive: true });

setTimeout(() => { void sendEvent("initial"); }, 700);

setInterval(() => {
  const evt = collectEvent();
  const key = contextKey(evt);
  if (key !== lastSentContext) {
    lastSentContext = key;
    void sendEvent("context_change");
  }
}, 1000);

setInterval(() => {
  if (!document.hidden) void sendEvent("heartbeat");
}, 20000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void sendEvent("visibility");
});
