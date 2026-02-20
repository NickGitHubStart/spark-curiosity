type CompanionRequest = {
  type: "spark_companion_request";
  path: string;
  method: "GET" | "POST";
  body?: unknown;
};

const COMPANION_URL = "http://localhost:4343";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Spark Curiosity extension installed");
});

chrome.runtime.onMessage.addListener((message: CompanionRequest, _sender, sendResponse) => {
  if (!message || message.type !== "spark_companion_request") {
    return false;
  }

  void (async () => {
    try {
      const response = await fetch(`${COMPANION_URL}${message.path}`, {
        method: message.method,
        headers: { "content-type": "application/json" },
        body: message.body ? JSON.stringify(message.body) : undefined
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }
      sendResponse({
        ok: response.ok,
        status: response.status,
        json
      });
    } catch (error) {
      sendResponse({
        ok: false,
        status: 0,
        json: { error: String(error) }
      });
    }
  })();

  return true;
});
