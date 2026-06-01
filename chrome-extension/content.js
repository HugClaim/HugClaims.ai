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

function imageHintsFromNode(node) {
  const imgs = Array.from(node.querySelectorAll("img"));
  if (!imgs.length) return [];
  const hints = [];
  for (const img of imgs) {
    const alt = normalizeText(img.getAttribute("alt") || "");
    const aria = normalizeText(img.getAttribute("aria-label") || "");
    let src = String(img.getAttribute("src") || "").trim();
    if (src.startsWith("data:")) src = "[inline-image]";
    const srcHint = src ? src.slice(0, 120) : "";
    const parts = [alt, aria, srcHint].filter(Boolean);
    const line = parts.join(" | ").slice(0, 220);
    if (line) hints.push(line);
  }
  return Array.from(new Set(hints)).slice(0, 5);
}

function textWithImageHints(node) {
  const text = normalizeText(node.innerText || node.textContent || "");
  const hints = imageHintsFromNode(node);
  if (!hints.length) return text;
  const mediaLines = hints.map((h) => `[IMAGE] ${h}`).join("\n");
  return normalizeText(`${text}\n${mediaLines}`);
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
      const text = textWithImageHints(node);
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

function collectImageElements(limit = 4) {
  const selectors = [
    "[data-message-author-role] img",
    "[data-testid*='conversation-turn'] img",
    "[data-testid*='message'] img",
    "main article img",
    "article img"
  ];
  const seen = new Set();
  const out = [];
  for (const selector of selectors) {
    const imgs = Array.from(document.querySelectorAll(selector));
    for (const img of imgs) {
      const src = String(img.currentSrc || img.getAttribute("src") || "").trim();
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push(img);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("file-read-failed"));
    reader.readAsDataURL(blob);
  });
}

async function compressBlob(blob) {
  try {
    if (!blob.type.startsWith("image/")) return blob;
    const bmp = await createImageBitmap(blob);
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bmp, 0, 0, w, h);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return out || blob;
  } catch (_err) {
    return blob;
  }
}

async function imageToEvidence(img) {
  const rawSrc = String(img.currentSrc || img.getAttribute("src") || "").trim();
  if (!rawSrc) return null;
  const alt = normalizeText(img.getAttribute("alt") || "");
  const source_url = rawSrc.startsWith("data:") ? "[inline-image]" : rawSrc.slice(0, 300);
  try {
    let blob;
    if (rawSrc.startsWith("data:")) {
      const res = await fetch(rawSrc);
      blob = await res.blob();
    } else {
      const res = await fetch(rawSrc, { credentials: "include" });
      if (!res.ok) return null;
      blob = await res.blob();
    }
    if (!blob || blob.size <= 0) return null;
    if (blob.size > 1.6 * 1024 * 1024) {
      blob = await compressBlob(blob);
    }
    if (blob.size > 2.2 * 1024 * 1024) return null;
    const data_url = await blobToDataUrl(blob);
    if (!data_url.startsWith("data:")) return null;
    return {
      data_url,
      alt,
      source_url,
      mime_type: blob.type || "",
      width: Number(img.naturalWidth || 0),
      height: Number(img.naturalHeight || 0)
    };
  } catch (_err) {
    return null;
  }
}

async function collectImageEvidence(limit = 4) {
  const imgs = collectImageElements(limit);
  const out = [];
  for (const img of imgs) {
    const ev = await imageToEvidence(img);
    if (ev) out.push(ev);
  }
  return out;
}

const autoState = {
  sessionId: `auto-${Math.random().toString(36).slice(2, 10)}`,
  checking: false,
  lastCheckAt: 0,
  lastFingerprint: "",
  dismissedFingerprints: new Set()
};

function isContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (_err) {
    return false;
  }
}

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
      width: min(320px, calc(100vw - 24px));
      z-index: 2147483647;
      border: 1px solid #d3c8da;
      border-radius: 12px;
      background: #fffdf8;
      color: #1a1612;
      box-shadow: 0 16px 42px -28px rgba(52, 34, 88, 0.42);
      font: 13px/1.45 "Avenir Next", "Segoe UI", sans-serif;
      padding: 10px;
    }
    .hug-auto-signal .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .hug-auto-signal h4 {
      margin: 0;
      font-size: 14px;
      color: #241b3d;
    }
    .hug-auto-signal .close-btn {
      border: 0;
      background: transparent;
      color: #6d6482;
      font-size: 16px;
      line-height: 1;
      padding: 0 4px;
      cursor: pointer;
    }
    .hug-auto-signal p {
      margin: 6px 0;
      color: #5f5868;
    }
    .hug-auto-signal .summary {
      margin: 7px 0;
      color: #3f3657;
      font-size: 12px;
      line-height: 1.35;
    }
    .hug-auto-signal .meta-row {
      display: flex;
      gap: 8px;
      margin: 6px 0 8px;
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
      display: grid;
      gap: 6px;
    }
    .hug-auto-signal button {
      border: 1px solid #d3c8da;
      border-radius: 8px;
      background: linear-gradient(135deg, rgba(255, 253, 248, 0.96), rgba(239, 231, 252, 0.9));
      background-size: 180% 180%;
      background-position: 0% 50%;
      padding: 7px 10px;
      cursor: pointer;
      font: inherit;
      color: #322a45;
      text-align: left;
      transition: transform 0.16s, box-shadow 0.2s ease, background-position 0.25s ease;
    }
    .hug-auto-signal button:hover {
      transform: translateY(-1px);
      background-position: 100% 50%;
      box-shadow: 0 8px 18px rgba(52, 34, 88, 0.14);
    }
    .hug-auto-signal button:active {
      transform: translateY(0);
    }
    .hug-auto-signal button.secondary {
      color: #5a516d;
      background: linear-gradient(135deg, #faf7ff 0%, #efe8fb 100%);
    }
    .hug-auto-signal .primary {
      border-color: #635bff;
      background: linear-gradient(135deg, #635bff 0%, #7f78ff 48%, #5f53f7 100%);
      background-size: 180% 180%;
      background-position: 0% 50%;
      color: #fff;
      box-shadow: 0 10px 20px rgba(81, 70, 226, 0.28);
    }
    .hug-auto-signal .primary:hover {
      background-position: 100% 50%;
      box-shadow: 0 14px 26px rgba(81, 70, 226, 0.34);
    }
    .hug-auto-signal .note {
      margin-top: 6px;
      color: #6a6280;
      font-size: 11px;
      line-height: 1.35;
    }
  `;
  document.documentElement.appendChild(style);
}

async function storageGet(keys) {
  if (!isContextValid()) return {};
  try {
    return await chrome.storage.local.get(keys);
  } catch (_err) {
    return {};
  }
}

async function apiCall(path, body, backendUrl) {
  if (!isContextValid()) {
    throw new Error("Extension context invalidated");
  }
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({
      type: "HUG_API_CALL",
      backend_url: backendUrl,
      path,
      method: "POST",
      body
    });
  } catch (err) {
    throw new Error(String((err && err.message) || err || "API call failed"));
  }
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
  const conf = Math.round((Number(data.confidence) || 0) * 100);
  const box = document.createElement("section");
  box.id = "hug-auto-signal";
  box.className = "hug-auto-signal";
  box.innerHTML = `
    <div class="title-row">
      <h4>Possible AI Mistake</h4>
      <button class="close-btn" data-act="dismiss" aria-label="Dismiss">×</button>
    </div>
    <div class="summary">${(data.summary || "Likely assistant failure detected.").replace(/</g, "&lt;")}</div>
    <div class="meta-row">
      <span class="pill">Cashback: $${offer}</span>
      <span class="pill">Confidence: ${conf}%</span>
    </div>
    <div class="actions">
      <button class="primary" data-act="log">Claim cashback ($${offer})</button>
      <button class="secondary" data-act="donate">Donate transcript (no payout)</button>
    </div>
    <div class="note">Donating helps improve model quality analysis but does not issue credits.</div>
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
        box.innerHTML = `<h4>Claim Submitted</h4><p>$${claim.credit_amount} cashback (${claim.claim_id})</p>`;
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
        box.innerHTML = "<h4>Donated</h4><p>Transcript received for quality analysis. No payout was issued.</p>";
      } else {
        autoState.dismissedFingerprints.add(fp);
        box.remove();
      }
    } catch (_err) {
      box.innerHTML = "<h4>Action failed</h4><p>Could not reach HugClaims.ai backend.</p>";
    }
  });
}

async function maybeAutoSignal() {
  if (autoState.checking) return;
  const now = Date.now();
  if (now - autoState.lastCheckAt < 30000) return;
  autoState.checking = true;
  autoState.lastCheckAt = now;
  try {
    const cfg = await storageGet(["hug_backend_url", "hug_auto_detect_enabled"]);
    const autoEnabled = cfg.hug_auto_detect_enabled !== false;
    if (!autoEnabled) return;

    const transcript = extractTranscript();
    if (!transcript || transcript.length < 280) return;
    const fp = fingerprint(transcript);
    if (fp === autoState.lastFingerprint || autoState.dismissedFingerprints.has(fp)) return;

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
  const scheduleAutoSignal = () => {
    maybeAutoSignal().catch(() => {
      // Ignore stale-context failures after extension reload/update.
    });
  };
  setTimeout(scheduleAutoSignal, 4500);
  setInterval(scheduleAutoSignal, 45000);

  let debounceTimer = null;
  const obs = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scheduleAutoSignal, 5000);
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "HUG_CAPTURE_TRANSCRIPT") {
    return;
  }

  (async () => {
    try {
      const transcript = extractTranscript();
      const images = await collectImageEvidence(4);
      sendResponse({
        ok: true,
        transcript,
        images,
        source_ai: inferSource()
      });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true;
});

startAutoSignalLoop();
