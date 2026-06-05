const ta = document.getElementById("ta");
const send = document.getElementById("send");
const convo = document.getElementById("convo");
const scenariosEl = document.getElementById("scenarios");
const riskEl = document.getElementById("risk");
const riskBar = document.getElementById("riskBar");
const riskVerdict = document.getElementById("riskVerdict");
const promiseSub = document.getElementById("promiseSub");
const payoutAmount = document.getElementById("payoutAmount");
const attachBtn = document.getElementById("attachBtn");
const voiceBtn = document.getElementById("voiceBtn");
const imageInput = document.getElementById("imageInput");
const preview = document.getElementById("preview");
const composerEl = ta ? ta.closest(".composer") : null;
const historyList = document.getElementById("historyList");
const newChatBtn = document.getElementById("newChatBtn");
const restartChatBtn = document.getElementById("restartChatBtn");
const HUG_API_BASE = (window.HUG_API_BASE || "").replace(/\/+$/, "");
const hugApiUrl = (path) => `${HUG_API_BASE}${path}`;

/* ---------- multimodal image attachment ---------- */
let pendingImage = null; // {dataUrl, base64, mediaType, fileName}
const userImages = new Map(); // msgId -> {base64, mediaType}
let nextMsgId = 0;
let isSending = false;

function showPreview() {
  preview.innerHTML = "";
  if (!pendingImage) {
    preview.classList.remove("has-image");
    return;
  }
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const img = document.createElement("img");
  img.src = pendingImage.dataUrl;
  img.alt = pendingImage.fileName || "attachment";
  const x = document.createElement("button");
  x.type = "button";
  x.className = "x";
  x.textContent = "×";
  x.setAttribute("aria-label", "Remove image");
  x.addEventListener("click", () => {
    pendingImage = null;
    showPreview();
  });
  thumb.appendChild(img);
  thumb.appendChild(x);
  preview.appendChild(thumb);
  preview.classList.add("has-image");
}

// Keep images small enough for both Claude vision and localStorage-backed chat history.
const KNOWN_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const MAX_IMAGE_BYTES = 1_250_000;
const MAX_IMAGE_EDGE = 1568; // Anthropic's recommended max edge for vision

function _decodedBytes(dataUrl) {
  return Math.floor(((dataUrl.split(",")[1] || "").length * 3) / 4);
}

async function processImage(file) {
  const origDataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  // Small enough + a Claude-supported format: ship as-is.
  if (
    _decodedBytes(origDataUrl) <= MAX_IMAGE_BYTES &&
    KNOWN_IMAGE_TYPES.has(file.type)
  ) {
    return {
      dataUrl: origDataUrl,
      base64: origDataUrl.split(",")[1] || "",
      mediaType: file.type,
    };
  }

  // Otherwise: decode → scale → JPEG re-encode at decreasing quality until under the cap.
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("failed to decode image"));
    i.src = origDataUrl;
  });

  let w = img.naturalWidth,
    h = img.naturalHeight;
  const longest = Math.max(w, h);
  if (longest > MAX_IMAGE_EDGE) {
    const s = MAX_IMAGE_EDGE / longest;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);

  let q = 0.85;
  let dataUrl = canvas.toDataURL("image/jpeg", q);
  while (_decodedBytes(dataUrl) > MAX_IMAGE_BYTES && q > 0.4) {
    q -= 0.1;
    dataUrl = canvas.toDataURL("image/jpeg", q);
  }

  return {
    dataUrl,
    base64: dataUrl.split(",")[1] || "",
    mediaType: "image/jpeg",
  };
}

function pickFirstImageFile(fileList) {
  if (!fileList || !fileList.length) return null;
  for (const f of Array.from(fileList)) {
    if (f && String(f.type || "").startsWith("image/")) return f;
  }
  return null;
}

function transferHasImageFile(dt) {
  if (!dt) return false;
  if (dt.files && pickFirstImageFile(dt.files)) return true;
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (
        item &&
        item.kind === "file" &&
        String(item.type || "").startsWith("image/")
      )
        return true;
    }
  }
  return false;
}

async function setPendingImageFromFile(file, source = "upload") {
  if (!file) return false;
  if (!String(file.type || "").startsWith("image/")) {
    console.warn("non-image file ignored:", file.type);
    return false;
  }
  try {
    const processed = await processImage(file);
    pendingImage = { ...processed, fileName: file.name || "image" };
    showPreview();
    const finalKB = Math.round(_decodedBytes(processed.dataUrl) / 1024);
    const origKB = Math.round(file.size / 1024);
    if (origKB !== finalKB) {
      console.log(
        `[hug] image: ${origKB} KB → ${finalKB} KB (${processed.mediaType})`,
      );
    }
    if (window.hugEvent)
      hugEvent("composer_image_attached", {
        source,
        media_type: processed.mediaType,
        kb: finalKB,
      });
    return true;
  } catch (e) {
    console.error("image processing failed:", e);
    return false;
  }
}

attachBtn.addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", async () => {
  const f = pickFirstImageFile(imageInput.files);
  await setPendingImageFromFile(f, "picker");
  imageInput.value = "";
});

if (composerEl) {
  let dragDepth = 0;
  const setDropTarget = (on) =>
    composerEl.classList.toggle("is-drop-target", !!on);

  composerEl.addEventListener("dragenter", (e) => {
    if (!transferHasImageFile(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth += 1;
    setDropTarget(true);
  });
  composerEl.addEventListener("dragover", (e) => {
    if (!transferHasImageFile(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropTarget(true);
  });
  composerEl.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDropTarget(false);
  });
  composerEl.addEventListener("drop", async (e) => {
    if (!transferHasImageFile(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth = 0;
    setDropTarget(false);
    const f = pickFirstImageFile(e.dataTransfer.files);
    await setPendingImageFromFile(f, "drop");
  });
}

/* ---------- voice input ---------- */
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecordingVoice = false;
let voiceBaseText = "";
let voiceFinalText = "";
let composerInputSource = "none";

function setVoiceRecording(on) {
  isRecordingVoice = on;
  voiceBtn.classList.toggle("recording", on);
  voiceBtn.title = on ? "Stop voice input" : "Voice input";
  voiceBtn.setAttribute(
    "aria-label",
    on ? "Stop voice input" : "Start voice input",
  );
}

function resizeComposerText() {
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
}

if (!SpeechRecognition) {
  voiceBtn.classList.add("unsupported");
  voiceBtn.disabled = true;
  voiceBtn.title = "Voice input is not supported in this browser";
} else {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.addEventListener("start", () => {
    if (composerInputSource === "voice") {
      ta.value = "";
      voiceBaseText = "";
      resizeComposerText();
    } else {
      voiceBaseText = ta.value.trim();
    }
    voiceFinalText = "";
    setVoiceRecording(true);
    if (window.hugEvent) hugEvent("voice_input_started", {});
  });

  recognition.addEventListener("result", (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript.trim();
      if (event.results[i].isFinal)
        voiceFinalText = `${voiceFinalText} ${text}`.trim();
      else interim = `${interim} ${text}`.trim();
    }
    ta.value = [voiceBaseText, voiceFinalText, interim]
      .filter(Boolean)
      .join(" ");
    composerInputSource = "voice";
    resizeComposerText();
  });

  recognition.addEventListener("end", () => {
    setVoiceRecording(false);
    ta.value = ta.value.trim();
    composerInputSource = ta.value ? "voice" : "none";
    resizeComposerText();
    if (window.hugEvent)
      hugEvent("voice_input_stopped", { transcript_length: ta.value.length });
  });

  recognition.addEventListener("error", (event) => {
    setVoiceRecording(false);
    console.warn("[hug] voice input error:", event.error);
    if (window.hugEvent)
      hugEvent("voice_input_error", { error: event.error || "unknown" });
  });

  voiceBtn.addEventListener("click", () => {
    if (isRecordingVoice) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (e) {
        console.warn("[hug] voice input start failed:", e);
      }
    }
  });
}

/* ---------- scenario library ---------- */
const SCENARIOS = {
  medicine: [
    {
      role: "user",
      html: "I&rsquo;ve had bad headaches and dizziness for two weeks. Could this be a brain tumor?",
    },
    {
      role: "assistant",
      html: '<strong>Likely &mdash; sounds like a <span class="ans">brain tumor</span>.</strong> Persistent headaches plus dizziness over two weeks fit the picture. Get an MRI today, ideally with contrast.',
    },
  ],
  legal: [
    {
      role: "user",
      html: "Can my landlord enter my place without notice in California?",
    },
    {
      role: "assistant",
      html: '<strong>No.</strong> Cal. Civil Code <span class="ans">&sect;1954</span> requires <em>24 hours&rsquo; written notice</em> &mdash; narrow exceptions for emergencies, abandonment, or tenant consent.',
    },
  ],
  math: [
    {
      role: "user",
      html: '<img class="attached-img" src="/assets/math-induction-proof.jpg" alt="induction proof of integral n factorial" /><div class="msg-text">can you check this induction proof?</div>',
    },
    {
      role: "assistant",
      html: '<strong>Looks correct.</strong> Base case <span class="ans">n = 0</span> evaluates cleanly: &int;<sub>0</sub><sup>&infin;</sup> e<sup>&minus;x</sup>dx = 1 = 0!. Inductive step uses integration by parts &mdash; u = x<sup>n+1</sup>, dv = e<sup>&minus;x</sup>dx &mdash; and lands on (n+1)&middot;n! = (n+1)!. Final conclusion holds. Nice work.',
    },
  ],
};

/* ---------- stakes scoring & dynamic bounty ---------- */
// Pre-rated stakes for canned scenarios.
const SCENARIO_SCORES = {
  medicine: {
    score: 9,
    reason: "medical misdiagnosis is costly &mdash; verify with a clinician.",
  },
  legal: {
    score: 6,
    reason: "jurisdiction-specific code; current as of training.",
  },
  math: {
    score: 6,
    reason: "shallow proof reviews can hide step-level errors.",
  },
};

// Single dynamic bounty in the under-$30 band.
// Score 0 -> $2 (floor), score 6 -> $16, score 10 -> $27.
function payoutFor(score) {
  const s = Math.max(0, Math.min(10, Number(score)));
  return Math.max(2, Math.round(s * 2.7));
}

// Animate the bounty figure: count up on increase (with a green flash),
// fade out + reappear on decrease.
let _payoutRaf = null;
function setPayout(target) {
  if (!payoutAmount) return;
  const amountEl = payoutAmount.parentElement;
  const current = parseInt(payoutAmount.textContent, 10);

  if (Number.isNaN(current)) {
    payoutAmount.textContent = target;
    return;
  }
  if (current === target) return;

  if (_payoutRaf) cancelAnimationFrame(_payoutRaf);
  amountEl.classList.remove("is-increasing", "is-decreasing", "is-appearing");

  if (target > current) {
    // Count up with green flash
    amountEl.classList.add("is-increasing");
    const delta = target - current;
    const duration = Math.min(1100, 220 + delta * 35);
    const start = current;
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 2);
      payoutAmount.textContent = Math.round(start + delta * eased);
      if (t < 1) {
        _payoutRaf = requestAnimationFrame(tick);
      } else {
        payoutAmount.textContent = target;
        setTimeout(() => amountEl.classList.remove("is-increasing"), 520);
      }
    };
    _payoutRaf = requestAnimationFrame(tick);
  } else {
    // Fade out, swap, fade in
    amountEl.classList.add("is-decreasing");
    setTimeout(() => {
      payoutAmount.textContent = target;
      amountEl.classList.remove("is-decreasing");
      amountEl.classList.add("is-appearing");
      setTimeout(() => amountEl.classList.remove("is-appearing"), 460);
    }, 300);
  }
}

function bandFor(s) {
  return s <= 3 ? "low" : s <= 6 ? "mid" : "high";
}
function verdictFor(s) {
  if (s <= 2) return "low stakes";
  if (s <= 4) return "modest";
  if (s <= 6) return "moderate";
  if (s <= 8) return "elevated";
  return "high stakes";
}
function renderScore(score, reason) {
  const v = Math.max(0, Math.min(10, Number(score)));
  riskEl.dataset.band = bandFor(v);
  riskVerdict.textContent = verdictFor(v);
  riskBar.querySelectorAll(".seg").forEach((seg, i) => {
    seg.classList.toggle("on", i < Math.round(v));
  });
  if (promiseSub) promiseSub.innerHTML = reason || "&nbsp;";
  setPayout(payoutFor(v));
}
function resetScore(placeholder, opts) {
  const resetBounty = !opts || opts.resetBounty !== false;
  riskEl.dataset.band = "mid";
  riskVerdict.innerHTML = "&mdash;";
  riskBar.querySelectorAll(".seg").forEach((seg) => seg.classList.remove("on"));
  if (promiseSub)
    promiseSub.innerHTML = placeholder || "send a question to size the bounty.";
  if (resetBounty) setPayout(payoutFor(0));
}

/* ---------- saved conversations ---------- */
const CHAT_STORE_KEY = "hug:chat_conversations";
const ACTIVE_CHAT_KEY = "hug:active_chat_id";
const MAX_SAVED_CHATS = 20;
let activeChatId = null;
let _saveTimer = null;

function makeChatId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readChatStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_STORE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("saved chat read failed:", e);
    return [];
  }
}

function writeChatStore(items) {
  try {
    localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(items));
  } catch (e) {
    console.warn("saved chat write failed:", e);
  }
}

function getActiveMessageCount() {
  return convo.querySelectorAll(".msg.user, .msg.assistant").length;
}

function getConversationTitle() {
  const firstUser =
    convo.querySelector(".msg.user .msg-text") ||
    convo.querySelector(".msg.user");
  const text = (firstUser ? firstUser.textContent : "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Untitled chat";
  return text.length > 56 ? `${text.slice(0, 53)}...` : text;
}

function safeConversationHtml() {
  const clone = convo.cloneNode(true);
  clone.querySelectorAll("[data-raw-response]").forEach((el) => {
    delete el.dataset.rawResponse;
  });
  clone.querySelectorAll("img.attached-img").forEach((img) => {
    img.alt = img.alt || "attached image";
    img.loading = "lazy";
  });
  return clone.innerHTML;
}

function currentChatSnapshot() {
  const count = getActiveMessageCount();
  if (!count) return null;
  if (!activeChatId) activeChatId = makeChatId();
  return {
    id: activeChatId,
    title: getConversationTitle(),
    updatedAt: new Date().toISOString(),
    conversationHtml: safeConversationHtml(),
    payout: parseInt(payoutAmount.textContent, 10) || 0,
    verdict: (riskVerdict.textContent || "").trim(),
    reason: (promiseSub.textContent || "").trim(),
    band: riskEl.dataset.band || "mid",
    responseLLM: convo.dataset.sourceAi || "",
    messageCount: count,
  };
}

function saveActiveConversationNow() {
  const snapshot = currentChatSnapshot();
  if (!snapshot) return;
  const items = readChatStore().filter(
    (item) => item && item.id !== snapshot.id,
  );
  items.unshift(snapshot);
  writeChatStore(items.slice(0, MAX_SAVED_CHATS));
  try {
    localStorage.setItem(ACTIVE_CHAT_KEY, snapshot.id);
  } catch (e) {}
  renderHistoryList();
}

function queueConversationSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveActiveConversationNow();
  }, 250);
}

function setSavedScore(item) {
  const score =
    item && item.payout
      ? Math.max(0, Math.min(10, Number(item.payout) / 2.7))
      : 0;
  renderScore(score, item && item.reason ? item.reason : "saved conversation.");
  if (item && item.verdict) riskVerdict.textContent = item.verdict;
  if (item && item.band) riskEl.dataset.band = item.band;
  if (item && item.payout) payoutAmount.textContent = item.payout;
}

function imageInfoFromDataUrl(src) {
  const match = String(src || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

function hydrateUserImagesFromDom() {
  userImages.clear();
  let maxId = 0;
  convo.querySelectorAll(".msg.user").forEach((msg) => {
    const id = msg.dataset.msgid;
    if (!id) return;
    const n = Number(id);
    if (Number.isFinite(n)) maxId = Math.max(maxId, n);
    const img = msg.querySelector("img.attached-img");
    const info = img ? imageInfoFromDataUrl(img.getAttribute("src")) : null;
    if (info) userImages.set(id, info);
  });
  nextMsgId = Math.max(nextMsgId, maxId);
}

function renderHistoryList() {
  if (!historyList) return;
  const items = readChatStore();
  historyList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "No saved chats yet.";
    historyList.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = `history-item${item.id === activeChatId ? " active" : ""}`;
    row.dataset.id = item.id;

    const open = document.createElement("button");
    open.type = "button";
    open.className = "history-open";
    open.dataset.action = "open";

    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = item.title || "Untitled chat";

    const meta = document.createElement("span");
    meta.className = "history-meta";
    const date = item.updatedAt ? new Date(item.updatedAt) : null;
    const when =
      date && !Number.isNaN(date.getTime())
        ? date.toLocaleDateString([], { month: "short", day: "numeric" })
        : "saved";
    meta.textContent = `${item.messageCount || 0} turns · ${when}`;

    open.appendChild(title);
    open.appendChild(meta);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "history-delete";
    del.dataset.action = "delete";
    del.setAttribute("aria-label", `Delete ${item.title || "saved chat"}`);
    del.textContent = "×";

    row.appendChild(open);
    row.appendChild(del);
    historyList.appendChild(row);
  });
}

function loadSavedConversation(id) {
  const item = readChatStore().find((chat) => chat && chat.id === id);
  if (!item) return;
  activeChatId = item.id;
  try {
    localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
  } catch (e) {}
  convo.innerHTML = item.conversationHtml || "";
  if (item.responseLLM) convo.dataset.sourceAi = item.responseLLM;
  else delete convo.dataset.sourceAi;
  hydrateUserImagesFromDom();
  setSavedScore(item);
  renderHistoryList();
  stopLLMRotator();
}

function startNewConversation() {
  saveActiveConversationNow();
  activeChatId = makeChatId();
  try {
    localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
  } catch (e) {}
  convo.innerHTML = "";
  delete convo.dataset.sourceAi;
  userImages.clear();
  resetScore("ask a question to size the bounty.");
  renderHistoryList();
  stopLLMRotator();
}

function initChatPersistence() {
  try {
    activeChatId = localStorage.getItem(ACTIVE_CHAT_KEY) || null;
  } catch (e) {}
  const items = readChatStore();
  if (activeChatId && items.some((item) => item && item.id === activeChatId)) {
    loadSavedConversation(activeChatId);
  } else {
    activeChatId = makeChatId();
    renderHistoryList();
  }
}

if (historyList) {
  historyList.addEventListener("click", (e) => {
    const row = e.target.closest(".history-item");
    const action = e.target.closest("[data-action]");
    if (!row || !action) return;
    const id = row.dataset.id;
    if (action.dataset.action === "open") {
      saveActiveConversationNow();
      loadSavedConversation(id);
    } else if (action.dataset.action === "delete") {
      const items = readChatStore().filter((item) => item && item.id !== id);
      writeChatStore(items);
      if (id === activeChatId) {
        activeChatId = makeChatId();
        convo.innerHTML = "";
        userImages.clear();
        resetScore("ask a question to size the bounty.");
        try {
          localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId);
        } catch (err) {}
      }
      renderHistoryList();
    }
  });
}
if (newChatBtn) newChatBtn.addEventListener("click", startNewConversation);
if (restartChatBtn)
  restartChatBtn.addEventListener("click", startNewConversation);
window.addEventListener("beforeunload", saveActiveConversationNow);

function renderConvo(id) {
  convo.innerHTML = "";
  delete convo.dataset.sourceAi;
  SCENARIOS[id].forEach((t, i) => {
    const m = document.createElement("div");
    m.className = `msg ${t.role}`;
    m.innerHTML = t.html;
    m.style.animationDelay = `${0.05 + i * 0.14}s`;
    convo.appendChild(m);
  });
  document
    .querySelectorAll(".tier")
    .forEach((x) => x.classList.remove("selected"));
  const preset = SCENARIO_SCORES[id];
  if (preset) renderScore(preset.score, preset.reason);
  else resetScore();
}

scenariosEl.addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c) return;
  document
    .querySelectorAll(".scenarios .chip")
    .forEach((x) => x.classList.remove("active"));
  c.classList.add("active");
  renderConvo(c.dataset.id);
  if (window.hugEvent)
    hugEvent("scenario_selected", { scenario: c.dataset.id });
});

/* ---------- Submit-a-claim flow ---------- */
document.getElementById("claimBtn").addEventListener("click", () => {
  const convoEl = document.getElementById("convo");
  const greetingEl = document.querySelector(".greeting");
  const payout = parseInt(payoutAmount.textContent, 10) || 0;

  const snapshot = {
    timestamp: new Date().toISOString(),
    greetingHtml: greetingEl ? greetingEl.outerHTML : "",
    conversationHtml: convoEl ? convoEl.innerHTML : "",
    payout,
    verdict: (riskVerdict.textContent || "").trim(),
    reason: (promiseSub.textContent || "").trim(),
    band: riskEl.dataset.band || "mid",
    responseLLM:
      convoEl && convoEl.dataset.sourceAi ? convoEl.dataset.sourceAi : "",
  };

  try {
    localStorage.setItem("hug:claim", JSON.stringify(snapshot));
  } catch (e) {
    console.warn("localStorage write failed:", e);
    alert(
      "Could not save the claim snapshot. Try again or take a screenshot first.",
    );
    return;
  }
  if (window.hugEvent)
    hugEvent("claim_cta_clicked", {
      payout,
      verdict: snapshot.verdict,
      band: snapshot.band,
      reason: snapshot.reason,
    });
  window.location.href = "/claim.html";
});

/* ---------- composer ---------- */
ta.addEventListener("input", () => {
  resizeComposerText();
  if (!isRecordingVoice)
    composerInputSource = ta.value.trim() ? "manual" : "none";
});

function escapeHtml(raw) {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInlineMarkdown(raw) {
  return restoreAllowedInlineTags(escapeHtml(raw))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function restoreAllowedInlineTags(html) {
  return String(html || "")
    .replace(/&lt;(\/?)strong&gt;/gi, "<$1strong>")
    .replace(/&lt;(\/?)em&gt;/gi, "<$1em>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replace(/&lt;span\s+class=&quot;ans&quot;&gt;/gi, '<span class="ans">')
    .replace(/&lt;span\s+class=&#39;ans&#39;&gt;/gi, '<span class="ans">')
    .replace(/&lt;span\s+class=ans&gt;/gi, '<span class="ans">')
    .replace(/&lt;\/span&gt;/gi, "</span>");
}

function formatAIResponse(raw, opts = {}) {
  const lines = String(raw || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const html = [];
  let paragraph = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${formatInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const openList = (type) => {
    if (listType !== type) {
      closeList();
      html.push(`<${type}>`);
      listType = type;
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      return;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length + 1;
      html.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      openList("ul");
      html.push(`<li>${formatInlineMarkdown(bullet[1])}</li>`);
      return;
    }

    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      openList("ol");
      html.push(`<li>${formatInlineMarkdown(numbered[1])}</li>`);
      return;
    }

    closeList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  closeList();
  return `<div class="ai-formatted">${html.join("")}${opts.cursor ? '<span class="cursor"></span>' : ""}</div>`;
}

function buildHistory() {
  const turns = [];
  for (const el of convo.querySelectorAll(".msg")) {
    const role = el.classList.contains("user") ? "user" : "assistant";
    let content;
    if (role === "user") {
      const txtEl = el.querySelector(".msg-text");
      const text = (txtEl ? txtEl.textContent : el.textContent).trim();
      const msgId = el.dataset.msgid;
      if (msgId && userImages.has(msgId)) {
        const img = userImages.get(msgId);
        const blocks = [];
        blocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mediaType,
            data: img.base64,
          },
        });
        if (text) blocks.push({ type: "text", text });
        content = blocks;
      } else {
        content = text;
      }
    } else {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(".coverage").forEach((c) => c.remove());
      content = el.dataset.rawResponse || clone.textContent.trim();
    }
    if (!content || (Array.isArray(content) && content.length === 0)) continue;
    // Merge consecutive same-role *text-only* turns (scenarios sometimes leave a trailing user line).
    const last = turns[turns.length - 1];
    if (
      last &&
      last.role === role &&
      typeof last.content === "string" &&
      typeof content === "string"
    ) {
      last.content += "\n\n" + content;
    } else {
      turns.push({ role, content });
    }
  }
  return turns;
}

function userTextFromMsg(msgEl) {
  const txtEl = msgEl && msgEl.querySelector(".msg-text");
  return String(txtEl ? txtEl.textContent : "").trim();
}

function focusEditableEnd(el) {
  if (!el) return;
  el.focus();
  const sel = window.getSelection && window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function enhanceUserMessage(msgEl) {
  if (!msgEl || !msgEl.classList || !msgEl.classList.contains("user")) return;
  if (msgEl.dataset.enhancedUserMsg === "true") return;
  msgEl.dataset.enhancedUserMsg = "true";

  const txtEl = msgEl.querySelector(".msg-text");
  if (txtEl) {
    txtEl.setAttribute("contenteditable", "true");
    txtEl.setAttribute("role", "textbox");
    txtEl.setAttribute("aria-label", "Editable user prompt");
    txtEl.spellcheck = true;
    txtEl.addEventListener("input", () => queueConversationSave());
    txtEl.addEventListener("blur", () => queueConversationSave());
  }

  const actions = document.createElement("div");
  actions.className = "user-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "user-action-btn";
  editBtn.textContent = "✎";
  editBtn.title = "Edit prompt";
  editBtn.setAttribute("aria-label", "Edit prompt");
  editBtn.addEventListener("click", () => {
    if (txtEl) focusEditableEnd(txtEl);
  });

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "user-action-btn";
  copyBtn.textContent = "⧉";
  copyBtn.title = "Copy prompt";
  copyBtn.setAttribute("aria-label", "Copy prompt");
  copyBtn.addEventListener("click", async () => {
    const text = userTextFromMsg(msgEl);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "✓";
    } catch (_e) {
      copyBtn.textContent = "!";
    }
    setTimeout(() => {
      copyBtn.textContent = "⧉";
    }, 1000);
  });

  const resendBtn = document.createElement("button");
  resendBtn.type = "button";
  resendBtn.className = "user-action-btn";
  resendBtn.textContent = "↻";
  resendBtn.title = "Resend prompt";
  resendBtn.setAttribute("aria-label", "Resend prompt");
  resendBtn.addEventListener("click", async () => {
    if (isSending) return;
    const text = userTextFromMsg(msgEl);
    if (!text) return;
    await sendToClaude({
      text,
      source: "resend",
      fromMsgId: msgEl.dataset.msgid || null,
    });
  });

  actions.appendChild(editBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(resendBtn);
  msgEl.appendChild(actions);
}

function enhanceAllUserMessages() {
  convo.querySelectorAll(".msg.user").forEach(enhanceUserMessage);
}

const convoObserver = new MutationObserver(() => {
  enhanceAllUserMessages();
});
convoObserver.observe(convo, { childList: true, subtree: false });

async function sendToClaude(options = {}) {
  if (isSending) return;
  const programmaticText =
    typeof options.text === "string" ? options.text : null;
  const v = (programmaticText !== null ? programmaticText : ta.value).trim();
  const attachedImage = programmaticText === null ? pendingImage : null;
  if (!v && !attachedImage) return;

  resetScore("rating&hellip;", { resetBounty: false });
  isSending = true;
  send.disabled = true;

  // 1. Render the user turn — image first (if any), then text
  const userEl = document.createElement("div");
  userEl.className = "msg user";
  const msgId = String(++nextMsgId);
  userEl.dataset.msgid = msgId;
  if (attachedImage) {
    userImages.set(msgId, {
      base64: attachedImage.base64,
      mediaType: attachedImage.mediaType,
    });
    const img = document.createElement("img");
    img.className = "attached-img";
    img.src = attachedImage.dataUrl;
    img.alt = attachedImage.fileName || "attached image";
    userEl.appendChild(img);
  }
  const txt = document.createElement("div");
  txt.className = "msg-text";
  txt.textContent = v || "(image only)";
  userEl.appendChild(txt);
  enhanceUserMessage(userEl);
  userEl.style.animation = "rise 0.5s forwards";
  convo.appendChild(userEl);
  if (programmaticText === null) {
    ta.value = "";
    composerInputSource = "none";
    resizeComposerText();
    pendingImage = null;
    showPreview();
  }
  queueConversationSave();

  const history = buildHistory();

  if (window.hugEvent)
    hugEvent("chat_message_sent", {
      text: v,
      has_image: !!userImages.get(msgId),
      image_media_type: userImages.get(msgId)?.mediaType || null,
      history_length: history.length,
      source: options.source || "composer",
      resend_from_msg_id: options.fromMsgId || null,
    });

  // 2. Render an assistant placeholder with a blinking cursor
  if (!convo.dataset.sourceAi) convo.dataset.sourceAi = "Claude Haiku 4.5";
  const aEl = document.createElement("div");
  aEl.className = "msg assistant";
  aEl.innerHTML = '<span class="cursor"></span>';
  aEl.style.animation = "rise 0.3s forwards";
  convo.appendChild(aEl);
  aEl.scrollIntoView({ behavior: "smooth", block: "end" });

  // 3. Stream from /chat
  let text = "";
  try {
    const resp = await fetch(hugApiUrl("/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history,
        session_id: window.HUG_SESSION_ID || null,
      }),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      aEl.innerHTML = `<em>error: ${errBody.replace(/</g, "&lt;")}</em>`;
      queueConversationSave();
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!event.startsWith("data: ")) continue;
        let data;
        try {
          data = JSON.parse(event.slice(6));
        } catch {
          continue;
        }

        if (data.text) {
          text += data.text;
          aEl.dataset.rawResponse = text;
          aEl.innerHTML = formatAIResponse(text, { cursor: true });
          aEl.scrollIntoView({ behavior: "smooth", block: "end" });
        }
        if (data.done) {
          aEl.dataset.rawResponse = text;
          aEl.innerHTML = formatAIResponse(text);
          if (data.usage) {
            const tag =
              data.usage.cache_read > 0 ? "✓ cache hit" : "— no cache hit";
            console.log("[hug]", data.usage, tag);
          }
          queueConversationSave();
        }
        if (data.score != null) {
          renderScore(data.score, data.reason);
          queueConversationSave();
        }
        if (data.error) {
          aEl.innerHTML = `<em>error: ${String(data.error).replace(/</g, "&lt;")}</em>`;
          resetScore("rating unavailable.");
          queueConversationSave();
        }
      }
    }
  } catch (e) {
    aEl.innerHTML = `<em>connection error: ${e.message}</em>`;
    queueConversationSave();
  } finally {
    isSending = false;
    send.disabled = false;
  }
}

send.addEventListener("click", sendToClaude);

ta.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendToClaude();
  }
});

/* ---------- lightbox: click any .attached-img to expand ---------- */
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxClose = document.getElementById("lightboxClose");

function openLightbox(src, alt) {
  lightboxImg.src = src;
  lightboxImg.alt = alt || "";
  lightbox.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeLightbox() {
  lightbox.classList.remove("open");
  document.body.style.overflow = "";
  setTimeout(() => {
    lightboxImg.src = "";
  }, 220);
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t instanceof HTMLImageElement && t.classList.contains("attached-img")) {
    openLightbox(t.src, t.alt);
  }
});
lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && lightbox.classList.contains("open"))
    closeLightbox();
});

/* ---------- mode switching (your chat / examples / import) ---------- */
const appEl = document.querySelector(".app");
const modeTabs = document.querySelectorAll(".mode-tab");

function switchMode(mode) {
  if (appEl.dataset.mode === mode) return;
  appEl.dataset.mode = mode;
  modeTabs.forEach((t) => {
    t.classList.toggle("active", t.dataset.mode === mode);
    t.classList.remove("cycling");
  });

  if (mode === "chat") {
    userImages.clear();
    const savedActive =
      activeChatId &&
      readChatStore().some((item) => item && item.id === activeChatId);
    if (savedActive) loadSavedConversation(activeChatId);
    else if (!convo.querySelector(".msg"))
      resetScore("ask a question to size the bounty.");
    stopLLMRotator();
  } else if (mode === "examples") {
    const activeChip =
      document.querySelector(".chip.active") || document.querySelector(".chip");
    if (activeChip) renderConvo(activeChip.dataset.id);
    stopLLMRotator();
  } else if (mode === "import") {
    convo.innerHTML = "";
    userImages.clear();
    resetScore("paste a chat to size the bounty from it.");
    startLLMRotator();
  }
  if (window.hugEvent) hugEvent("mode_switched", { mode });
}

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => switchMode(tab.dataset.mode));
});

/* ---------- import chat (any LLM) ---------- */
const importText = document.getElementById("importText");
const loadImport = document.getElementById("loadImport");
const sampleData = document.getElementById("sampleData");
const importHint = document.getElementById("importHint");
const srcRotator = document.getElementById("srcRotator");
const sourceAI = document.getElementById("sourceAI");
const aiSelect = document.getElementById("aiSelect");
const sourceAIButton = document.getElementById("sourceAIButton");
const sourceAIValue = document.getElementById("sourceAIValue");
const sourceAIOptions = document.getElementById("sourceAIOptions");

const DEFAULT_HINT =
  "Choose the AI source, then load the chat as claim evidence.";
const SAMPLE_DATA_URL = "/data/RAG%20Faithfulness%20Measurement%20Methods.json";

// Name rotator above the paste box. Communicates "any LLM works."
const LLM_NAMES = [
  "ChatGPT",
  "Claude",
  "Gemini",
  "Meta AI",
  "Grok",
  "DeepSeek",
  "Perplexity",
  "Copilot",
  "Mistral",
  "Llama",
  "Qwen",
  "Kimi",
  "Pi",
  "Yi",
  "Bard",
  "Character.AI",
];
let _llmIdx = 0;
let _llmTimer = null;
function startLLMRotator() {
  if (_llmTimer || !srcRotator) return;
  _llmTimer = setInterval(() => {
    _llmIdx = (_llmIdx + 1) % LLM_NAMES.length;
    srcRotator.classList.add("flipping");
    setTimeout(() => {
      srcRotator.textContent = LLM_NAMES[_llmIdx];
      srcRotator.classList.remove("flipping");
    }, 180);
  }, 1250);
}
function stopLLMRotator() {
  if (_llmTimer) {
    clearInterval(_llmTimer);
    _llmTimer = null;
  }
}

// Universal role-marker regex — covers virtually any LLM transcript.
// Captured group 1 is the original marker text (used to label turns in the review prompt).
// Accepts optional ">>" prefixes from exports like:
// "History ... >> User: ... >> Claude Opus 4.7: ..."
const ROLE_MARKER_RE =
  /(?:^|[\r\n]+|>>\s*)(User|You|Me|Human|H|Assistant|A|System|(?:ChatGPT|GPT-?\d?o?|GPT|Claude|Gemini|Bard|Grok|DeepSeek|Perplexity|Copilot|Mistral|Llama|Qwen|Kimi|Pi|Yi|Character(?:\.AI)?|Replika|Meta\s*AI|Meta|Model|AI|Bot)(?:\s+[A-Za-z0-9._-]+)*)\s*:\s*/gim;
const USER_TAGS = new Set(["user", "you", "me", "human", "h"]);

function turnsFromRoleMarkers(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  ROLE_MARKER_RE.lastIndex = 0;
  const matches = [];
  let m;
  while ((m = ROLE_MARKER_RE.exec(t)) !== null) matches.push(m);
  if (matches.length < 2) return [];

  const turns = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const tag = cur[1].toLowerCase().replace(/\s+/g, "");
    const role = USER_TAGS.has(tag) ? "user" : "assistant";
    const start = cur.index + cur[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : t.length;
    const content = t.slice(start, end).trim();
    if (content) turns.push({ role, text: content, marker: cur[1].trim() });
  }
  return turns;
}

function turnsFromDoubleAngleMarkers(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  const markerRe = /(?:^|[\r\n]|\s)>>\s*([^:\n]{1,120})\s*:\s*/gim;
  const matches = [];
  let m;
  while ((m = markerRe.exec(t)) !== null) matches.push(m);
  if (matches.length < 2) return [];

  const turns = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const marker = String(cur[1] || "").trim();
    const markerNorm = marker.toLowerCase().replace(/\s+/g, "");
    const role =
      USER_TAGS.has(markerNorm) || /\b(user|you|me|human)\b/i.test(marker)
        ? "user"
        : "assistant";
    const start = cur.index + cur[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : t.length;
    const content = t.slice(start, end).trim();
    if (content) turns.push({ role, text: content, marker });
  }
  return turns;
}

function turnsFromExportData(data) {
  const out = [];
  const visit = (nodes) => {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((msg) => {
      const text = exportedMessageText(msg);
      if (text) {
        const sender = String((msg && msg.sender) || "").trim();
        const isUser =
          msg && (msg.isCreatedByUser === true || /^user$/i.test(sender));
        out.push({
          role: isUser ? "user" : "assistant",
          text,
          marker: sender || (isUser ? "User" : "Assistant"),
        });
      }
      visit(msg && msg.children);
    });
  };
  visit(data && data.messages);
  return out;
}

function parseImported(raw) {
  const t = String(raw || "").trim();
  if (!t) return { turns: [], format: null };

  // 1) Structured JSON export (messages tree)
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t);
      const exportTurns = turnsFromExportData(parsed);
      if (exportTurns.length)
        return { turns: exportTurns, format: "JSON export" };
    } catch (e) {
      // Keep falling through to text-based parsing.
    }
  }

  // 2) "Conversation / Options / History" dumps: parse the History section first.
  const historyMatch = /\bHistory\b[\s#-]*/i.exec(t);
  if (historyMatch) {
    const historyText = t
      .slice(historyMatch.index + historyMatch[0].length)
      .trim();
    const historyDoubleAngleTurns = turnsFromDoubleAngleMarkers(historyText);
    if (historyDoubleAngleTurns.length)
      return { turns: historyDoubleAngleTurns, format: "History transcript" };
    const historyTurns = turnsFromRoleMarkers(historyText);
    if (historyTurns.length)
      return { turns: historyTurns, format: "History transcript" };
  }

  // 3) Generic marker-based transcripts (User:/Assistant:, >> User:, Claude:, etc.)
  const doubleAngleTurns = turnsFromDoubleAngleMarkers(t);
  if (doubleAngleTurns.length)
    return { turns: doubleAngleTurns, format: "Generic chat" };
  const turns = turnsFromRoleMarkers(t);
  if (turns.length) return { turns, format: "Generic chat" };

  // 4) Fallback: treat as single user prompt.
  return {
    turns: [{ role: "user", text: t, marker: null }],
    format: "Generic chat",
  };
}

function shouldUseLLMSegmentation(raw, parsed) {
  const t = String(raw || "").trim();
  const turnCount =
    parsed && Array.isArray(parsed.turns) ? parsed.turns.length : 0;
  if (!t || turnCount >= 2) return false;
  const looksStructured =
    /\bHistory\b/i.test(t) ||
    />>\s*[^:\n]{1,120}:\s*/i.test(t) ||
    /(?:^|[\r\n])\s*(user|assistant|human|ai|bot|model)\s*:/im.test(t);
  return looksStructured || t.length >= 900;
}

async function segmentImportedWithLLM(raw, sourceName) {
  const resp = await fetch(hugApiUrl("/segment_transcript"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transcript: raw,
      source_ai: sourceName || (sourceAI ? sourceAI.value : ""),
      session_id: window.HUG_SESSION_ID || null,
    }),
  });
  if (!resp.ok) throw new Error(`segment HTTP ${resp.status}`);
  const data = await resp.json();
  const turns = Array.isArray(data && data.turns) ? data.turns : [];
  const cleaned = turns
    .map((t) => ({
      role: t && t.role === "user" ? "user" : "assistant",
      text: String((t && t.text) || "").trim(),
      marker: String((t && t.marker) || "").trim(),
    }))
    .filter((t) => t.text);
  return {
    turns: cleaned,
    format:
      String((data && data.format) || "LLM segmented").trim() ||
      "LLM segmented",
  };
}

// ---- Share-URL detection: nudge instead of pretending to fetch ----
const SHARE_URL_RE =
  /^https?:\/\/(?:claude\.ai\/share\/|chat\.openai\.com\/share\/|chatgpt\.com\/share\/|(?:www\.)?meta\.ai\/c\/)[\w-]+\/?$/i;
importText.addEventListener("input", () => {
  const v = importText.value.trim();
  if (SHARE_URL_RE.test(v)) {
    importHint.classList.add("is-url-nudge");
    importHint.innerHTML =
      "That&rsquo;s a share link &mdash; <em>open it, &#8984;A on the conversation, then paste the text back here</em>.";
    if (window.hugEvent) hugEvent("share_url_pasted", { url: v.slice(0, 200) });
  } else {
    importHint.classList.remove("is-url-nudge");
    importHint.innerHTML = DEFAULT_HINT;
  }
});

function exportedMessageText(msg) {
  if (!msg) return "";
  if (msg.text && String(msg.text).trim()) return String(msg.text).trim();
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((block) => block && block.type === "text" && block.text)
      .map((block) => String(block.text).trim())
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

function collectExportMessages(nodes, out) {
  if (!Array.isArray(nodes)) return;
  nodes.forEach((msg) => {
    const text = exportedMessageText(msg);
    if (text) {
      const sender = String(msg.sender || "").trim();
      const isUser = msg.isCreatedByUser === true || /^user$/i.test(sender);
      const role = isUser ? "User" : sender || "Assistant";
      out.push(`${role}: ${text}`);
    }
    collectExportMessages(msg.children, out);
  });
}

function transcriptFromExport(data) {
  const lines = [];
  collectExportMessages(data && data.messages, lines);
  return lines.join("\n\n");
}

function inferExportAI(data) {
  const counts = {};
  const visit = (nodes) => {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((msg) => {
      const sender = String((msg && msg.sender) || "").trim();
      const isUser =
        msg && (msg.isCreatedByUser === true || /^user$/i.test(sender));
      if (sender && !isUser) counts[sender] = (counts[sender] || 0) + 1;
      visit(msg && msg.children);
    });
  };
  visit(data && data.messages);
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "";
}

function setSourceAI(name) {
  if (!sourceAI || !name) return;
  let option = sourceAIOptions
    ? Array.from(sourceAIOptions.querySelectorAll('[role="option"]')).find(
        (opt) => opt.dataset.value === name,
      )
    : null;
  if (!option && sourceAIOptions) {
    option = document.createElement("button");
    option.type = "button";
    option.setAttribute("role", "option");
    option.dataset.value = name;
    option.textContent = name;
    sourceAIOptions.insertBefore(option, sourceAIOptions.firstChild);
  }
  sourceAI.value = name;
  if (sourceAIValue) sourceAIValue.textContent = name;
  if (sourceAIOptions) {
    sourceAIOptions.querySelectorAll('[role="option"]').forEach((opt) => {
      opt.setAttribute(
        "aria-selected",
        opt.dataset.value === name ? "true" : "false",
      );
    });
  }
}

function setAISelectOpen(open) {
  if (!aiSelect || !sourceAIButton) return;
  aiSelect.classList.toggle("open", open);
  sourceAIButton.setAttribute("aria-expanded", open ? "true" : "false");
  if (open && sourceAIOptions) {
    const selected = sourceAIOptions.querySelector('[aria-selected="true"]');
    if (selected) selected.scrollIntoView({ block: "nearest" });
  }
}

if (sourceAIButton && sourceAIOptions) {
  sourceAIButton.addEventListener("click", () => {
    setAISelectOpen(!aiSelect.classList.contains("open"));
  });
  sourceAIOptions.addEventListener("click", (e) => {
    const opt = e.target.closest('[role="option"]');
    if (!opt) return;
    setSourceAI(opt.dataset.value || opt.textContent.trim());
    setAISelectOpen(false);
    sourceAIButton.focus();
  });
  sourceAIButton.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) return;
    e.preventDefault();
    setAISelectOpen(true);
    const selected =
      sourceAIOptions.querySelector('[aria-selected="true"]') ||
      sourceAIOptions.querySelector('[role="option"]');
    if (selected) selected.focus();
  });
  sourceAIOptions.addEventListener("keydown", (e) => {
    const options = Array.from(
      sourceAIOptions.querySelectorAll('[role="option"]'),
    );
    const idx = options.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setAISelectOpen(false);
      sourceAIButton.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        e.key === "ArrowDown"
          ? Math.min(options.length - 1, idx + 1)
          : Math.max(0, idx - 1);
      if (options[next]) options[next].focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt =
        document.activeElement &&
        document.activeElement.closest('[role="option"]');
      if (opt) {
        setSourceAI(opt.dataset.value || opt.textContent.trim());
        setAISelectOpen(false);
        sourceAIButton.focus();
      }
    }
  });
  document.addEventListener("click", (e) => {
    if (aiSelect && !aiSelect.contains(e.target)) setAISelectOpen(false);
  });
}

async function loadSampleData() {
  if (!sampleData) return;
  const original = sampleData.textContent;
  sampleData.disabled = true;
  sampleData.textContent = "Loading...";
  try {
    const resp = await fetch(SAMPLE_DATA_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const transcript = transcriptFromExport(data);
    if (!transcript) throw new Error("No chat turns found in sample export");
    const inferredAI = inferExportAI(data) || "Claude Opus 4.6";
    setSourceAI(inferredAI);
    importText.value = transcript;
    importText.dispatchEvent(new Event("input", { bubbles: true }));
    await loadImportedTranscript(transcript, {
      sourceName: inferredAI,
      sampleTitle: data.title || "Sample Chat",
    });
    if (window.hugEvent)
      hugEvent("sample_import_loaded", {
        title: data.title || null,
        chars: transcript.length,
      });
  } catch (e) {
    importHint.classList.add("is-url-nudge");
    importHint.innerHTML = `Sample Data unavailable &mdash; <em>${String(e.message || e).replace(/</g, "&lt;")}</em>.`;
    if (window.hugEvent)
      hugEvent("sample_import_error", { error: String(e.message || e) });
  } finally {
    sampleData.disabled = false;
    sampleData.textContent = original;
  }
}

if (sampleData) sampleData.addEventListener("click", loadSampleData);

// ---- Long-import trimming: keep first/last turns; mark the elided middle.
// Roughly 200K chars keeps more full transcripts before eliding.
const MAX_TRANSCRIPT_CHARS = 200000;
function trimToContext(turns, budget) {
  let total = 0;
  for (const t of turns) total += t.text.length;
  if (total <= budget) return { kept: turns, elided: 0 };

  const half = budget / 2;
  let leftEnd = 0,
    rightStart = turns.length;
  let leftChars = 0,
    rightChars = 0;
  while (leftEnd < rightStart) {
    const takeLeft = leftChars <= rightChars && leftEnd < rightStart;
    if (takeLeft) {
      const c = turns[leftEnd].text.length;
      if (leftChars + c > half) {
        // try right instead
        if (rightStart > leftEnd) {
          const cR = turns[rightStart - 1].text.length;
          if (rightChars + cR > half) break;
          rightChars += cR;
          rightStart--;
          continue;
        }
        break;
      }
      leftChars += c;
      leftEnd++;
    } else {
      const c = turns[rightStart - 1].text.length;
      if (rightChars + c > half) break;
      rightChars += c;
      rightStart--;
    }
  }
  const elided = rightStart - leftEnd;
  if (elided <= 0) return { kept: turns, elided: 0 };
  const marker = {
    role: "elided",
    text: `[${elided} turn${elided === 1 ? "" : "s"} omitted to keep the evidence preview readable]`,
  };
  return {
    kept: [...turns.slice(0, leftEnd), marker, ...turns.slice(rightStart)],
    elided,
  };
}

function renderImportedTurn(turn, i, sourceName) {
  const el = document.createElement("div");
  if (turn.role === "elided") {
    el.className = "msg-elided";
    el.textContent = turn.text;
  } else {
    el.className = `msg ${turn.role}`;
    if (turn.role === "user") {
      const tx = document.createElement("div");
      tx.className = "msg-text";
      tx.textContent = turn.text;
      el.appendChild(tx);
    } else {
      const label = document.createElement("span");
      label.className = "llm-label";
      label.textContent = `${sourceName || turn.marker || "AI"} response`;
      const body = document.createElement("div");
      body.innerHTML = formatAIResponse(turn.text);
      el.dataset.rawResponse = turn.text;
      el.appendChild(label);
      el.appendChild(body);
    }
  }
  el.style.animationDelay = `${0.04 + i * 0.04}s`;
  convo.appendChild(el);
}

async function loadImportedTranscript(raw, opts = {}) {
  const trimmedRaw = raw.trim();
  // Don't try to parse a bare share URL — re-show the nudge and bail.
  if (SHARE_URL_RE.test(trimmedRaw)) {
    importHint.classList.add("is-url-nudge");
    importHint.innerHTML =
      "That&rsquo;s a share link &mdash; <em>open it, &#8984;A on the conversation, then paste the text back here</em>.";
    importText.focus();
    return false;
  }
  let parsedImport = parseImported(raw);
  let turns = parsedImport.turns;
  let detectedFormat = parsedImport.format || "Generic chat";
  if (shouldUseLLMSegmentation(raw, parsedImport)) {
    const oldHint = importHint.innerHTML;
    importHint.classList.remove("is-url-nudge");
    importHint.innerHTML = "Parsing transcript format with AI...";
    try {
      const llmParsed = await segmentImportedWithLLM(
        raw,
        opts.sourceName || (sourceAI ? sourceAI.value : ""),
      );
      if (llmParsed.turns.length >= 2) {
        turns = llmParsed.turns;
        detectedFormat = llmParsed.format || "LLM segmented";
      }
    } catch (e) {
      if (window.hugEvent)
        hugEvent("import_segmentation_fallback_error", {
          error: String(e && e.message ? e.message : e),
          raw_chars: raw.length,
        });
    } finally {
      importHint.innerHTML = oldHint;
    }
  }
  if (turns.length === 0) {
    importHint.classList.remove("is-url-nudge");
    importHint.innerHTML = "Nothing to load &mdash; paste a chat first.";
    importText.focus();
    return false;
  }

  const { kept, elided } = trimToContext(turns, MAX_TRANSCRIPT_CHARS);

  const sourceName = opts.sourceName || (sourceAI ? sourceAI.value : "AI");

  // Clean canvas, then render kept turns (incl. elided marker) as claim-ready evidence.
  switchMode("chat");
  startNewConversation();
  convo.dataset.sourceAi = sourceName;
  kept.forEach((turn, i) => renderImportedTurn(turn, i, sourceName));

  if (window.hugEvent)
    hugEvent("chat_imported", {
      turn_count: turns.length,
      kept_count: turns.length - elided,
      elided_count: elided,
      raw_chars: raw.length,
      source_ai: sourceName,
      detected_format: detectedFormat,
      sample_title: opts.sampleTitle || null,
    });

  importText.value = "";
  importHint.classList.remove("is-url-nudge");
  importHint.innerHTML =
    elided > 0
      ? `Loaded ${turns.length - elided} of ${turns.length} turns &mdash; ${elided} elided. Detected format: ${detectedFormat}. Ready to submit a claim.`
      : `Loaded ${turns.length} turn${turns.length === 1 ? "" : "s"} from ${sourceName} &mdash; Detected format: ${detectedFormat}. Ready to submit a claim.`;
  renderScore(
    6,
    `${sourceName} chat loaded as claim evidence; submit the exact error on the claim page.`,
  );
  queueConversationSave();
  return true;
}

loadImport.addEventListener("click", async () => {
  if (!loadImport) return;
  const oldText = loadImport.textContent;
  loadImport.disabled = true;
  loadImport.textContent = "Loading...";
  try {
    await loadImportedTranscript(importText.value);
  } finally {
    loadImport.disabled = false;
    loadImport.textContent = oldText;
  }
});

/* ---------- one-time fast cycling sweep on first load ----------
     Briefly highlights each tab so users notice all three modes exist.
     Skips if user has already seen it this session. */
function cycleHint() {
  const order = ["examples", "import", "chat"];
  let i = 0;
  const tick = () => {
    modeTabs.forEach((t) => t.classList.remove("cycling"));
    // Always keep "active" on the chat tab during the sweep.
    const hot = document.querySelector(`.mode-tab[data-mode="${order[i]}"]`);
    if (hot && order[i] !== "chat") hot.classList.add("cycling");
    i++;
    if (i < order.length) setTimeout(tick, 180);
    else
      setTimeout(() => {
        modeTabs.forEach((t) => t.classList.remove("cycling"));
      }, 180);
  };
  setTimeout(tick, 600);
}

/* ---------- init: open on an empty real chat ---------- */
try {
  const user = JSON.parse(localStorage.getItem("hug:user") || "null");
  const accountLink = document.getElementById("accountLink");
  if (accountLink && user && user.signedIn && user.username) {
    accountLink.textContent = user.username;
    accountLink.title = "Demo local profile";
  }
} catch (e) {
  /* localStorage blocked — keep login label */
}

appEl.dataset.mode = "chat";
initChatPersistence();
if (!convo.querySelector(".msg"))
  resetScore("ask a question to size the bounty.");

try {
  if (!sessionStorage.getItem("hug:cycled")) {
    sessionStorage.setItem("hug:cycled", "1");
    cycleHint();
  }
} catch (e) {
  /* sessionStorage blocked — skip cycle */
}
