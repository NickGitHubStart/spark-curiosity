import type { AgentAction, ChatResponse, EventDecisionResponse, EventIngest, InteractionFeedbackResponse, RedirectReviewEvent } from "@spark/shared";

type BridgeResponse = { ok: boolean; status: number; json?: unknown };

let overlayOpen = false;
let chatOpen = false;
let lastSentContext = "";
let scrollDistancePx = 0;
let lastScrollY = window.scrollY;
let sessionStartMs = Date.now();
let lastProductiveUrl = "";
let lastProductiveTitle = "";
const PENDING_REVIEW_KEY = "spark_pending_redirect_review";
const REDIRECT_TRACKER_KEY = "spark_last_redirect";

type PendingRedirectReview = {
  question: string;
  options: string[];
  platform: "youtube" | "x" | "other";
  fromUrl?: string;
  createdAt: string;
};

type RedirectTracker = {
  fromUrl: string;
  toUrl: string;
  redirectedAt: number;
};

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

let pendingReturnCheck: RedirectTracker | null = null;

async function checkReturnedAfterRedirect(): Promise<{ returned: boolean; fromUrl?: string }> {
  const tracker = pendingReturnCheck || await storageGet<RedirectTracker>(REDIRECT_TRACKER_KEY);
  if (!tracker) return { returned: false };

  const ageMs = Date.now() - tracker.redirectedAt;
  if (ageMs > 5 * 60 * 1000) {
    await storageRemove(REDIRECT_TRACKER_KEY);
    pendingReturnCheck = null;
    return { returned: false };
  }

  const currentHost = location.hostname;
  const fromHost = new URL(tracker.fromUrl).hostname;
  if (currentHost === fromHost || location.href === tracker.fromUrl) {
    await storageRemove(REDIRECT_TRACKER_KEY);
    pendingReturnCheck = null;
    return { returned: true, fromUrl: tracker.fromUrl };
  }

  return { returned: false };
}

async function recordRedirect(fromUrl: string, toUrl: string): Promise<void> {
  const tracker: RedirectTracker = { fromUrl, toUrl, redirectedAt: Date.now() };
  pendingReturnCheck = tracker;
  await storageSet(REDIRECT_TRACKER_KEY, tracker);
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

function storageSet<T>(key: string, value: T): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

function storageGet<T>(key: string): Promise<T | undefined> {
  return new Promise(resolve => {
    chrome.storage.local.get([key], items => resolve(items[key] as T | undefined));
  });
}

function storageRemove(key: string): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.remove([key], () => resolve());
  });
}

// --- Overlay: Agent Action Popup (zentriert) ---

function showActionPopup(promptId: string, action: AgentAction, fallbackText?: string): void {
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
  box.id = "spark-action-overlay";
  box.style.cssText = `
    background:linear-gradient(135deg,#141825 0%,#1a1f35 100%);
    color:#e8edf5;padding:28px 32px;border-radius:16px;
    max-width:440px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5),0 0 0 1px rgba(120,160,255,0.1);
    font-family:'Segoe UI',system-ui,sans-serif;
    animation:spark-slide-up .3s ease;z-index:2147483647;
  `;

  const variant = action.ui?.variant || "binary";
  const title = action.ui?.title || "Spark Curiosity";
  const text = action.ui?.message || fallbackText || "Passt das gerade zu deinen Zielen?";
  const options = action.ui?.options?.length
    ? action.ui.options.slice(0, 6)
    : (variant === "binary" ? ["Weiter", "Zurück zum Fokus"] : ["Okay"]);
  const vertical = variant !== "binary" || options.length > 2;

  const buttonRows = options.map((opt, idx) => {
    const isSecondary = variant === "binary" && idx > 0;
    const colors = isSecondary ? "background:#331a1a;color:#f87171" : "background:#1a2540;color:#c0d8ff";
    return `<button class="spark-action-btn" data-option="${opt}" style="${colors}">${opt}</button>`;
  }).join("");

  box.innerHTML = `
    <style>
      @keyframes spark-fade-in{from{opacity:0}to{opacity:1}}
      @keyframes spark-slide-up{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      #spark-action-overlay .spark-text{font-size:17px;line-height:1.55;margin-bottom:20px;color:#d0d8e8}
      #spark-action-overlay .spark-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#5a6a8a;margin-bottom:12px;font-weight:600}
      #spark-action-overlay .spark-actions{display:${vertical ? "grid" : "flex"};gap:10px;grid-template-columns:1fr}
      #spark-action-overlay .spark-action-btn{
        width:100%;padding:12px 16px;border:none;border-radius:10px;
        font-size:15px;font-weight:600;cursor:pointer;
        transition:transform .15s,box-shadow .15s;
      }
      #spark-action-overlay .spark-action-btn:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(0,0,0,0.3)}
      #spark-action-overlay .spark-action-btn:active{transform:translateY(0)}
    </style>
    <div class="spark-label">${title}</div>
    <div class="spark-text">${text}</div>
    <div class="spark-actions">${buttonRows}</div>
  `;

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  box.querySelectorAll(".spark-action-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const selectedOption = (btn as HTMLElement).dataset.option || "";
      const response = await bridge("/interaction-feedback", "POST", {
        promptId,
        selectedOption,
        timestamp: new Date().toISOString()
      });
      if (response.ok) {
        const payload = response.json as InteractionFeedbackResponse;
        await logClient("info", "interaction_feedback_ok", { selectedOption, payload });
        if (payload.redirectUrl) location.href = payload.redirectUrl;
      } else {
        await logClient("error", "interaction_feedback_failed", { selectedOption, status: response.status });
      }
      overlayOpen = false;
      backdrop.remove();
    });
  });
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

function showRedirectReviewPopup(question: string, options: string[], platform: "youtube" | "x" | "other", fromUrl?: string): void {
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
    max-width:480px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5),0 0 0 1px rgba(80,160,255,0.15);
    font-family:'Segoe UI',system-ui,sans-serif;animation:spark-slide-up .3s ease;
  `;

  const buttonsHtml = options.map((opt) =>
    `<button class="spark-review-btn" data-option="${opt}" style="
      display:block;width:100%;padding:12px;margin-bottom:8px;border:none;border-radius:10px;
      font-size:14px;font-weight:600;cursor:pointer;background:#1a2540;color:#b8d4ff;transition:transform .15s;
    ">${opt}</button>`
  ).join("");

  box.innerHTML = `
    <style>
      .spark-review-btn:hover{transform:translateY(-1px)}
      .spark-review-btn:active{transform:translateY(0)}
    </style>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#5a6a8a;margin-bottom:12px;font-weight:600">Spark Curiosity — Redirect Review</div>
    <div style="font-size:17px;line-height:1.55;margin-bottom:20px;color:#d0d8e8">${question}</div>
    ${buttonsHtml}
  `;

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  box.querySelectorAll(".spark-review-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const selected = (btn as HTMLElement).dataset.option || "";
      const payload: RedirectReviewEvent = { platform, selectedOption: selected, fromUrl, timestamp: new Date().toISOString() };
      await bridge("/redirect-review", "POST", payload);
      overlayOpen = false;
      backdrop.remove();
    });
  });
}

async function consumePendingRedirectReview(): Promise<PendingRedirectReview | null> {
  const pending = await storageGet<PendingRedirectReview>(PENDING_REVIEW_KEY);
  if (!pending) return null;
  await storageRemove(PENDING_REVIEW_KEY);
  const ageMs = Date.now() - new Date(pending.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) return null;
  return pending;
}

async function maybeShowPendingRedirectReview(): Promise<void> {
  const pending = await consumePendingRedirectReview();
  if (!pending) return;
  setTimeout(() => {
    showRedirectReviewPopup(pending.question, pending.options, pending.platform, pending.fromUrl);
  }, 1200);
}

// --- Onboarding ---

const ONBOARDING_SHOWN_KEY = "spark_onboarding_shown";

async function checkAndShowOnboarding(): Promise<void> {
  const alreadyShown = await storageGet<boolean>(ONBOARDING_SHOWN_KEY);
  if (alreadyShown) return;

  const statusResp = await bridge("/onboarding/status", "GET");
  if (!statusResp.ok) return;
  const status = statusResp.json as { onboardingComplete: boolean };
  if (status.onboardingComplete) {
    await storageSet(ONBOARDING_SHOWN_KEY, true);
    return;
  }

  const templatesResp = await bridge("/onboarding/templates", "GET");
  if (!templatesResp.ok) return;
  const { templates } = templatesResp.json as { templates: Array<{ id: string; name: string; description: string; highlights?: string[] }> };
  if (!templates?.length) return;

  showOnboardingOverlay(templates);
}

function showOnboardingOverlay(templates: Array<{ id: string; name: string; description: string; highlights?: string[] }>): void {
  if (document.getElementById("spark-onboarding-backdrop")) return;

  const backdrop = document.createElement("div");
  backdrop.id = "spark-onboarding-backdrop";
  backdrop.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);
    z-index:2147483646;display:flex;align-items:center;justify-content:center;
    animation:spark-fade-in .3s ease;
  `;

  const box = document.createElement("div");
  box.style.cssText = `
    background:linear-gradient(135deg,#0d1225 0%,#141c35 100%);
    color:#e8edf5;padding:32px 36px;border-radius:18px;
    max-width:520px;width:92%;box-shadow:0 24px 60px rgba(0,0,0,0.6),0 0 0 1px rgba(120,160,255,0.1);
    font-family:'Segoe UI',system-ui,sans-serif;
    animation:spark-slide-up .35s ease;
  `;

  const templateCards = templates.map(t => {
    const highlightsHtml = (t.highlights?.length)
      ? `<ul style="margin:8px 0 0 0;padding-left:18px;font-size:12px;color:#6a7a9a;line-height:1.5">${t.highlights.map(h => `<li>${h}</li>`).join("")}</ul>`
      : "";
    return `
    <button class="spark-template-card" data-id="${t.id}" style="
      display:block;width:100%;text-align:left;padding:14px 16px;margin-bottom:10px;
      background:#1a2545;border:2px solid #2a3a5a;border-radius:12px;cursor:pointer;
      transition:border-color .2s,transform .15s;color:#d0d8e8;font-family:inherit;
    ">
      <div style="font-size:16px;font-weight:700;color:#7eb8ff;margin-bottom:4px">${t.name}</div>
      <div style="font-size:13px;color:#8a9aba;line-height:1.4">${t.description}</div>
      ${highlightsHtml}
    </button>
  `;
  }).join("");

  box.innerHTML = `
    <style>
      @keyframes spark-fade-in{from{opacity:0}to{opacity:1}}
      @keyframes spark-slide-up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
      .spark-template-card:hover{border-color:#4a6a9a !important;transform:translateY(-2px) !important}
      .spark-template-card.selected{border-color:#34d399 !important;background:#0d2520 !important}
    </style>
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#5a6a8a;margin-bottom:8px;font-weight:600">Spark Curiosity</div>
    <div style="font-size:22px;font-weight:700;color:#fff;margin-bottom:6px">Willkommen!</div>
    <div style="font-size:14px;color:#7a8aaa;margin-bottom:12px;line-height:1.5">
      Choose a template for better out-of-the-box performance. You will alter the agent's behavior over time.
    </div>
    <div id="spark-template-list">${templateCards}</div>
    <div style="margin-top:14px">
      <div style="font-size:13px;color:#5a6a8a;margin-bottom:6px">Eigene Anmerkungen (optional):</div>
      <textarea id="spark-onboarding-notes" placeholder="z.B. Ich interessiere mich fuer AI und Robotics, will weniger YouTube Shorts..." style="
        width:100%;height:60px;background:#0d1225;border:1px solid #2a3a5a;border-radius:8px;
        padding:10px;color:#d0d8e8;font-size:13px;resize:vertical;font-family:inherit;outline:none;
        box-sizing:border-box;
      "></textarea>
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button id="spark-onboarding-go" disabled style="
        flex:1;padding:12px;border:none;border-radius:10px;font-size:15px;font-weight:700;
        cursor:pointer;background:#1a3040;color:#4a6a8a;transition:background .2s,color .2s;
      ">Profil auswaehlen</button>
      <button id="spark-onboarding-skip" style="
        padding:12px 16px;border:none;border-radius:10px;font-size:13px;
        cursor:pointer;background:#1a1a25;color:#5a6a8a;transition:color .2s;
      ">Ueberspringen</button>
    </div>
  `;

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  let selectedTemplate = "";

  box.querySelectorAll(".spark-template-card").forEach(card => {
    card.addEventListener("click", () => {
      box.querySelectorAll(".spark-template-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedTemplate = (card as HTMLElement).dataset.id || "";
      const goBtn = box.querySelector("#spark-onboarding-go") as HTMLButtonElement;
      goBtn.disabled = false;
      goBtn.style.background = "#0d3320";
      goBtn.style.color = "#34d399";
    });
  });

  box.querySelector("#spark-onboarding-go")!.addEventListener("click", async () => {
    if (!selectedTemplate) return;
    const notes = (box.querySelector("#spark-onboarding-notes") as HTMLTextAreaElement).value.trim();
    await bridge("/onboarding/select", "POST", { templateId: selectedTemplate, customNotes: notes || undefined });
    await storageSet(ONBOARDING_SHOWN_KEY, true);
    backdrop.remove();
    await logClient("info", "onboarding_complete", { templateId: selectedTemplate, hasNotes: Boolean(notes) });
  });

  box.querySelector("#spark-onboarding-skip")!.addEventListener("click", async () => {
    await bridge("/onboarding/skip", "POST", {});
    await storageSet(ONBOARDING_SHOWN_KEY, true);
    backdrop.remove();
    await logClient("info", "onboarding_skipped");
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

// --- Event Sending ---

async function sendEvent(reason: string): Promise<void> {
  const event = collectEvent();

  const returnCheck = await checkReturnedAfterRedirect();
  if (returnCheck.returned) {
    event.returnedAfterRedirect = true;
    event.redirectedFromUrl = returnCheck.fromUrl;
  }

  console.log("[spark] sendEvent", reason, event.platform, event.url, returnCheck.returned ? "(returned after redirect)" : "");
  await logClient("info", "event_send", { reason, platform: event.platform, url: event.url, contentMode: event.contentMode, returnedAfterRedirect: returnCheck.returned });
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

  const action = decision.action;

  if ((action?.type === "redirect" || decision.redirectImmediately) && (action?.redirectUrl || decision.redirectUrl)) {
    const target = action?.redirectUrl || decision.redirectUrl!;
    await recordRedirect(event.url, target);
    if (decision.postRedirectReview?.question && decision.postRedirectReview.options?.length) {
      await storageSet(PENDING_REVIEW_KEY, {
        question: decision.postRedirectReview.question,
        options: decision.postRedirectReview.options,
        platform: event.platform,
        fromUrl: decision.postRedirectReview.fromUrl || event.url,
        createdAt: new Date().toISOString()
      } satisfies PendingRedirectReview);
    }
    await logClient("info", "redirect_immediate", { from: event.url, to: target, reason: decision.reason, actionType: action?.type || "legacy" });
    location.href = target;
    return;
  }

  if ((action?.type === "popup" || action?.type === "popup_then_redirect") && decision.promptId) {
    console.log("[spark] showing agent action popup", action.type, action.ui?.variant || "binary");
    showActionPopup(decision.promptId, action, decision.promptText);
    return;
  }

  if (decision.goalQuestion && decision.goalOptions?.length) {
    // Legacy fallback path
    showGoalPopup(
      decision.promptId || `goal-${Date.now()}`,
      decision.goalQuestion,
      decision.goalOptions,
      event.platform
    );
    return;
  }

  if (decision.shouldPrompt && decision.promptId && decision.promptText) {
    // Legacy fallback for older companion responses
    showActionPopup(decision.promptId, {
      type: "popup",
      redirectUrl: decision.redirectUrl,
      ui: { variant: "binary", message: decision.promptText, options: ["Weiter", "Zurück zum Fokus"] }
    }, decision.promptText);
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
void maybeShowPendingRedirectReview();

setTimeout(() => {
  void checkAndShowOnboarding();
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
  if (!document.hidden) void sendEvent("heartbeat");
}, 20000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void sendEvent("visibility");
});
