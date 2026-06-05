const main = document.getElementById("main");
const HUG_API_BASE = (window.HUG_API_BASE || "").replace(/\/+$/, "");
const hugApiUrl = (path) => `${HUG_API_BASE}${path}`;
const data = (() => {
  try {
    return JSON.parse(localStorage.getItem("hug:claim") || "null");
  } catch {
    return null;
  }
})();

if (!data || !data.conversationHtml) {
  main.innerHTML = `
      <div class="empty-state">
        <h1>No claim in progress.</h1>
        <p>Start a chat first, then click <em>submit a claim</em> on the right panel.</p>
        <p style="margin-top:32px;"><a href="/chat.html">&larr; back to chat</a></p>
      </div>
    `;
} else {
  const snap = document.getElementById("snapshot");
  if (data.greetingHtml) {
    const wrap = document.createElement("div");
    wrap.innerHTML = data.greetingHtml;
    if (wrap.firstElementChild) snap.appendChild(wrap.firstElementChild);
  }
  if (data.conversationHtml) {
    const wrap = document.createElement("div");
    wrap.innerHTML = data.conversationHtml;
    Array.from(wrap.children).forEach((c) => snap.appendChild(c));
  }

  function difficultyLevel(label) {
    const value = String(label || "").toLowerCase();
    if (value.includes("hard")) return 3;
    if (value.includes("moderate") || value.includes("medium")) return 2;
    return 1;
  }
  function difficultyName(label) {
    const value = String(label || "").toLowerCase();
    if (value.includes("hard")) return "hard";
    if (value.includes("moderate") || value.includes("medium"))
      return "moderate";
    return "easy";
  }
  function difficultyBlocks(level) {
    return [1, 2, 3]
      .map((i) => `<span class="${i <= level ? "active" : ""}"></span>`)
      .join("");
  }

  const ti = document.getElementById("tierInfo");
  const payout = Number.isFinite(data.payout) ? data.payout : null;
  if (payout && payout > 0) {
    const difficulty = difficultyName(data.verdict);
    const level = difficultyLevel(difficulty);
    ti.innerHTML = `
        <div class="cashback-figure"><span>$</span>${payout}</div>
        <div class="cashback-copy">
          <strong>Paid out if Hug&rsquo;s verdict confirms your correction.</strong>
          <p>${difficulty} question</p>
          <div class="difficulty-meter" aria-label="${difficulty} question difficulty, ${level} of 3">
            <span class="difficulty-label">${difficulty}</span>
            <span class="difficulty-blocks" aria-hidden="true">${difficultyBlocks(level)}</span>
          </div>
        </div>
      `;
  } else {
    ti.classList.add("empty");
    ti.textContent = "no bounty attached. start from the chat first.";
  }

  // Attach inline-edit affordances to every assistant message
  makeAssistantsEditable(snap);
  updateClaimSummary();
}

/* ---------- inline edit: pencil + textarea + live diff preview ---------- */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function tokenize(text) {
  return String(text)
    .split(/(\s+|[^\w\s]+)/)
    .filter((t) => t !== "");
}
function diffWords(a, b) {
  const aw = tokenize(a),
    bw = tokenize(b);
  const m = aw.length,
    n = bw.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aw[i - 1] === bw[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const parts = [];
  let i = m,
    j = n;
  while (i > 0 && j > 0) {
    if (aw[i - 1] === bw[j - 1]) {
      parts.unshift({ type: "eq", text: aw[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      parts.unshift({ type: "del", text: aw[i - 1] });
      i--;
    } else {
      parts.unshift({ type: "ins", text: bw[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    parts.unshift({ type: "del", text: aw[i - 1] });
    i--;
  }
  while (j > 0) {
    parts.unshift({ type: "ins", text: bw[j - 1] });
    j--;
  }
  // coalesce adjacent same-type runs
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.type === p.type) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}
function renderDiff(parts) {
  return parts
    .map((p) => {
      if (p.type === "eq") return escapeHtml(p.text);
      if (p.type === "del")
        return `<s class="struck">${escapeHtml(p.text)}</s>`;
      if (p.type === "ins")
        return `<ins class="correction">${escapeHtml(p.text)}</ins>`;
      return "";
    })
    .join("");
}
function renderDiffPanel(parts, label = "changes marked") {
  return `
      <div class="edit-diff-display" aria-label="${escapeHtml(label)}">
        <strong>${escapeHtml(label)}</strong>
        <div class="diff-body">${renderDiff(parts)}</div>
      </div>
    `;
}
function updateLiveDiff(preview, originalText, editedText) {
  if (!preview) return;
  if (!editedText || editedText.trim() === originalText.trim()) {
    preview.innerHTML =
      '<strong>live changes</strong><div class="diff-body">No changes yet.</div>';
    return;
  }
  preview.innerHTML = `
      <strong>live changes</strong>
      <div class="diff-body">${renderDiff(diffWords(originalText, editedText))}</div>
    `;
}
function showEditedMessage(msg, editedHtml, originalText, editedText) {
  msg.innerHTML = `
      ${renderDiffPanel(diffWords(originalText, editedText))}
      <span class="edited-answer-label">corrected response</span>
      ${editedHtml}
    `;
}
function readableText(el) {
  return (el.innerText || el.textContent || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------- click-to-edit lifecycle (in-place contenteditable) ---------- */
function makeAssistantsEditable(root) {
  root.querySelectorAll(".msg.assistant").forEach((msg) => {
    if (msg.dataset.editInit) return;
    msg.dataset.editInit = "true";
    msg.dataset.originalHtml = msg.innerHTML.trim();
    msg.dataset.originalText = readableText(msg);
    msg.addEventListener("click", () => {
      if (msg.classList.contains("editing")) return;
      enterEdit(msg);
    });
  });
}

function enterEdit(msg) {
  if (msg.classList.contains("editing")) return;

  const originalText = msg.dataset.originalText || readableText(msg);
  const seedHtml =
    msg.dataset.editedHtml || msg.dataset.originalHtml || msg.innerHTML;

  msg.classList.add("editing");
  msg.innerHTML = seedHtml;
  msg.contentEditable = "true";
  msg.focus();
  // place caret at end
  const range = document.createRange();
  range.selectNodeContents(msg);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const toolbar = document.createElement("div");
  toolbar.className = "edit-toolbar";
  toolbar.innerHTML = `
      <button type="button" class="done">Done</button>
      <button type="button" class="cancel">Cancel</button>
      <span class="hint">live diff, autosaves when you click away</span>
    `;
  msg.parentNode.insertBefore(toolbar, msg.nextSibling);

  const preview = document.createElement("div");
  preview.className = "edit-live-preview";
  toolbar.parentNode.insertBefore(preview, toolbar.nextSibling);
  updateLiveDiff(preview, originalText, readableText(msg));

  const inputHandler = () =>
    updateLiveDiff(preview, originalText, readableText(msg));
  msg.addEventListener("input", inputHandler);
  msg._inputHandler = inputHandler;

  // mousedown so the click commits before contenteditable loses focus mid-blur
  toolbar.querySelector(".done").addEventListener("mousedown", (e) => {
    e.preventDefault();
    finishEdit(
      msg,
      toolbar,
      originalText,
      msg.innerHTML,
      readableText(msg),
      preview,
    );
  });
  toolbar.querySelector(".cancel").addEventListener("mousedown", (e) => {
    e.preventDefault();
    cancelEdit(msg, toolbar, preview);
  });
  const blurHandler = (e) => {
    if (toolbar.contains(e.relatedTarget)) return;
    finishEdit(
      msg,
      toolbar,
      originalText,
      msg.innerHTML,
      readableText(msg),
      preview,
    );
  };
  msg.addEventListener("blur", blurHandler);
  msg._blurHandler = blurHandler;

  const escHandler = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit(msg, toolbar, preview);
    }
  };
  msg.addEventListener("keydown", escHandler);
  msg._escHandler = escHandler;
}

function finishEdit(
  msg,
  toolbar,
  originalText,
  editedHtml,
  editedText,
  preview,
) {
  if (msg._escHandler) {
    msg.removeEventListener("keydown", msg._escHandler);
    delete msg._escHandler;
  }
  if (msg._blurHandler) {
    msg.removeEventListener("blur", msg._blurHandler);
    delete msg._blurHandler;
  }
  if (msg._inputHandler) {
    msg.removeEventListener("input", msg._inputHandler);
    delete msg._inputHandler;
  }
  if (toolbar) toolbar.remove();
  if (preview) preview.remove();
  msg.contentEditable = "false";
  msg.classList.remove("editing");

  if (!editedText || editedText.trim() === originalText.trim()) {
    msg.classList.remove("edited");
    delete msg.dataset.editedText;
    delete msg.dataset.editedHtml;
    msg.innerHTML = msg.dataset.originalHtml || msg.innerHTML;
  } else {
    const diff = diffWords(originalText, editedText);
    showEditedMessage(msg, editedHtml, originalText, editedText);
    msg.classList.add("edited");
    msg.dataset.editedText = editedText;
    msg.dataset.editedHtml = editedHtml;
    if (window.hugEvent) {
      const allMsgs = Array.from(
        document.querySelectorAll("#snapshot .msg.assistant"),
      );
      hugEvent("edit_committed", {
        original: originalText,
        edited: editedText,
        diff: diff,
        msg_index: allMsgs.indexOf(msg),
      });
    }
  }
  updateClaimSummary();
}

function cancelEdit(msg, toolbar, preview) {
  if (msg._escHandler) {
    msg.removeEventListener("keydown", msg._escHandler);
    delete msg._escHandler;
  }
  if (msg._blurHandler) {
    msg.removeEventListener("blur", msg._blurHandler);
    delete msg._blurHandler;
  }
  if (msg._inputHandler) {
    msg.removeEventListener("input", msg._inputHandler);
    delete msg._inputHandler;
  }
  if (toolbar) toolbar.remove();
  if (preview) preview.remove();
  msg.contentEditable = "false";
  msg.classList.remove("editing");
  // Restore prior display: existing edits if any, else original HTML
  if (msg.dataset.editedHtml) {
    showEditedMessage(
      msg,
      msg.dataset.editedHtml,
      msg.dataset.originalText || "",
      msg.dataset.editedText || "",
    );
  } else {
    msg.innerHTML = msg.dataset.originalHtml || msg.innerHTML;
  }
}
function attachmentContextForAssistant(msg) {
  const attachments = [];
  let cur = msg ? msg.previousElementSibling : null;
  while (cur && !cur.classList.contains("user"))
    cur = cur.previousElementSibling;
  if (!cur) return attachments;

  cur.querySelectorAll("img.attached-img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!src) return;
    attachments.push({
      type: "image",
      src,
      name: img.getAttribute("alt") || "attached image",
    });
  });

  cur
    .querySelectorAll("a[href], embed[src], iframe[src], object[data]")
    .forEach((node) => {
      const raw =
        node.getAttribute("href") ||
        node.getAttribute("src") ||
        node.getAttribute("data") ||
        "";
      if (!raw) return;
      const label = (
        node.textContent ||
        node.getAttribute("title") ||
        node.getAttribute("aria-label") ||
        raw
      ).trim();
      const looksLikePdf = /\.pdf(?:$|[?#])/i.test(raw) || /pdf/i.test(label);
      if (!looksLikePdf) return;
      attachments.push({
        type: "pdf",
        src: raw,
        name: label || raw.split("/").pop() || "attached PDF",
      });
    });

  return attachments;
}
function gatherEdits() {
  return Array.from(document.querySelectorAll(".msg.assistant.edited"))
    .map((m) => ({
      original: m.dataset.originalText || "",
      edited: m.dataset.editedText || "",
      attachments: attachmentContextForAssistant(m),
    }))
    .filter((e) => e.original && e.edited);
}
function updateClaimSummary() {
  const el = document.getElementById("editsSummary");
  if (!el) return;
  const edits = gatherEdits();
  const n = edits.length;
  if (n === 0) {
    el.classList.remove("has-edits");
    el.classList.remove("expanded");
    el.setAttribute("aria-expanded", "false");
    el.textContent = "no edits yet — click any AI reply above to mark errors.";
  } else {
    el.classList.add("has-edits");
    const details = edits
      .map(
        (edit, i) => `
        <div class="edit-detail">
          <strong>Edit ${i + 1}</strong>
          <p>${renderDiff(diffWords(edit.original, edit.edited))}</p>
        </div>
      `,
      )
      .join("");
    el.innerHTML = `
        <span class="summary-line">${n} edit${n > 1 ? "s" : ""} ready to submit</span>
        <div class="edit-details">${details}</div>
      `;
  }
}
const editsSummaryEl = document.getElementById("editsSummary");
if (editsSummaryEl) {
  const toggleEditSummary = () => {
    if (!editsSummaryEl.classList.contains("has-edits")) return;
    const expanded = editsSummaryEl.classList.toggle("expanded");
    editsSummaryEl.setAttribute("aria-expanded", expanded ? "true" : "false");
    if (window.hugEvent) hugEvent("edit_summary_toggled", { expanded });
  };
  editsSummaryEl.addEventListener("click", toggleEditSummary);
  editsSummaryEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleEditSummary();
    }
  });
}

// Image evidence
const figuresInput = document.getElementById("figures");
const evidenceGrid = document.getElementById("evidenceGrid");
const evidence = [];
if (figuresInput) {
  figuresInput.addEventListener("change", () => {
    for (const f of Array.from(figuresInput.files)) {
      if (!f.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        evidence.push({ name: f.name, dataUrl: String(reader.result) });
        renderEvidence();
        if (window.hugEvent)
          hugEvent("evidence_attached", {
            filename: f.name,
            size: f.size,
            mime: f.type,
          });
      };
      reader.readAsDataURL(f);
    }
    figuresInput.value = "";
  });
}
function renderEvidence() {
  evidenceGrid.innerHTML = "";
  evidence.forEach((e, i) => {
    const t = document.createElement("div");
    t.className = "ev-thumb";
    const img = document.createElement("img");
    img.src = e.dataUrl;
    img.alt = e.name;
    t.appendChild(img);
    const x = document.createElement("button");
    x.className = "x";
    x.type = "button";
    x.textContent = "×";
    x.setAttribute("aria-label", "Remove figure");
    x.addEventListener("click", () => {
      evidence.splice(i, 1);
      renderEvidence();
    });
    t.appendChild(x);
    evidenceGrid.appendChild(t);
  });
}

// ---------- Response LLM selector ----------
const responseLLMInput = document.getElementById("responseLLM");
const responseLLMValue = document.getElementById("responseLLMValue");
const responseLLMPicker = document.getElementById("responseLLMPicker");
const responseLLMButton = document.getElementById("responseLLMButton");
const responseLLMOptions = document.getElementById("responseLLMOptions");
const responseLLMNote = document.getElementById("responseLLMNote");
const detectLLMBtn = document.getElementById("detectLLMBtn");
const LLM_OPTIONS = [
  "Claude Opus 4.8",
  "GPT 5.5",
  "GPT Codex 5.3",
  "Gemini 3.5 Pro",
];

function normalizeLLMName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const low = raw.toLowerCase();
  if (low.includes("claude") && low.includes("opus")) return "Claude Opus 4.8";
  if (low.includes("claude")) return "Claude Opus 4.8";
  if (low.includes("gpt") && low.includes("codex")) return "GPT Codex 5.3";
  if (low.includes("gpt-codex")) return "GPT Codex 5.3";
  if (low.includes("gpt") || low.includes("chatgpt") || low.includes("openai"))
    return "GPT 5.5";
  if (low.includes("gemini")) return "Gemini 3.5 Pro";
  return LLM_OPTIONS.includes(raw) ? raw : "";
}

function selectedResponseLLM() {
  return (responseLLMInput && responseLLMInput.value) || "AI";
}

function setResponseLLM(name, { detected = false, reason = "" } = {}) {
  const label = normalizeLLMName(name);
  if (responseLLMInput) responseLLMInput.value = label;
  if (responseLLMValue)
    responseLLMValue.textContent = label || "Choose response LLM";
  if (brandCycle && label)
    brandCycle.textContent = label.replace(/\s+\d.*$/, "") || label;
  if (responseLLMOptions) {
    responseLLMOptions.querySelectorAll('[role="option"]').forEach((btn) => {
      btn.setAttribute(
        "aria-selected",
        btn.dataset.value === label ? "true" : "false",
      );
    });
  }
  if (responseLLMNote) {
    if (!label) {
      responseLLMNote.textContent = detected
        ? `Could not map detected model to the 4 eligible options${reason ? ` — ${reason}` : ""}. Please choose one manually.`
        : "Select one of the 4 eligible models.";
    } else {
      responseLLMNote.textContent = detected
        ? `Auto-detected ${label}${reason ? ` — ${reason}` : ""}.`
        : `Selected ${label} as the AI that made the response.`;
    }
  }
  if (window.hugEvent && label) {
    hugEvent(
      detected ? "response_llm_detected_selected" : "response_llm_selected",
      {
        llm: label,
        reason,
      },
    );
  }
}

function heuristicDetectLLM(text) {
  const low = String(text || "").toLowerCase();
  return normalizeLLMName(low);
}

if (responseLLMOptions) {
  responseLLMOptions.innerHTML = LLM_OPTIONS.map(
    (name) =>
      `<button type="button" role="option" data-value="${escapeHtml(name)}" aria-selected="false">${escapeHtml(name)}</button>`,
  ).join("");
}
if (responseLLMButton && responseLLMPicker) {
  responseLLMButton.addEventListener("click", () => {
    const open = !responseLLMPicker.classList.contains("open");
    responseLLMPicker.classList.toggle("open", open);
    responseLLMButton.setAttribute("aria-expanded", open ? "true" : "false");
  });
}
if (responseLLMOptions && responseLLMPicker) {
  responseLLMOptions.addEventListener("click", (e) => {
    const opt = e.target.closest('[role="option"]');
    if (!opt) return;
    setResponseLLM(opt.dataset.value || opt.textContent);
    responseLLMPicker.classList.remove("open");
    responseLLMButton.setAttribute("aria-expanded", "false");
  });
}
document.addEventListener("click", (e) => {
  if (responseLLMPicker && !responseLLMPicker.contains(e.target)) {
    responseLLMPicker.classList.remove("open");
    if (responseLLMButton)
      responseLLMButton.setAttribute("aria-expanded", "false");
  }
});
if (detectLLMBtn) {
  detectLLMBtn.addEventListener("click", async () => {
    const original = detectLLMBtn.textContent;
    const conversation = extractConversationText();
    detectLLMBtn.disabled = true;
    detectLLMBtn.textContent = "Detecting";
    try {
      const resp = await fetch(hugApiUrl("/detect_llm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation,
          session_id: window.HUG_SESSION_ID || null,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const result = await resp.json();
      setResponseLLM(result.llm, {
        detected: true,
        reason: result.reason || "",
      });
    } catch (err) {
      const fallback = heuristicDetectLLM(conversation) || "";
      setResponseLLM(fallback, {
        detected: true,
        reason: "backend unavailable; used transcript labels",
      });
    } finally {
      detectLLMBtn.disabled = false;
      detectLLMBtn.textContent = original;
    }
  });
}

// ---------- Cycling LLM brand in the H1 ----------
const brandCycle = document.getElementById("brandCycle");
const BRANDS = ["GPT", "Claude", "Gemini"];
let brandIdx = 0;
let brandTimer = null;
if (brandCycle) {
  brandTimer = setInterval(() => {
    if (responseLLMInput && responseLLMInput.value) return;
    brandCycle.classList.add("fading");
    setTimeout(() => {
      if (responseLLMInput && responseLLMInput.value) {
        brandCycle.classList.remove("fading");
        return;
      }
      brandIdx = (brandIdx + 1) % BRANDS.length;
      brandCycle.textContent = BRANDS[brandIdx];
      brandCycle.classList.remove("fading");
    }, 280);
  }, 2200);
}
if (data && data.responseLLM) {
  setResponseLLM(data.responseLLM, {
    detected: true,
    reason: "loaded from imported chat metadata",
  });
}

// ---------- Share links ----------
const FORUM_POSTS_KEY = "hug:forum:posts";
function shareText() {
  const brand = selectedResponseLLM();
  return `I filed a HugClaims correction for ${brand} errors.`;
}
function shareUrl() {
  return `${location.origin}${location.pathname}`;
}
function wireShareLinks() {
  document.querySelectorAll("[data-share]").forEach((link) => {
    if (link.dataset.shareWired) return;
    link.dataset.shareWired = "true";
    const target = link.dataset.share;
    const text = shareText();
    const url = shareUrl();
    let href = "/forum.html";
    if (target === "reddit") {
      href = `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`;
    } else if (target === "facebook") {
      href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    } else if (target === "x") {
      href = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    } else if (target === "whatsapp") {
      href = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
    }
    link.href = href;
    link.addEventListener("click", (e) => {
      if (target === "forum" && window._latestForumClaim) {
        e.preventDefault();
        openForumShareModal(window._latestForumClaim);
        return;
      }
      if (window.hugEvent) hugEvent("claim_share_clicked", { target });
    });
  });
}
wireShareLinks();

function successShareMarkup() {
  return `
      <span class="share-links" aria-label="Share submitted claim">
        <a class="share-icon" data-share="forum" href="/forum.html" aria-label="Post to HugClaims forum" title="Post to HugClaims forum">
          <span class="forum-mark">H</span>
        </a>
        <a class="share-icon" data-share="reddit" target="_blank" rel="noopener" aria-label="Share to Reddit" title="Share to Reddit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 12.3a2.6 2.6 0 0 0-1.7-.7 2.2 2.2 0 0 0-.6 4.3 5.9 5.9 0 0 0 5.8 4.1h4a5.9 5.9 0 0 0 5.8-4.1 2.2 2.2 0 0 0-.6-4.3 2.6 2.6 0 0 0-1.7.7"/><path d="M13 7.2 14.2 3l4.1.9"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M9.8 17c1.4.8 3 .8 4.4 0"/></svg>
        </a>
        <a class="share-icon" data-share="facebook" target="_blank" rel="noopener" aria-label="Share to Facebook" title="Share to Facebook">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 8.4V6.7c0-.8.2-1.2 1.3-1.2H17V2.3c-.8-.1-1.7-.2-2.5-.2-2.5 0-4.2 1.5-4.2 4.3v2H7.5V12h2.8v9.8H14V12h2.8l.4-3.6H14Z"/></svg>
        </a>
        <a class="share-icon" data-share="x" target="_blank" rel="noopener" aria-label="Share to X" title="Share to X">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.3 3h3.4l-7.4 8.5L22 21h-6.8l-5.3-6.9L3.8 21H.4l7.9-9L0 3h7l4.8 6.3L17.3 3Zm-1.2 16.3H18L6 4.6H4L16.1 19.3Z"/></svg>
        </a>
        <a class="share-icon" data-share="whatsapp" target="_blank" rel="noopener" aria-label="Share to WhatsApp" title="Share to WhatsApp">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.8 19.2 6 15.8a7.8 7.8 0 1 1 2.5 2.4l-3.7 1Z"/><path d="M9.4 8.8c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.5 1.2c.1.3.1.5-.1.7l-.4.5c.6 1.1 1.4 1.9 2.5 2.5l.5-.4c.2-.2.4-.2.7-.1l1.2.5c.3.1.4.3.4.5v.5c0 .3-.1.5-.4.7-.5.3-1.3.4-2.1.2-2.6-.7-4.6-2.7-5.3-5.3-.2-.8-.1-1.6.2-2.1Z"/></svg>
        </a>
      </span>
    `;
}

function inferForumDomain(edits) {
  const text = edits
    .map((e) => `${e.original}\n${e.edited}`)
    .join("\n")
    .toLowerCase();
  if (
    /\b(integral|proof|theorem|matrix|algebra|calculus|equation|rag|faithfulness|retrieval)\b/.test(
      text,
    )
  )
    return "math";
  if (
    /\b(contract|lease|civil code|statute|court|legal|landlord|tenant)\b/.test(
      text,
    )
  )
    return "legal";
  if (
    /\b(stock|earnings|revenue|market|portfolio|finance|cash flow)\b/.test(text)
  )
    return "finance";
  if (/\b(diagnosis|doctor|medicine|clinical|dose|symptom)\b/.test(text))
    return "medicine";
  return "math";
}

function forumTitleFromClaim(claim) {
  const first = claim.edits[0] || {};
  const source = (first.original || first.edited || "AI response")
    .replace(/\s+/g, " ")
    .trim();
  const clipped = source.length > 72 ? `${source.slice(0, 69)}...` : source;
  return `${claim.brand || "AI"} correction: ${clipped}`;
}

function forumContextFromClaim(claim) {
  const edits = claim.edits || [];
  const pieces = [
    `Posted from claim ${claim.ref || "HUG"} for community review.`,
  ];
  if (edits.length > 1)
    pieces.push(
      `${edits.length} edited AI responses are included in the submitted claim.`,
    );
  if (claim.evidenceItems && claim.evidenceItems.length) {
    pieces.push(
      `${claim.evidenceItems.length} evidence item${claim.evidenceItems.length > 1 ? "s are" : " is"} attached in the claim PDF.`,
    );
  }
  pieces.push(
    "Looking for public engagement on whether this is a real AI error and what source should resolve it.",
  );
  return pieces.join(" ");
}

function buildForumPostFromClaim(claim) {
  return {
    id: `local-${Date.now()}`,
    ref: claim.ref,
    title: forumTitleFromClaim(claim),
    brand: claim.brand || "AI",
    domain: inferForumDomain(claim.edits || []),
    payout: claim.expectedPayout || 0,
    edits: (claim.edits || []).map((edit) => ({
      original: edit.original || "",
      edited: edit.edited || "",
    })),
    context: forumContextFromClaim(claim),
    evidenceCount: claim.evidenceItems ? claim.evidenceItems.length : 0,
    createdAt: new Date().toISOString(),
  };
}

function forumPostFromTemplate(basePost) {
  const titleEl = document.getElementById("forumSharePostTitle");
  const originalEl = document.getElementById("forumShareOriginal");
  const correctionEl = document.getElementById("forumShareCorrection");
  const contextEl = document.getElementById("forumShareContext");
  const first = (basePost.edits && basePost.edits[0]) || {
    original: "",
    edited: "",
  };
  return {
    ...basePost,
    title: titleEl.value.trim() || basePost.title,
    context: contextEl.value.trim() || basePost.context,
    edits: [
      {
        original: originalEl.value.trim() || first.original,
        edited: correctionEl.value.trim() || first.edited,
      },
      ...(basePost.edits || []).slice(1),
    ],
  };
}

function publishClaimToForum(post) {
  try {
    const existing = JSON.parse(localStorage.getItem(FORUM_POSTS_KEY) || "[]");
    const items = Array.isArray(existing) ? existing : [];
    items.unshift(post);
    localStorage.setItem(FORUM_POSTS_KEY, JSON.stringify(items.slice(0, 12)));
    if (window.hugEvent)
      hugEvent("claim_posted_to_forum", {
        ref: post.ref,
        domain: post.domain,
        edit_count: post.edits.length,
      });
    window.location.href = "/forum.html?posted=1";
  } catch (err) {
    console.warn("forum post save failed:", err);
    alert(
      "Could not create the forum post locally. Try exporting or printing the claim first.",
    );
  }
}

let pendingForumPost = null;
function setForumTemplateReadonly(isReadonly) {
  [
    "forumSharePostTitle",
    "forumShareOriginal",
    "forumShareCorrection",
    "forumShareContext",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.readOnly = isReadonly;
  });
}
function openForumShareModal(claim) {
  pendingForumPost = buildForumPostFromClaim(claim);
  const first = (pendingForumPost.edits && pendingForumPost.edits[0]) || {};
  document.getElementById("forumSharePostTitle").value =
    pendingForumPost.title || "";
  document.getElementById("forumShareOriginal").value = first.original || "";
  document.getElementById("forumShareCorrection").value = first.edited || "";
  document.getElementById("forumShareContext").value =
    pendingForumPost.context || "";
  document.getElementById("forumSharePublicOk").checked = false;
  document.getElementById("forumSharePrivacyOk").checked = false;
  document.getElementById("forumShareError").classList.remove("show");
  setForumTemplateReadonly(true);
  document.getElementById("forumShareModal").classList.add("open");
  document.body.style.overflow = "hidden";
  if (window.hugEvent)
    hugEvent("forum_share_template_opened", {
      ref: pendingForumPost.ref,
      edit_count: pendingForumPost.edits.length,
    });
}

function printAttachmentMarkup(items) {
  if (!items || !items.length) return "";
  return `
      <h3>Multimodal context</h3>
      <div class="print-attachments">
        ${items
          .map((item) => {
            if (item.type === "image") {
              return `<img class="print-attachment-img" src="${escapeHtml(item.src)}" alt="${escapeHtml(item.name || "attached image")}" />`;
            }
            return `
            <div class="print-pdf-frame">
              <a class="print-doc" href="${escapeHtml(item.src)}">${escapeHtml(item.name || item.src)}</a>
              <object data="${escapeHtml(item.src)}" type="application/pdf">
                <a class="print-doc" href="${escapeHtml(item.src)}">${escapeHtml(item.name || item.src)}</a>
              </object>
            </div>
          `;
          })
          .join("")}
      </div>
    `;
}

function buildPrintReport({
  ref,
  brand,
  edits,
  evidenceItems,
  expectedPayout,
  overrodeVerifier,
}) {
  const renderOriginalWithDeletes = (original, edited) => {
    const parts = diffWords(original || "", edited || "");
    return parts
      .map((part) => {
        if (part.type === "ins") return "";
        if (part.type === "del")
          return `<span class="print-del">${escapeHtml(part.text)}</span>`;
        return escapeHtml(part.text);
      })
      .join("");
  };
  const renderCorrectionWithAdds = (original, edited) => {
    const parts = diffWords(original || "", edited || "");
    return parts
      .map((part) => {
        if (part.type === "del") return "";
        if (part.type === "ins")
          return `<span class="print-add">${escapeHtml(part.text)}</span>`;
        return escapeHtml(part.text);
      })
      .join("");
  };
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const editBlocks = edits
    .map(
      (edit, idx) => `
      <section class="print-edit">
        <h2>Edit ${idx + 1}</h2>
        ${printAttachmentMarkup(edit.attachments)}
        <div class="print-columns">
          <div>
            <h3>Original AI response</h3>
            <div class="print-box">${renderOriginalWithDeletes(edit.original, edit.edited)}</div>
          </div>
          <div>
            <h3>Submitted correction</h3>
            <div class="print-box">${renderCorrectionWithAdds(edit.original, edit.edited)}</div>
          </div>
        </div>
      </section>
    `,
    )
    .join("");
  const evidenceBlock =
    evidenceItems && evidenceItems.length
      ? `
      <section class="print-edit">
        <h2>Evidence attached to claim</h2>
        ${printAttachmentMarkup(
          evidenceItems.map((item) => ({
            type: "image",
            src: item.dataUrl,
            name: item.name,
          })),
        )}
      </section>
    `
      : "";
  return `
      <article class="print-report" id="printReport">
        <div class="print-kicker">HugClaims submitted claim</div>
        <h1>Original vs. submitted correction</h1>
        <div class="print-meta">
          <div><strong>Claim ID</strong><span>${escapeHtml(ref)}</span></div>
          <div><strong>Filed against</strong><span>${escapeHtml(brand || "AI")}</span></div>
          <div><strong>Expected cash back</strong><span>$${escapeHtml(expectedPayout || 0)}</span></div>
          <div><strong>Date</strong><span>${escapeHtml(today)}</span></div>
        </div>
        ${editBlocks || '<section class="print-edit"><h2>No edits submitted</h2></section>'}
        ${evidenceBlock}
        <p class="print-note">
          This printout records the claim as submitted. Red highlights in Original AI response mark deleted wording; gold highlights in Submitted correction mark added wording.${overrodeVerifier ? " The claim was flagged for human review because the verifier disagreed." : ""}
        </p>
      </article>
    `;
}

function wirePrintButton(claim) {
  const btn = document.getElementById("printClaimBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const existing = document.getElementById("printReport");
    if (existing) existing.remove();
    document.body.insertAdjacentHTML("beforeend", buildPrintReport(claim));
    if (window.hugEvent)
      hugEvent("claim_print_clicked", {
        ref: claim.ref,
        edit_count: claim.edits.length,
      });
    window.print();
  });
}

const forumShareModal = document.getElementById("forumShareModal");
const forumShareCancel = document.getElementById("forumShareCancel");
const forumShareEdit = document.getElementById("forumShareEdit");
const forumShareOk = document.getElementById("forumShareOk");
function closeForumShareModal() {
  if (!forumShareModal) return;
  forumShareModal.classList.remove("open");
  document.body.style.overflow = "";
}
if (forumShareCancel)
  forumShareCancel.addEventListener("click", closeForumShareModal);
if (forumShareEdit) {
  forumShareEdit.addEventListener("click", () => {
    setForumTemplateReadonly(false);
    const firstEditable = document.getElementById("forumSharePostTitle");
    if (firstEditable) firstEditable.focus();
    if (window.hugEvent)
      hugEvent("forum_share_template_editing", {
        ref: pendingForumPost ? pendingForumPost.ref : null,
      });
  });
}
if (forumShareOk) {
  forumShareOk.addEventListener("click", () => {
    const publicOk = document.getElementById("forumSharePublicOk").checked;
    const privacyOk = document.getElementById("forumSharePrivacyOk").checked;
    const errorEl = document.getElementById("forumShareError");
    if (!publicOk || !privacyOk) {
      if (errorEl) errorEl.classList.add("show");
      return;
    }
    if (!pendingForumPost) return;
    publishClaimToForum(forumPostFromTemplate(pendingForumPost));
  });
}
if (forumShareModal) {
  forumShareModal.addEventListener("click", (e) => {
    if (e.target === forumShareModal) closeForumShareModal();
  });
}

// Lightbox
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

// ---------- LLM Verifier ----------
function extractConversationText() {
  const snap = document.getElementById("snapshot");
  if (!snap) return "";
  const turns = Array.from(snap.querySelectorAll(".msg"));
  const greet = snap.querySelector(".greeting");
  const lines = [];
  if (greet) lines.push(`[GREETING] ${greet.textContent.trim()}`);
  turns.forEach((t) => {
    const role = t.classList.contains("user") ? "USER" : "ASSISTANT";
    const hasImg = t.querySelector("img.attached-img")
      ? " (image attached)"
      : "";
    lines.push(`[${role}${hasImg}] ${t.textContent.trim()}`);
  });
  return lines.join("\n\n");
}

// Latest verifier result — null if user hasn't run the verifier yet.
let _lastVerdict = null;

function showVerdict(data) {
  _lastVerdict = data; // remember for the submit-confirm guard
  const el = document.getElementById("verdict");
  const v = ["valid", "invalid", "uncertain"].includes(data.verdict)
    ? data.verdict
    : "uncertain";
  const icons = { valid: "✓", invalid: "✗", uncertain: "?" };
  const labels = {
    valid: "claim holds",
    invalid: "claim does not hold",
    uncertain: "unclear",
  };
  el.className = `verdict show v-${v}`;
  const conf = Math.round((data.confidence || 0) * 100);
  el.innerHTML = `
      <div class="verdict-head">
        <span class="icon">${icons[v]}</span>
        <strong>${labels[v]}</strong>
        <span class="conf">${conf}% confidence &middot; Haiku 4.5</span>
      </div>
      <div class="verdict-reason">${(data.reasoning || "no reasoning provided.").replace(/</g, "&lt;")}</div>
    `;
}

function prettyVerifierError(resp, bodyText) {
  const status = resp && Number.isFinite(resp.status) ? resp.status : 0;
  const text = String(bodyText || "").trim();
  const lower = text.toLowerCase();
  const contentType = String(
    resp && resp.headers ? resp.headers.get("content-type") || "" : "",
  ).toLowerCase();
  const isHtml =
    contentType.includes("text/html") || /<!doctype html>|<html\b/.test(lower);
  const isStaticServer =
    /simplehttp\/|unsupported method \('post'\)|error code:\s*501/.test(lower);

  if (isHtml && (status === 501 || isStaticServer)) {
    return `Backend not running (got HTML/${status || 501} from static server). Start FastAPI server (./run.sh) instead of python -m http.server.`;
  }
  if (isHtml) {
    return `Backend returned HTML/${status || "error"} instead of JSON. Check API base and server route.`;
  }
  if (status === 401)
    return "Verifier auth error (401): check ANTHROPIC_API_KEY on backend.";
  if (status === 404)
    return "Verifier endpoint not found (404): backend route /verify_claim is unavailable.";
  if (status >= 500) return `Verifier backend error (${status}).`;
  if (text)
    return `Verifier API error (${status || "unknown"}): ${text.slice(0, 220)}`;
  return `Verifier API error (${status || "unknown"}).`;
}

const verifyBtn = document.getElementById("verifyBtn");
if (verifyBtn) {
  verifyBtn.addEventListener("click", async () => {
    const edits = gatherEdits();
    if (edits.length === 0) {
      alert(
        "Edit at least one AI reply before running the verifier — click ✎ edit on any assistant message.",
      );
      return;
    }
    const conversation = extractConversationText();
    const claimedError = edits
      .map((e, i) => `[ORIGINAL ${i + 1}]\n${e.original}`)
      .join("\n\n");
    const correctAnswer = edits
      .map((e, i) => `[USER'S CORRECTION ${i + 1}]\n${e.edited}`)
      .join("\n\n");
    const original = verifyBtn.innerHTML;
    verifyBtn.disabled = true;
    verifyBtn.innerHTML =
      '<span class="vicon">&#x2696;</span> verifying&hellip;';
    if (window.hugEvent)
      hugEvent("verifier_called", {
        edit_count: edits.length,
        conversation_length: conversation.length,
      });
    try {
      const resp = await fetch(hugApiUrl("/verify_claim"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation,
          claimed_error: claimedError,
          correct_answer: correctAnswer,
          session_id: window.HUG_SESSION_ID || null,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        showVerdict({
          verdict: "uncertain",
          confidence: 0,
          reasoning: prettyVerifierError(resp, txt),
        });
        return;
      }
      const data = await resp.json();
      showVerdict(data);
    } catch (e) {
      showVerdict({
        verdict: "uncertain",
        confidence: 0,
        reasoning: "connection error: " + e.message,
      });
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = original;
    }
  });
}

// Mock submit — routes through a confirm modal when the verifier said "invalid".
const submitBtn = document.getElementById("submitBtn");
const HUG_USER_KEY = "hug:user";
const CLAIM_DAILY_LIMIT = 15;
const CLAIM_DAILY_COUNT_KEY = "hug:claim:daily-counts";

function todayLocalDateKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function activeClaimUserId() {
  try {
    const user = JSON.parse(localStorage.getItem(HUG_USER_KEY) || "null");
    if (user && user.signedIn) return user.username || user.id || "signed-user";
  } catch (err) {}
  return "guest";
}

function readDailyClaimCounts() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(CLAIM_DAILY_COUNT_KEY) || "{}",
    );
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeDailyClaimCounts(counts) {
  try {
    localStorage.setItem(CLAIM_DAILY_COUNT_KEY, JSON.stringify(counts));
  } catch (err) {
    console.warn("Could not persist daily claim counts:", err);
  }
}

function dailyClaimBucketKey() {
  return `${todayLocalDateKey()}:${activeClaimUserId()}`;
}

function currentDailyClaimCount() {
  const counts = readDailyClaimCounts();
  return Number(counts[dailyClaimBucketKey()] || 0);
}

function incrementDailyClaimCount() {
  const counts = readDailyClaimCounts();
  const key = dailyClaimBucketKey();
  const next = Number(counts[key] || 0) + 1;
  counts[key] = next;
  writeDailyClaimCounts(counts);
  return next;
}

function performSubmit({ overrodeVerifier = false } = {}) {
  const edits = gatherEdits();
  const ref = "HUG-" + Math.random().toString(36).slice(2, 8).toUpperCase();
  const brand = selectedResponseLLM();
  const expectedPayout =
    data && Number.isFinite(data.payout) && data.payout > 0 ? data.payout : 0;
  const editAttachmentCount = edits.reduce(
    (sum, edit) => sum + ((edit.attachments && edit.attachments.length) || 0),
    0,
  );
  console.log("[hug] mock claim submitted", {
    ref,
    brand,
    editCount: edits.length,
    editAttachmentCount,
    evidenceCount: evidence.length,
    expectedPayout,
    overrodeVerifier,
  });
  if (window.hugEvent)
    hugEvent("claim_submitted", {
      ref,
      brand,
      edits: edits.map((edit) => ({
        original: edit.original,
        edited: edit.edited,
        attachment_count: (edit.attachments && edit.attachments.length) || 0,
      })),
      evidence_count: evidence.length,
      evidence_filenames: evidence.map((e) => e.name),
      expected_payout: expectedPayout,
      chat_payout: (data && data.payout) || null,
      chat_verdict: (data && data.verdict) || null,
      verifier_verdict: _lastVerdict ? _lastVerdict.verdict : null,
      verifier_confidence: _lastVerdict ? _lastVerdict.confidence : null,
      overrode_verifier: overrodeVerifier,
    });
  const overrideLine = overrodeVerifier
    ? `<p style="margin-top:8px;font-family:var(--serif);font-style:italic;color:var(--hug-2);font-size:13px;">flagged for human review &mdash; verifier disagreed.</p>`
    : "";
  main.innerHTML = `
      <div class="empty-state">
        <h1>Cash back coming.</h1>
        <div class="cashback-amount">$${expectedPayout || 0}</div>
        <p class="cashback-sub">expected back if your edits hold up</p>
        <p>Filed against <em>${brand || "AI"}</em> &middot; <em>${edits.length} edit${edits.length > 1 ? "s" : ""}</em> &middot; verdict in <em>24h</em>.</p>
        ${overrideLine}
        <p class="ref">${ref}</p>
        <div class="claim-success-actions">
          ${successShareMarkup()}
          <button class="print-claim-btn" id="printClaimBtn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>
            Print PDF
          </button>
        </div>
        <p style="margin-top:28px;"><a href="/chat.html">&larr; back to chat</a></p>
      </div>
    `;
  const claimPackage = {
    ref,
    brand,
    edits,
    evidenceItems: evidence.slice(),
    expectedPayout,
    overrodeVerifier,
  };
  window._latestForumClaim = claimPackage;
  wireShareLinks();
  wirePrintButton(claimPackage);
  incrementDailyClaimCount();
  localStorage.removeItem("hug:claim");
}

// Confirm-modal wiring (only relevant when the verifier disagreed)
const confirmModal = document.getElementById("confirmModal");
const confirmReason = document.getElementById("confirmReason");
const confirmYes = document.getElementById("confirmYes");
const confirmBack = document.getElementById("confirmBack");

function openConfirmModal() {
  if (_lastVerdict && _lastVerdict.reasoning) {
    confirmReason.textContent = _lastVerdict.reasoning;
    confirmReason.classList.add("has-reason");
  } else {
    confirmReason.classList.remove("has-reason");
  }
  confirmModal.classList.add("open");
  document.body.style.overflow = "hidden";
  if (window.hugEvent)
    hugEvent("submit_confirm_shown", {
      verifier_verdict: _lastVerdict ? _lastVerdict.verdict : null,
      verifier_confidence: _lastVerdict ? _lastVerdict.confidence : null,
    });
}
function closeConfirmModal() {
  confirmModal.classList.remove("open");
  document.body.style.overflow = "";
}
confirmBack.addEventListener("click", () => {
  closeConfirmModal();
  if (window.hugEvent) hugEvent("submit_confirm_dismissed", {});
});
confirmYes.addEventListener("click", () => {
  closeConfirmModal();
  performSubmit({ overrodeVerifier: true });
});
confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) closeConfirmModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && confirmModal.classList.contains("open"))
    closeConfirmModal();
  if (
    e.key === "Escape" &&
    forumShareModal &&
    forumShareModal.classList.contains("open")
  )
    closeForumShareModal();
});

if (submitBtn) {
  submitBtn.addEventListener("click", () => {
    const usedToday = currentDailyClaimCount();
    if (usedToday >= CLAIM_DAILY_LIMIT) {
      alert(
        "Daily limit reached: 15 claims per account per day. Please try again tomorrow.",
      );
      if (window.hugEvent)
        hugEvent("claim_daily_limit_blocked", {
          limit: CLAIM_DAILY_LIMIT,
          used_today: usedToday,
          user: activeClaimUserId(),
        });
      return;
    }
    const edits = gatherEdits();
    if (edits.length === 0) {
      alert(
        "Mark at least one error in the conversation above before submitting — click ✎ edit on any AI reply.",
      );
      return;
    }
    // Guard: if the verifier said the user's edits don't hold, double-check intent.
    if (_lastVerdict && _lastVerdict.verdict === "invalid") {
      openConfirmModal();
      return;
    }
    performSubmit({ overrodeVerifier: false });
  });
}
