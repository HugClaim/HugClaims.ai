chrome.runtime.onInstalled.addListener(() => {
  // Reserved for future background tasks (badge updates, queued retry, etc.).
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "HUG_API_CALL") {
    return;
  }

  (async () => {
    try {
      const backend = String(msg.backend_url || "http://127.0.0.1:8000").replace(/\/$/, "");
      const path = String(msg.path || "");
      const method = String(msg.method || "POST").toUpperCase();
      const body = msg.body || {};
      const resp = await fetch(`${backend}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" ? undefined : JSON.stringify(body)
      });
      const text = await resp.text();
      sendResponse({
        ok: resp.ok,
        status: resp.status,
        content_type: resp.headers.get("content-type") || "",
        text
      });
    } catch (err) {
      sendResponse({
        ok: false,
        status: 0,
        text: String((err && err.message) || err || "request failed")
      });
    }
  })();

  return true;
});
