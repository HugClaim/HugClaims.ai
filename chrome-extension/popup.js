const state = {
  sessionId: `ext-${Math.random().toString(36).slice(2, 10)}`,
  sourceAI: "Other/Unknown",
  extraction: null,
  redaction: null
};

const el = {
  backendUrl: document.getElementById("backendUrl"),
  autoDetectCheck: document.getElementById("autoDetectCheck"),
  captureBtn: document.getElementById("captureBtn"),
  sourceBadge: document.getElementById("sourceBadge"),
  transcript: document.getElementById("transcript"),
  userNote: document.getElementById("userNote"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  analysisSection: document.getElementById("analysisSection"),
  summary: document.getElementById("summary"),
  reasons: document.getElementById("reasons"),
  severityPill: document.getElementById("severityPill"),
  confidencePill: document.getElementById("confidencePill"),
  confirmCheck: document.getElementById("confirmCheck"),
  submitBtn: document.getElementById("submitBtn"),
  resultSection: document.getElementById("resultSection"),
  resultText: document.getElementById("resultText"),
  shareBtn: document.getElementById("shareBtn"),
  shareSection: document.getElementById("shareSection"),
  riskPill: document.getElementById("riskPill"),
  redactConfidencePill: document.getElementById("redactConfidencePill"),
  redactionEmpty: document.getElementById("redactionEmpty"),
  redactionList: document.getElementById("redactionList"),
  redactedText: document.getElementById("redactedText"),
  copyShareBtn: document.getElementById("copyShareBtn"),
  status: document.getElementById("status")
};

function setStatus(msg, kind = "") {
  el.status.textContent = msg || "";
  el.status.className = `status ${kind}`.trim();
}

function backendBase() {
  return (el.backendUrl.value || "").trim().replace(/\/$/, "");
}

function normalizeTranscriptFormatting(text) {
  const normalized = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();

  if (!normalized) return "";

  return normalized
    .replace(/^(USER|CHATGPT|CLAUDE|GEMINI|COPILOT|LLM):[ \t]+(.+)$/gm, "$1:\n$2")
    .replace(/\n{3,}/g, "\n\n");
}

async function readJsonOrThrow(resp, actionLabel) {
  const raw = String((resp && resp.text) || "");
  const contentType = String((resp && resp.content_type) || "").toLowerCase();
  if (!resp || !resp.ok) {
    const code = Number(resp && resp.status) || 0;
    const lower = raw.toLowerCase();
    if (code === 0 || lower.includes("failed to fetch") || lower.includes("networkerror")) {
      throw new Error(
        `Cannot reach backend at ${backendBase()}. Start/restart HugInsure backend on http://127.0.0.1:8000, then retry.`
      );
    }
    if (lower.includes("fetch") && lower.includes("failed")) {
      throw new Error(
        `Network request to backend failed at ${backendBase()}. Check backend URL and that the server is running.`
      );
    }
    throw new Error(`${actionLabel} failed (${code}). ${raw.slice(0, 140)}`.trim());
  }
  if (!contentType.includes("application/json")) {
    const snippet = raw.slice(0, 120).replace(/\s+/g, " ");
    if (snippet.toLowerCase().includes("<!doctype") || snippet.toLowerCase().includes("<html")) {
      throw new Error(
        `Backend URL is not the API server (${backendBase()}). It returned HTML. Start/restart HugInsure backend on http://127.0.0.1:8000.`
      );
    }
    throw new Error(`${actionLabel} returned non-JSON response.`);
  }
  return JSON.parse(raw || "{}");
}

async function apiPost(path, body, actionLabel) {
  const resp = await chrome.runtime.sendMessage({
    type: "HUG_API_CALL",
    backend_url: backendBase(),
    path,
    method: "POST",
    body
  });
  return readJsonOrThrow(resp, actionLabel);
}

async function pingBackend() {
  const resp = await chrome.runtime.sendMessage({
    type: "HUG_API_CALL",
    backend_url: backendBase(),
    path: "/",
    method: "GET"
  });
  if (!resp || !resp.ok) {
    const code = Number(resp && resp.status) || 0;
    throw new Error(
      `Backend is unreachable at ${backendBase()} (status ${code || "network"}). Start it and retry.`
    );
  }
}

async function loadSettings() {
  const data = await chrome.storage.local.get(["hug_backend_url", "hug_auto_detect_enabled"]);
  if (data.hug_backend_url) {
    el.backendUrl.value = data.hug_backend_url;
  }
  el.autoDetectCheck.checked = data.hug_auto_detect_enabled !== false;
}

async function saveSettings() {
  const url = backendBase();
  await chrome.storage.local.set({
    hug_backend_url: url,
    hug_auto_detect_enabled: !!el.autoDetectCheck.checked
  });
}

function inferSourceFromUrl(url) {
  if (!url) return "Other/Unknown";
  if (url.includes("chatgpt") || url.includes("openai")) return "ChatGPT";
  if (url.includes("claude")) return "Claude";
  if (url.includes("gemini")) return "Gemini";
  if (url.includes("copilot")) return "Copilot";
  return "Other/Unknown";
}

function isSupportedChatUrl(url) {
  if (!url) return false;
  return [
    "chat.openai.com",
    "chatgpt.com",
    "claude.ai",
    "gemini.google.com",
    "copilot.microsoft.com"
  ].some((host) => url.includes(host));
}

function updateSource(source) {
  state.sourceAI = source || "Other/Unknown";
  el.sourceBadge.textContent = `Source: ${state.sourceAI}`;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function captureFromActiveTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    throw new Error("No active tab found.");
  }
  if (!isSupportedChatUrl(tab.url || "")) {
    throw new Error("Open ChatGPT, Claude, Gemini, or Copilot tab first.");
  }

  updateSource(inferSourceFromUrl(tab.url || ""));

  let resp = null;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: "HUG_CAPTURE_TRANSCRIPT" });
  } catch (err) {
    const msg = String((err && err.message) || err || "");
    if (!msg.includes("Receiving end does not exist")) {
      throw err;
    }
    // If the content script was not attached yet (tab just opened/refreshed),
    // inject once and retry.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    resp = await chrome.tabs.sendMessage(tab.id, { type: "HUG_CAPTURE_TRANSCRIPT" });
  }

  if (!resp || !resp.ok) {
    const msg = resp && resp.error ? resp.error : "Could not capture transcript on this page.";
    throw new Error(msg);
  }

  if (resp.source_ai) {
    updateSource(resp.source_ai);
  }

  el.transcript.value = normalizeTranscriptFormatting(resp.transcript || "");
  if (!el.transcript.value) {
    throw new Error("No transcript text detected. Try manual paste.");
  }
}

function renderExtraction(data) {
  state.extraction = data;
  state.redaction = null;
  el.analysisSection.classList.remove("hidden");
  el.resultSection.classList.add("hidden");
  el.shareSection.classList.add("hidden");
  el.summary.textContent = data.summary || "No summary returned.";
  el.reasons.innerHTML = "";
  (data.reasons || []).forEach((reason) => {
    const li = document.createElement("li");
    li.textContent = reason;
    el.reasons.appendChild(li);
  });
  el.severityPill.textContent = `Severity: ${data.severity || "-"}/5`;
  const pct = Math.round((Number(data.confidence) || 0) * 100);
  el.confidencePill.textContent = `Confidence: ${pct}%`;
  el.confirmCheck.checked = false;
  el.submitBtn.disabled = true;
}

async function analyzeComplaint() {
  const transcript = normalizeTranscriptFormatting(el.transcript.value);
  if (!transcript) {
    throw new Error("Transcript is required before extraction.");
  }
  el.transcript.value = transcript;

  const data = await apiPost(
    "/extract_dissatisfaction",
    {
      transcript,
      source_ai: state.sourceAI,
      user_note: (el.userNote.value || "").trim(),
      session_id: state.sessionId
    },
    "Extraction"
  );
  renderExtraction(data);
}

async function submitClaim() {
  if (!state.extraction) {
    throw new Error("Run extraction first.");
  }

  const transcript = normalizeTranscriptFormatting(el.transcript.value);
  el.transcript.value = transcript;
  const data = await apiPost(
    "/submit_extension_claim",
    {
      source_ai: state.sourceAI,
      transcript,
      summary: state.extraction.summary,
      reasons: state.extraction.reasons || [],
      severity: state.extraction.severity || 2,
      user_note: (el.userNote.value || "").trim(),
      session_id: state.sessionId
    },
    "Submit"
  );
  el.resultSection.classList.remove("hidden");
  el.resultText.textContent = `${data.claim_id}: +${data.credit_amount} ${data.currency}. ${data.message}`;
  el.shareSection.classList.add("hidden");
}

function renderRedaction(data) {
  state.redaction = data;
  el.shareSection.classList.remove("hidden");
  el.riskPill.textContent = `Risk: ${(data.risk_level || "-").toUpperCase()}`;
  const pct = Math.round((Number(data.confidence) || 0) * 100);
  el.redactConfidencePill.textContent = `Confidence: ${pct}%`;
  el.redactedText.value = data.redacted_text || "";
  el.redactionList.innerHTML = "";
  const items = Array.isArray(data.redactions) ? data.redactions : [];
  el.redactionEmpty.classList.toggle("hidden", items.length > 0);
  items.forEach((item) => {
    const li = document.createElement("li");
    const original = (item.original || "").trim();
    const replacement = (item.replacement || "").trim() || "[REDACTED:OTHER]";
    li.innerHTML = `<del>${escapeHtml(original)}</del> \u2192 <code>${escapeHtml(replacement)}</code>`;
    el.redactionList.appendChild(li);
  });
}

async function prepareSharePreview() {
  const transcript = normalizeTranscriptFormatting(el.transcript.value);
  if (!transcript) {
    throw new Error("Transcript is required to prepare sharing.");
  }
  el.transcript.value = transcript;
  const data = await apiPost(
    "/redact_for_share",
    {
      transcript,
      source_ai: state.sourceAI,
      user_note: (el.userNote.value || "").trim(),
      session_id: state.sessionId
    },
    "Share redaction"
  );
  renderRedaction(data);
}

async function copyRedactedShare() {
  const text = (el.redactedText.value || "").trim();
  if (!text) {
    throw new Error("No redacted text available to copy.");
  }
  await navigator.clipboard.writeText(text);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

el.backendUrl.addEventListener("change", async () => {
  await saveSettings();
});
el.autoDetectCheck.addEventListener("change", async () => {
  await saveSettings();
});
el.transcript.addEventListener("blur", () => {
  el.transcript.value = normalizeTranscriptFormatting(el.transcript.value);
});

el.captureBtn.addEventListener("click", async () => {
  setStatus("Capturing transcript...");
  try {
    await captureFromActiveTab();
    setStatus("Transcript captured. Extracting dissatisfaction reasons...", "ok");
    await saveSettings();
    await analyzeComplaint();
    setStatus("Extraction ready. Confirm then submit.", "ok");
  } catch (err) {
    setStatus(String(err.message || err), "error");
  }
});

el.analyzeBtn.addEventListener("click", async () => {
  setStatus("Extracting dissatisfaction reasons...");
  try {
    await saveSettings();
    await analyzeComplaint();
    setStatus("Extraction ready. Confirm then submit.", "ok");
  } catch (err) {
    setStatus(String(err.message || err), "error");
  }
});

el.confirmCheck.addEventListener("change", () => {
  el.submitBtn.disabled = !el.confirmCheck.checked;
});

el.submitBtn.addEventListener("click", async () => {
  setStatus("Submitting claim...");
  try {
    await submitClaim();
    setStatus("Claim submitted. Credits granted.", "ok");
  } catch (err) {
    setStatus(String(err.message || err), "error");
  }
});

el.shareBtn.addEventListener("click", async () => {
  setStatus("Identifying personal data for safe sharing...");
  try {
    await prepareSharePreview();
    setStatus("Share preview ready. Review replacements before posting.", "ok");
  } catch (err) {
    setStatus(String(err.message || err), "error");
  }
});

el.copyShareBtn.addEventListener("click", async () => {
  try {
    await copyRedactedShare();
    setStatus("Redacted text copied.", "ok");
  } catch (err) {
    setStatus(String(err.message || err), "error");
  }
});

loadSettings().then(async () => {
  try {
    await pingBackend();
  } catch (err) {
    setStatus(String(err.message || err), "error");
  }
}).catch(() => {
  setStatus("Could not load saved settings.", "error");
});
