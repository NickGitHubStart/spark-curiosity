const COMPANION = "http://127.0.0.1:4343";

async function decideForUrl(url) {
  try {
    const res = await fetch(`${COMPANION}/extension/decide?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function handleTab(tabId, url) {
  if (!url || !url.startsWith("http")) return;
  const decision = await decideForUrl(url);
  if (!decision || decision.action !== "close") return;
  if (decision.openUrl) {
    try { await chrome.tabs.create({ url: decision.openUrl }); } catch { /* ignore */ }
  }
  try { await chrome.tabs.remove(tabId); } catch { /* ignore */ }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url) {
    void handleTab(tabId, tab.url);
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details?.url && details.frameId === 0) {
    void handleTab(details.tabId, details.url);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details?.url && details.frameId === 0) {
    void handleTab(details.tabId, details.url);
  }
});
