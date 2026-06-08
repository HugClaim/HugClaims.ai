/* ---------- Live community stats ---------- */
const SHARED_VERIFIED_TOTAL_KEY = "hugClaimsSharedVerifiedTotal";
const SHARED_VERIFIED_HEARTBEAT_KEY = "hugClaimsSharedVerifiedHeartbeat";
const SHARED_VERIFIED_MIN = 40745;
function parsePositiveInt(value) {
  const parsed = Number.parseInt(
    String(value || "").replace(/[^\d]/g, ""),
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function ensureSharedVerifiedTotal() {
  let parsed = null;
  try {
    parsed = parsePositiveInt(
      window.localStorage.getItem(SHARED_VERIFIED_TOTAL_KEY) || "",
    );
  } catch (_) {}
  if (parsed !== null && parsed >= SHARED_VERIFIED_MIN) return parsed;
  try {
    window.localStorage.setItem(
      SHARED_VERIFIED_TOTAL_KEY,
      String(SHARED_VERIFIED_MIN),
    );
    window.localStorage.setItem(
      SHARED_VERIFIED_HEARTBEAT_KEY,
      String(Date.now()),
    );
  } catch (_) {}
  return SHARED_VERIFIED_MIN;
}
function readSharedVerifiedTotal(fallback = SHARED_VERIFIED_MIN) {
  const parsed = ensureSharedVerifiedTotal();
  return parsed >= SHARED_VERIFIED_MIN
    ? parsed
    : Math.max(fallback, SHARED_VERIFIED_MIN);
}
function writeSharedVerifiedTotal(total) {
  const parsed = parsePositiveInt(total);
  if (parsed === null) return;
  const normalized = Math.max(parsed, SHARED_VERIFIED_MIN);
  try {
    window.localStorage.setItem(SHARED_VERIFIED_TOTAL_KEY, String(normalized));
    window.localStorage.setItem(
      SHARED_VERIFIED_HEARTBEAT_KEY,
      String(Date.now()),
    );
  } catch (_) {}
}
function readSharedVerifiedHeartbeat() {
  try {
    return (
      parsePositiveInt(
        window.localStorage.getItem(SHARED_VERIFIED_HEARTBEAT_KEY) || "",
      ) || 0
    );
  } catch (_) {
    return 0;
  }
}

const liveStats = {
  claims: readSharedVerifiedTotal(),
  paid: 31558,
  agreement: 69,
};
const statEls = {
  claims: document.getElementById("verifiedClaims"),
  paid: document.getElementById("paidOut"),
  agreement: document.getElementById("verifierAgreement"),
  note: document.getElementById("liveStatsNote"),
};
function fmtNumber(n) {
  return new Intl.NumberFormat("en-US").format(n);
}
function bumpStat(el) {
  if (!el) return;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}
function renderLiveStats(changes) {
  if (statEls.claims) statEls.claims.textContent = fmtNumber(liveStats.claims);
  if (statEls.paid) statEls.paid.textContent = `$${fmtNumber(liveStats.paid)}`;
  if (statEls.agreement)
    statEls.agreement.textContent = `${liveStats.agreement}%`;
  changes.forEach((key) => bumpStat(statEls[key]));
  if (statEls.note) {
    statEls.note.textContent = changes.includes("paid")
      ? "new verified claim paid out just now"
      : "live community feed updated";
  }
}
function tickLiveStats() {
  const changed = [];
  const prevClaims = liveStats.claims;
  const heartbeatAgeMs = Date.now() - readSharedVerifiedHeartbeat();
  const shouldPublishFallbackTick =
    document.visibilityState === "visible" && heartbeatAgeMs > 4500;
  if (shouldPublishFallbackTick) {
    writeSharedVerifiedTotal(prevClaims + 1);
  }
  const sharedClaims = readSharedVerifiedTotal(prevClaims);
  if (sharedClaims !== prevClaims) {
    liveStats.claims = sharedClaims;
    changed.push("claims");
  }

  const claimDelta = Math.max(0, liveStats.claims - prevClaims);
  if (claimDelta > 0 && Math.random() < 0.65) {
    liveStats.paid += claimDelta * (8 + Math.floor(Math.random() * 18));
    changed.push("paid");
  }

  const direction = Math.random() < 0.5 ? -1 : 1;
  liveStats.agreement = Math.max(
    63,
    Math.min(73, liveStats.agreement + direction),
  );
  changed.push("agreement");

  renderLiveStats(changed);
  if (window.hugEvent)
    hugEvent("forum_live_stats_tick", {
      claims: liveStats.claims,
      paid: liveStats.paid,
      agreement: liveStats.agreement,
    });
}
renderLiveStats([]);
setInterval(tickLiveStats, 2000);
window.addEventListener("storage", (event) => {
  if (event.key !== SHARED_VERIFIED_TOTAL_KEY) return;
  const sharedClaims = readSharedVerifiedTotal(liveStats.claims);
  if (sharedClaims === liveStats.claims) return;
  liveStats.claims = sharedClaims;
  renderLiveStats(["claims"]);
});

const FORUM_POSTS_KEY = "hug:forum:posts";
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fileExtension(name) {
  const m = String(name || "")
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);
  return m ? m[1].toUpperCase() : "FILE";
}
function isImageLike(name, mime) {
  const type = String(mime || "").toLowerCase();
  const n = String(name || "").toLowerCase();
  return (
    type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(n)
  );
}
function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function normalizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") {
        const cleanHref = item.trim();
        if (!cleanHref) return null;
        const fallbackName = cleanHref.split("/").pop() || "Attachment";
        return { href: cleanHref, name: fallbackName, mime: "" };
      }
      const href = String(item.href || item.url || item.path || "").trim();
      if (!href) return null;
      return {
        href,
        name: String(
          item.name || item.label || href.split("/").pop() || "Attachment",
        ),
        mime: String(item.mime || item.type || ""),
        note: String(item.note || item.caption || item.description || ""),
      };
    })
    .filter(Boolean);
}
function renderAttachmentCards(raw, label) {
  const attachments = normalizeAttachments(raw);
  if (!attachments.length) return "";
  const cards = attachments
    .map((att) => {
      const image = isImageLike(att.name, att.mime);
      const ext = fileExtension(att.name);
      const note =
        att.note || (image ? "image attachment" : "document attachment");
      return image
        ? `
          <a class="evidence-card" href="${escapeHtml(att.href)}" target="_blank" rel="noopener">
            <img class="evidence-thumb" src="${escapeHtml(att.href)}" alt="${escapeHtml(att.name)}" loading="lazy" />
            <strong>${escapeHtml(att.name)}</strong>
            <span>${escapeHtml(note)}</span>
          </a>
        `
        : `
          <a class="evidence-card" href="${escapeHtml(att.href)}" target="_blank" rel="noopener">
            <span class="evidence-doc">${escapeHtml(ext)}</span>
            <strong>${escapeHtml(att.name)}</strong>
            <span>${escapeHtml(note)}</span>
          </a>
        `;
    })
    .join("");
  return `<div class="evidence-grid" aria-label="${escapeHtml(label || "Attached evidence")}">${cards}</div>`;
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
      dp[i][j] =
        aw[i - 1] === bw[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
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
  const out = [];
  parts.forEach((p) => {
    const last = out[out.length - 1];
    if (last && last.type === p.type) last.text += p.text;
    else out.push({ ...p });
  });
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
function readLocalForumPosts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FORUM_POSTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function localForumPostMarkup(post) {
  const edits = Array.isArray(post.edits) ? post.edits : [];
  const first = edits[0] || {};
  const diff =
    first.original && first.edited
      ? renderDiff(diffWords(first.original, first.edited))
      : "";
  const attachments = renderAttachmentCards(
    post.attachments,
    "submitted evidence",
  );
  const context =
    post.context ||
    (edits.length > 1
      ? `Posted from claim ${post.ref || "HUG"} with ${edits.length} edited AI responses.`
      : `Posted from claim ${post.ref || "HUG"} with the submitted correction ready for community review.`);
  return `
      <article class="post local-post" data-domain="${escapeHtml(post.domain || "math")}" data-local-post="true">
        <div class="post-head">
          <span class="avatar c1">YOU</span>
          <span class="author">@you</span>
          <span class="sep">&middot;</span>
          <span class="tag brand">${escapeHtml(post.brand || "AI")}</span>
          <span class="tag domain">${escapeHtml(post.domain || "math")}</span>
          <span class="sep">&middot;</span>
          <span class="time">just now</span>
          <span class="status pending">pending <span class="amt">$${escapeHtml(post.payout || 0)}</span></span>
        </div>
        <span class="claim-ref">${escapeHtml(post.ref || "HUG")}</span>
        <h3>${escapeHtml(post.title || "Submitted AI correction")}</h3>
        <div class="excerpt">
          <em class="q">${escapeHtml(post.brand || "AI")} said:</em>
          ${escapeHtml(first.original || "Original AI response saved in the submitted claim.")}
        </div>
        ${diff ? `<div class="forum-diff"><strong>submitted correction</strong>${diff}</div>` : ""}
        ${attachments}
        <p class="context">${escapeHtml(context)}</p>
        <div class="post-foot">
          <button class="vote-pill" data-votes="0"><span class="arrow">&#9650;</span> <span class="v">0</span></button>
          <button class="meta-link toggle-comments">0 comments</button>
          <button class="reply-btn">reply</button>
        </div>
        <div class="comments">
          <div class="add-comment">
            <span class="avatar c1">YOU</span>
            <input type="text" placeholder="Add context, source, or reviewer note..." />
            <button type="button">post</button>
          </div>
        </div>
      </article>
    `;
}
function renderLocalForumPosts() {
  const postsContainer = document.getElementById("posts");
  if (!postsContainer) return;
  readLocalForumPosts()
    .slice()
    .reverse()
    .forEach((post) => {
      postsContainer.insertAdjacentHTML(
        "afterbegin",
        localForumPostMarkup(post),
      );
    });
  if (new URLSearchParams(location.search).get("posted") === "1") {
    const first = postsContainer.querySelector(".local-post");
    if (first) first.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
renderLocalForumPosts();

function shuffleLeaderboardExceptFirst() {
  const board = document.querySelector(".leaderboard");
  if (!board) return;
  const rows = Array.from(board.querySelectorAll(".leader-row"));
  if (rows.length <= 2) return;

  const pinned = rows[0];
  const rest = rows.slice(1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  rest.forEach((row, idx) => {
    board.appendChild(row);
    const rankEl = row.querySelector(".leader-rank");
    if (rankEl) rankEl.textContent = `${idx + 2}.`;
  });
  const pinnedRankEl = pinned.querySelector(".leader-rank");
  if (pinnedRankEl) pinnedRankEl.textContent = "1.";
}
shuffleLeaderboardExceptFirst();

function commentCountForPost(post) {
  return post ? post.querySelectorAll(".comments > .comment").length : 0;
}
function setCommentCountLabel(post) {
  if (!post) return;
  const btn = post.querySelector(".toggle-comments");
  if (!btn) return;
  const n = commentCountForPost(post);
  btn.textContent = `${n} comment${n === 1 ? "" : "s"}`;
}
function refreshAllCommentCountLabels() {
  document.querySelectorAll(".post").forEach(setCommentCountLabel);
}
refreshAllCommentCountLabels();

// Helper: identify a post by its title for analytics
function postKey(post) {
  const h3 = post.querySelector("h3");
  return h3 ? h3.textContent.trim().slice(0, 80) : "unknown";
}

// Filter posts by domain
const filterGroup = document.getElementById("filterGroup");
const posts = document.querySelectorAll(".post");
filterGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  filterGroup
    .querySelectorAll(".filter-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  const f = btn.dataset.filter;
  posts.forEach((p) => {
    p.style.display = f === "all" || p.dataset.domain === f ? "" : "none";
  });
  if (window.hugEvent) hugEvent("forum_filter_changed", { filter: f });
});

// Toggle comments thread on each post
document.querySelectorAll(".toggle-comments").forEach((btn) => {
  btn.addEventListener("click", () => {
    const post = btn.closest(".post");
    post.classList.toggle("expanded");
    if (window.hugEvent)
      hugEvent("comments_toggled", {
        post: postKey(post),
        expanded: post.classList.contains("expanded"),
      });
  });
});

// Reply button also expands the thread
document.querySelectorAll(".reply-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const post = btn.closest(".post");
    post.classList.add("expanded");
    const input = post.querySelector(".add-comment input");
    if (input) setTimeout(() => input.focus(), 50);
  });
});

// Zoom PDF evidence in a modal, mirroring the image lightbox behavior.
const pdfModal = document.getElementById("pdfModal");
const pdfModalFrame = document.getElementById("pdfModalFrame");
const pdfModalClose = document.getElementById("pdfModalClose");
function openPdfModal(src, post) {
  if (!pdfModal || !pdfModalFrame) return;
  pdfModalFrame.setAttribute("data", src);
  pdfModal.classList.add("open");
  document.body.style.overflow = "hidden";
  if (window.hugEvent) hugEvent("forum_pdf_opened", { post });
}
function closePdfModal() {
  if (!pdfModal || !pdfModalFrame) return;
  pdfModal.classList.remove("open");
  document.body.style.overflow = "";
  setTimeout(() => {
    pdfModalFrame.setAttribute("data", "");
  }, 180);
}
document.querySelectorAll(".pdf-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    openPdfModal(
      btn.dataset.pdfSrc || "/data/Sample_Housing_Contract.pdf",
      postKey(btn.closest(".post")),
    );
  });
});
if (pdfModalClose) pdfModalClose.addEventListener("click", closePdfModal);
if (pdfModal) {
  pdfModal.addEventListener("click", (e) => {
    if (e.target === pdfModal) closePdfModal();
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && pdfModal && pdfModal.classList.contains("open"))
    closePdfModal();
});

// Vote pill (toggle voted state, increment count)
document.querySelectorAll(".vote-pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = btn.querySelector(".v");
    let n = parseInt(v.textContent, 10) || 0;
    const isVoted = btn.classList.toggle("voted");
    v.textContent = isVoted ? n + 1 : n - 1;
    if (window.hugEvent)
      hugEvent("vote_cast", {
        target: "post",
        voted: isVoted,
        post: postKey(btn.closest(".post")),
      });
  });
});

function bindVoteMini(btn) {
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => {
    const m = btn.textContent.match(/(\d+)/);
    const n = m ? parseInt(m[1], 10) : 0;
    const isVoted = btn.classList.toggle("voted");
    btn.textContent = "▲ " + (isVoted ? n + 1 : n - 1);
    if (window.hugEvent)
      hugEvent("vote_cast", {
        target: "comment",
        voted: isVoted,
        post: postKey(btn.closest(".post")),
      });
  });
}
// Comment vote-mini (toggle, increment)
document.querySelectorAll(".vote-mini").forEach(bindVoteMini);

// Sort dropdown — re-orders posts in the DOM by chosen key
const postsContainer = document.getElementById("posts");
const sortSelect = document.getElementById("sort");
function getSortKey(post, mode) {
  if (mode === "cashback") {
    const m = post.querySelector(".status .amt")?.textContent.match(/\d+/);
    return -(m ? parseInt(m[0], 10) : 0); // negative for desc
  }
  if (mode === "discussed") {
    const m = post.querySelector(".toggle-comments")?.textContent.match(/\d+/);
    return -(m ? parseInt(m[0], 10) : 0);
  }
  // recent — use original DOM index
  return Array.from(postsContainer.children).indexOf(post);
}
sortSelect.addEventListener("change", () => {
  const mode = sortSelect.value;
  const arr = Array.from(postsContainer.children);
  arr.sort((a, b) => getSortKey(a, mode) - getSortKey(b, mode));
  arr.forEach((p) => postsContainer.appendChild(p));
  if (window.hugEvent) hugEvent("forum_sort_changed", { sort: mode });
});

function renderCommentAttachment(file) {
  const item = document.createElement("div");
  item.className = "comment-media-item";
  const blobUrl = URL.createObjectURL(file);
  if (isImageLike(file.name, file.type)) {
    const img = document.createElement("img");
    img.src = blobUrl;
    img.alt = file.name || "Attached image";
    item.appendChild(img);
  }
  const link = document.createElement("a");
  link.href = blobUrl;
  link.target = "_blank";
  link.rel = "noopener";
  const size = formatFileSize(file.size);
  link.textContent = size ? `${file.name} (${size})` : file.name;
  item.appendChild(link);
  return item;
}

// "Post" comment input — append a new comment locally with optional files
document.querySelectorAll(".add-comment").forEach((row, index) => {
  const input = row.querySelector("input");
  const btn = row.querySelector("button");
  if (!input || !btn) return;

  const selectedFiles = [];
  const tools = document.createElement("div");
  tools.className = "composer-tools";
  const attachLabel = document.createElement("label");
  attachLabel.className = "attach-label";
  attachLabel.innerHTML = "<span>attach files</span>";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.id = `commentAttach${index}`;
  fileInput.accept = "image/*,.pdf,.doc,.docx,.txt,.md,.rtf,.csv";
  fileInput.multiple = true;
  attachLabel.appendChild(fileInput);
  const attachHint = document.createElement("span");
  attachHint.className = "attach-hint";
  attachHint.textContent = "Images and documents are supported.";
  tools.appendChild(attachLabel);
  tools.appendChild(attachHint);

  const attachList = document.createElement("div");
  attachList.className = "attach-list";
  row.appendChild(tools);
  row.appendChild(attachList);

  function renderSelectedFiles() {
    attachList.innerHTML = "";
    if (!selectedFiles.length) return;
    selectedFiles.forEach((file, i) => {
      const chip = document.createElement("span");
      chip.className = "attach-chip";
      const size = formatFileSize(file.size);
      chip.appendChild(
        document.createTextNode(size ? `${file.name} (${size})` : file.name),
      );
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", `Remove ${file.name}`);
      removeBtn.addEventListener("click", () => {
        selectedFiles.splice(i, 1);
        renderSelectedFiles();
      });
      chip.appendChild(removeBtn);
      attachList.appendChild(chip);
    });
  }

  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    files.forEach((file) => {
      const dupe = selectedFiles.some(
        (f) =>
          f.name === file.name &&
          f.size === file.size &&
          f.lastModified === file.lastModified,
      );
      if (!dupe) selectedFiles.push(file);
    });
    fileInput.value = "";
    renderSelectedFiles();
  });

  const submit = () => {
    const txt = input.value.trim();
    if (!txt && !selectedFiles.length) return;

    if (window.hugEvent)
      hugEvent("comment_posted", {
        text: txt,
        post: postKey(row.closest(".post")),
        attachments: selectedFiles.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type || fileExtension(f.name),
        })),
      });

    const c = document.createElement("div");
    c.className = "comment";

    const avatar = document.createElement("span");
    avatar.className = "avatar c1";
    avatar.textContent = "YOU";
    c.appendChild(avatar);

    const body = document.createElement("div");
    body.className = "comment-body";
    body.innerHTML = `
        <div class="comment-head">
          <span class="author">@you</span>
          <span class="time">just now</span>
        </div>
      `;
    if (txt) {
      const p = document.createElement("p");
      p.textContent = txt;
      body.appendChild(p);
    }
    if (selectedFiles.length) {
      const media = document.createElement("div");
      media.className = "comment-media";
      selectedFiles.forEach((file) => {
        media.appendChild(renderCommentAttachment(file));
      });
      body.appendChild(media);
    }
    const foot = document.createElement("div");
    foot.className = "comment-foot";
    foot.innerHTML = `
        <button class="vote-mini">&#9650; 0</button>
        <button class="reply-mini">reply</button>
      `;
    body.appendChild(foot);
    c.appendChild(body);

    row.parentNode.insertBefore(c, row);
    setCommentCountLabel(row.closest(".post"));
    input.value = "";
    selectedFiles.length = 0;
    renderSelectedFiles();
    bindVoteMini(c.querySelector(".vote-mini"));
  };
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
});
