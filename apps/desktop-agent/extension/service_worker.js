const COMPANION = "http://127.0.0.1:4343";

async function postPageContext(body) {
  try {
    await fetch(`${COMPANION}/extension/page`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "sparkPageContext" || !msg.payload) return;
  const tabUrl = sender.tab?.url;
  const u = typeof tabUrl === "string" && tabUrl.startsWith("http") ? tabUrl : msg.payload.url;
  if (!u || !u.startsWith("http")) return;
  void postPageContext({ ...msg.payload, url: u });
});

// Debounce: don't handle the same tab twice within 3 seconds
const handled = new Map();
function wasHandledRecently(tabId) {
  const now = Date.now();
  if (handled.has(tabId) && now - handled.get(tabId) < 3000) return true;
  handled.set(tabId, now);
  for (const [k, v] of handled) { if (now - v > 10000) handled.delete(k); }
  return false;
}

async function decideForUrl(url) {
  try {
    const res = await fetch(`${COMPANION}/extension/decide?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn("[spark] companion unreachable:", e.message);
    return null;
  }
}

async function handleTab(tabId, url) {
  if (!url || !url.startsWith("http")) return;
  if (wasHandledRecently(tabId)) return;
  // Ping first so companion knows extension is active BEFORE desktop agent polls
  await ping(url);
  const decision = await decideForUrl(url);
  if (!decision || decision.action !== "close") return;
  if (decision.openUrl) {
    try { await chrome.tabs.create({ url: decision.openUrl }); }
    catch (e) { console.warn("[spark] failed to open curated tab:", e.message); }
  }
  try { await chrome.tabs.remove(tabId); }
  catch (e) { console.warn("[spark] failed to close tab:", e.message); }
}

// All three events catch different navigation types:
// onBeforeNavigate: earliest, fires before page loads
// onCommitted: URL bar updates (backup)
// onHistoryStateUpdated: SPA navigations (YouTube, etc.)
// Debounce prevents duplicate handling.
function onNavigate(details) {
  if (details?.url && details.frameId === 0) {
    void handleTab(details.tabId, details.url);
  }
}
chrome.webNavigation.onBeforeNavigate.addListener(onNavigate);
chrome.webNavigation.onCommitted.addListener(onNavigate);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigate);

// Keepalive: ping companion so it knows the extension is active
async function ping(url) {
  try {
    await fetch(`${COMPANION}/extension/ping`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url || "" })
    });
  } catch { /* companion offline */ }
}

chrome.runtime.onInstalled.addListener(() => void ping(""));
chrome.runtime.onStartup.addListener(() => void ping(""));
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.url) void ping(tab.url);
  } catch { /* ignore */ }
});
setInterval(() => void ping("keepalive"), 60000);
