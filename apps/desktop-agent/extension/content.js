/**
 * Extracts a small, stable snapshot of *what* the user is viewing in the tab
 * (post text, video title, path kind). Sent to the companion via background → POST /extension/page.
 * Debounced — SPAs (X, YouTube) mutate the DOM heavily.
 */
(function () {
  const DEBOUNCE_MS = 450;
  let timer = null;
  let lastSent = "";

  function extract() {
    const url = location.href;
    if (!url.startsWith("http")) return null;

    const documentTitle = (document.title || "").trim().slice(0, 500);
    const host = location.hostname.replace(/^www\./, "");
    const path = location.pathname || "/";

    let pathKind = "other";
    let contentLabel = "";

    /** X / Twitter */
    if (host === "x.com" || host === "twitter.com") {
      if (/\/status\//.test(path)) {
        pathKind = "post";
        const nodes = document.querySelectorAll('[data-testid="tweetText"]');
        if (nodes.length) {
          contentLabel = (nodes[0].innerText || "").trim().slice(0, 320);
        }
      } else if (path === "/" || path === "/home") pathKind = "feed";
      else if (path.includes("/compose")) pathKind = "compose";
      else if (/\/i\/status\//.test(path)) pathKind = "post";
    }
    /** YouTube */
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "www.youtube.com") {
      if (path.startsWith("/shorts/")) {
        pathKind = "shorts";
        const h =
          document.querySelector("h2.ytd-reel-video-renderer-title yt-formatted-string") ||
          document.querySelector("ytd-reel-video-renderer h2") ||
          document.querySelector("#title h2");
        if (h) contentLabel = (h.innerText || "").trim().slice(0, 200);
      } else if (path === "/watch" || location.search.includes("v=")) {
        pathKind = "video";
        const h =
          document.querySelector("h1 yt-formatted-string") ||
          document.querySelector("h1.ytd-watch-metadata-title") ||
          document.querySelector("ytd-watch-metadata h1") ||
          document.querySelector("#title h1");
        if (h) contentLabel = (h.innerText || "").trim().slice(0, 200);
        if (!contentLabel) {
          const og = document.querySelector('meta[property="og:title"]');
          const t = og && og.getAttribute("content");
          if (t) contentLabel = t.replace(/\s*-\s*YouTube\s*$/i, "").trim().slice(0, 200);
        }
      } else if (path.startsWith("/results")) pathKind = "search";
      else if (["/feed", "/subscriptions", "/feed/trending"].some((p) => path.startsWith(p))) pathKind = "feed";
    }
    /** Instagram */
    else if (host.includes("instagram.com")) {
      if (/\/p\//.test(path) || /\/reel\//.test(path)) {
        pathKind = /\/reel\//.test(path) ? "video" : "post";
        const h = document.querySelector("h1 span") || document.querySelector("article span");
        if (h) contentLabel = (h.innerText || "").trim().slice(0, 240);
      } else if (path.includes("/stories/")) pathKind = "other";
    }
    /** Reddit */
    else if (host.includes("reddit.com")) {
      if (/\/comments\//.test(path)) {
        pathKind = "post";
        const h = document.querySelector('[slot="title"]') || document.querySelector("h1");
        if (h) contentLabel = (h.innerText || "").trim().slice(0, 300);
      } else if (path === "/" || /^\/r\/[^/]+\/?$/.test(path)) pathKind = "feed";
    }

    return {
      url,
      documentTitle: documentTitle || undefined,
      contentLabel: contentLabel || undefined,
      pathKind
    };
  }

  function send() {
    const payload = extract();
    if (!payload) return;
    const sig = JSON.stringify(payload);
    if (sig === lastSent) return;
    lastSent = sig;
    try {
      chrome.runtime.sendMessage({ type: "sparkPageContext", payload });
    } catch (_) {}
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(send, DEBOUNCE_MS);
  }

  schedule();
  const host = location.hostname.replace(/^www\./, "");
  const needsDomObserver =
    host === "x.com" || host === "twitter.com" ||
    host.endsWith("youtube.com") || host === "youtu.be" ||
    host.includes("instagram.com") || host.includes("reddit.com");

  if (needsDomObserver) {
    const obs = new MutationObserver(schedule);
    try {
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    } catch (_) {}
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      lastSent = "";
      schedule();
    }
  }, 1500);
})();
