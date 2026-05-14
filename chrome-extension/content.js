function normalizeText(text) {
  return (text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferSource() {
  const host = location.hostname;
  if (host.includes("chatgpt") || host.includes("openai")) {
    return "ChatGPT";
  }
  if (host.includes("claude")) {
    return "Claude";
  }
  if (host.includes("gemini")) {
    return "Gemini";
  }
  if (host.includes("copilot")) {
    return "Copilot";
  }
  return "Other/Unknown";
}

function sourceSpeakerLabel(source) {
  if (source === "ChatGPT") return "CHATGPT";
  if (source === "Claude") return "CLAUDE";
  if (source === "Gemini") return "GEMINI";
  if (source === "Copilot") return "COPILOT";
  return "LLM";
}

function inferRoleFromNode(node) {
  const attrRole = (node.getAttribute("data-message-author-role") || "").toLowerCase();
  if (attrRole.includes("user") || attrRole.includes("human")) return "user";
  if (attrRole.includes("assistant") || attrRole.includes("model")) return "assistant";

  const hints = [
    node.getAttribute("data-testid") || "",
    node.getAttribute("aria-label") || "",
    node.className || "",
    node.id || ""
  ].join(" ").toLowerCase();

  if (/(^|[^a-z])(user|human|you)([^a-z]|$)/.test(hints)) return "user";
  if (/(assistant|model|bot|ai|claude|gemini|copilot|chatgpt)/.test(hints)) return "assistant";

  const firstLine = normalizeText((node.innerText || node.textContent || "").split("\n")[0] || "").toLowerCase();
  if (firstLine === "you" || firstLine === "user") return "user";
  if (/(assistant|chatgpt|claude|gemini|copilot)/.test(firstLine)) return "assistant";

  return "assistant";
}

function collectTurnNodes() {
  const selectors = [
    "[data-message-author-role]",
    "[data-testid*='conversation-turn']",
    "[data-testid*='message']",
    "[role='listitem'] article",
    "[role='listitem']",
    "main article",
    "article"
  ];

  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector));
    if (nodes.length < 2) continue;

    const turns = [];
    const seen = new Set();
    for (const node of nodes) {
      const text = normalizeText(node.innerText || node.textContent || "");
      if (!text || text.length < 8) continue;
      const key = `${inferRoleFromNode(node)}::${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      turns.push({ role: inferRoleFromNode(node), text });
    }
    if (turns.length >= 2) {
      return turns;
    }
  }
  return [];
}

function collectFallbackText() {
  const candidates = [
    document.querySelector("main"),
    document.querySelector("[role='main']"),
    document.querySelector("article"),
    document.body
  ].filter(Boolean);

  let best = "";
  for (const node of candidates) {
    const text = normalizeText(node.innerText || node.textContent || "");
    if (text.length > best.length) best = text;
  }
  return best;
}

function formatTurns(turns, source) {
  const model = sourceSpeakerLabel(source);
  const lines = [];
  for (const turn of turns) {
    const speaker = turn.role === "user" ? "USER" : model;
    lines.push(`${speaker}:\n${turn.text}`);
  }
  return normalizeText(lines.join("\n\n"));
}

function extractTranscript() {
  const source = inferSource();
  const turns = collectTurnNodes();
  if (turns.length) {
    return formatTurns(turns, source).slice(0, 50000);
  }

  const fallback = collectFallbackText();
  if (!fallback) return "";
  const model = sourceSpeakerLabel(source);
  return normalizeText(`USER:\n[not reliably detected]\n\n${model}:\n${fallback}`).slice(0, 50000);
}

const autoState = {
  sessionId: `auto-${Math.random().toString(36).slice(2, 10)}`,
  checking: false,
  lastCheckAt: 0,
  lastFingerprint: "",
  dismissedFingerprints: new Set()
};

function fingerprint(text) {
  const tail = (text || "").slice(-180);
  return `${(text || "").length}:${tail}`;
}

function ensureSignalStyles() {
  if (document.getElementById("hug-auto-signal-style")) return;
  const style = document.createElement("style");
  style.id = "hug-auto-signal-style";
  style.textContent = `
    .hug-auto-signal {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: min(360px, calc(100vw - 24px));
      z-index: 2147483647;
      border: 1px solid #d3c8da;
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(255, 253, 248, 0.96), rgba(248, 243, 255, 0.9));
      color: #1a1612;
      box-shadow: 0 24px 60px -24px rgba(52, 34, 88, 0.5);
      font: 13px/1.45 "Avenir Next", "Segoe UI", sans-serif;
      padding: 12px;
    }
    .hug-auto-signal h4 {
      margin: 0;
      font-size: 15px;
      color: #241b3d;
    }
    .hug-auto-signal p {
      margin: 6px 0 8px;
      color: #5f5868;
    }
    .hug-auto-signal .meta {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .hug-auto-signal .pill {
      border: 1px solid #d3c8da;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      color: #5f5868;
      background: #e5ddee;
    }
    .hug-auto-signal .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .hug-auto-signal button {
      border: 1px solid #d3c8da;
      border-radius: 999px;
      background: rgba(255, 253, 248, 0.92);
      padding: 6px 10px;
      cursor: pointer;
      font: inherit;
      color: #322a45;
    }
    .hug-auto-signal .primary {
      border-color: #635bff;
      background: linear-gradient(135deg, #635bff, #7f78ff);
      color: #fff;
    }
  `;
  document.documentElement.appendChild(style);
}

async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

async function apiCall(path, body, backendUrl) {
  const resp = await chrome.runtime.sendMessage({
    type: "HUG_API_CALL",
    backend_url: backendUrl,
    path,
    method: "POST",
    body
  });
  if (!resp || !resp.ok) {
    throw new Error((resp && resp.text) || `API call failed (${(resp && resp.status) || 0})`);
  }
  const ct = String(resp.content_type || "").toLowerCase();
  if (!ct.includes("application/json")) {
    throw new Error("API returned non-JSON response.");
  }
  return JSON.parse(resp.text || "{}");
}

function removeExistingPrompt() {
  const prev = document.getElementById("hug-auto-signal");
  if (prev) prev.remove();
}

function showPrompt(data, transcript, backendUrl, source, fp) {
  ensureSignalStyles();
  removeExistingPrompt();

  const offer = Number(data.cashback_offer || 0);
  const difficulty = Number(data.difficulty || 1);
  const conf = Math.round((Number(data.confidence) || 0) * 100);
  const box = document.createElement("section");
  box.id = "hug-auto-signal";
  box.className = "hug-auto-signal";
  box.innerHTML = `
    <h4>Potential LLM Failure Detected</h4>
    <p>${(data.summary || "Likely assistant failure detected.").replace(/</g, "&lt;")}</p>
    <div class="meta">
      <span class="pill">Cash back: $${offer}</span>
      <span class="pill">Difficulty: ${difficulty}/5</span>
      <span class="pill">Confidence: ${conf}%</span>
    </div>
    <div class="actions">
      <button class="primary" data-act="log">Log interaction for $${offer}</button>
      <button data-act="donate">Donate interaction</button>
      <button data-act="dismiss">Dismiss</button>
    </div>
  `;
  document.body.appendChild(box);

  box.addEventListener("click", async (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const act = target.getAttribute("data-act");
    if (!act) return;
    target.setAttribute("disabled", "true");
    try {
      if (act === "log") {
        const claim = await apiCall(
          "/submit_extension_claim",
          {
            source_ai: source,
            transcript,
            summary: data.summary || "Auto-detected likely failure",
            reasons: Array.isArray(data.reasons) ? data.reasons : [],
            severity: Number(data.difficulty || 1),
            offered_cashback: Number(data.cashback_offer || 0),
            auto_detected: true,
            user_note: "Auto-detected from extension prompt.",
            session_id: autoState.sessionId
          },
          backendUrl
        );
        box.innerHTML = `<h4>Claim Logged</h4><p>${claim.claim_id}: +$${claim.credit_amount} cash back (${claim.currency})</p>`;
      } else if (act === "donate") {
        await apiCall(
          "/event",
          {
            event_type: "auto_failure_donated",
            page: "extension-content",
            session_id: autoState.sessionId,
            payload: {
              source_ai: source,
              cashback_offer: Number(data.cashback_offer || 0),
              summary: data.summary || ""
            }
          },
          backendUrl
        );
        box.innerHTML = "<h4>Thanks</h4><p>This interaction was donated for model quality analysis.</p>";
      } else {
        autoState.dismissedFingerprints.add(fp);
        box.remove();
      }
    } catch (_err) {
      box.innerHTML = "<h4>Action failed</h4><p>Could not reach HugInsure backend.</p>";
    }
  });
}

async function maybeAutoSignal() {
  if (autoState.checking) return;
  const now = Date.now();
  if (now - autoState.lastCheckAt < 30000) return;

  const cfg = await storageGet(["hug_backend_url", "hug_auto_detect_enabled"]);
  const autoEnabled = cfg.hug_auto_detect_enabled !== false;
  if (!autoEnabled) return;

  const transcript = extractTranscript();
  if (!transcript || transcript.length < 280) return;
  const fp = fingerprint(transcript);
  if (fp === autoState.lastFingerprint || autoState.dismissedFingerprints.has(fp)) return;

  autoState.checking = true;
  autoState.lastCheckAt = now;
  try {
    const backendUrl = String(cfg.hug_backend_url || "http://127.0.0.1:8000");
    const source = inferSource();
    const signal = await apiCall(
      "/detect_failure_signal",
      {
        transcript,
        source_ai: source,
        session_id: autoState.sessionId
      },
      backendUrl
    );
    autoState.lastFingerprint = fp;
    if (!signal.detected) return;
    if (Number(signal.confidence || 0) < 0.55) return;
    showPrompt(signal, transcript, backendUrl, source, fp);
  } catch (_err) {
    // Silent in-page by design; popup still provides explicit diagnostics.
  } finally {
    autoState.checking = false;
  }
}

function startAutoSignalLoop() {
  const host = location.hostname || "";
  if (!/(chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/.test(host)) {
    return;
  }
  setTimeout(() => { maybeAutoSignal(); }, 4500);
  setInterval(() => { maybeAutoSignal(); }, 45000);

  let debounceTimer = null;
  const obs = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { maybeAutoSignal(); }, 5000);
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "HUG_CAPTURE_TRANSCRIPT") {
    return;
  }

  try {
    const transcript = extractTranscript();
    sendResponse({
      ok: true,
      transcript,
      source_ai: inferSource()
    });
  } catch (err) {
    sendResponse({ ok: false, error: String(err) });
  }
});

startAutoSignalLoop();
