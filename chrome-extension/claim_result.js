function readQuery() {
  const params = new URLSearchParams(window.location.search || "");
  return {
    claimId: (params.get("claim_id") || "").trim(),
    amount: (params.get("credit_amount") || "0").trim()
  };
}

function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(Math.max(0, Math.round(n)));
}

async function readClaimContext() {
  const data = await chrome.storage.local.get(["hug_last_claim_context"]);
  return data.hug_last_claim_context || null;
}

async function apiPost(backendUrl, path, body) {
  const resp = await chrome.runtime.sendMessage({
    type: "HUG_API_CALL",
    backend_url: String(backendUrl || "").trim(),
    path,
    method: "POST",
    body
  });
  if (!resp || !resp.ok) {
    throw new Error((resp && resp.text) || `Request failed (${(resp && resp.status) || 0})`);
  }
  const ct = String(resp.content_type || "").toLowerCase();
  if (!ct.includes("application/json")) {
    throw new Error("Non-JSON response from backend.");
  }
  return JSON.parse(resp.text || "{}");
}

const el = {
  amountValue: document.getElementById("amountValue"),
  claimLine: document.getElementById("claimLine"),
  payStripe: document.getElementById("payStripe"),
  redactStatus: document.getElementById("redactStatus"),
  redactRisk: document.getElementById("redactRisk"),
  redactionEmpty: document.getElementById("redactionEmpty"),
  redactionList: document.getElementById("redactionList"),
  redactedText: document.getElementById("redactedText"),
  backBtn: document.getElementById("backBtn")
};

const data = readQuery();
el.amountValue.textContent = normalizeAmount(data.amount);
el.claimLine.textContent = data.claimId ? `Claim ID: ${data.claimId}` : "Claim ID: -";

const PAYMENT_URL = "https://yuexinghao.github.io/HugClaims.ai/payment.html";
if (el.payStripe) {
  const u = new URL(PAYMENT_URL);
  u.searchParams.set("method", "stripe");
  el.payStripe.href = u.toString();
  el.payStripe.target = "_blank";
  el.payStripe.rel = "noopener noreferrer";
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadRedactionPreview() {
  try {
    const ctx = await readClaimContext();
    if (!ctx || !ctx.backend_url || !ctx.transcript) {
      el.redactStatus.textContent = "No transcript context found for auto-redaction preview.";
      return;
    }
    const redacted = await apiPost(ctx.backend_url, "/redact_for_share", {
      transcript: String(ctx.transcript || ""),
      source_ai: String(ctx.source_ai || "Other/Unknown"),
      user_note: String(ctx.user_note || ""),
      session_id: String(ctx.session_id || "")
    });
    const text = String(redacted.redacted_text || "").trim();
    const risk = String(redacted.risk_level || "low").toUpperCase();
    if (text) {
      el.redactedText.value = text;
      el.redactedText.classList.remove("hidden");
    }
    el.redactionList.innerHTML = "";
    const items = Array.isArray(redacted.redactions) ? redacted.redactions : [];
    el.redactionEmpty.classList.toggle("hidden", items.length > 0);
    items.forEach((item) => {
      const li = document.createElement("li");
      const original = String(item && item.original || "").trim();
      const replacement = String(item && item.replacement || "").trim() || "[REDACTED:OTHER]";
      li.innerHTML = `<del>${escapeHtml(original)}</del> \u2192 <code>${escapeHtml(replacement)}</code>`;
      el.redactionList.appendChild(li);
    });
    el.redactRisk.textContent = `Risk: ${risk}`;
    el.redactRisk.classList.remove("hidden");
    if (items.length > 0) {
      el.redactStatus.textContent = `Personal information detected and redacted (${items.length}).`;
    } else {
      el.redactStatus.textContent = "No sensitive personal information detected.";
    }
  } catch (err) {
    el.redactStatus.textContent = `Redaction preview unavailable: ${String((err && err.message) || err || "unknown error")}`;
  }
}

loadRedactionPreview();

el.backBtn.addEventListener("click", () => {
  window.location.href = "popup.html";
});
