// ---------- Seamless × → $ background grid with cluster bloom ----------
const CLUSTER_RADIUS = 36; // px; ~4 cells per cluster at 32px
const CELL_SIZE = 32;
let _cellPositions = [];

function buildBgGrid() {
  const grid = document.getElementById("bgGrid");
  if (!grid) return;
  if (window.matchMedia("(max-width: 720px)").matches) {
    grid.innerHTML = "";
    _cellPositions = [];
    return;
  }
  const cols = Math.ceil(window.innerWidth / CELL_SIZE) + 1;
  const rows = Math.ceil(window.innerHeight / CELL_SIZE) + 1;
  const total = cols * rows;
  if (grid.childElementCount !== total) {
    grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("span");
      cell.className = "bg-cell";
      cell.innerHTML =
        '<span class="x">&times;</span><span class="dollar">$</span>';
      frag.appendChild(cell);
    }
    grid.appendChild(frag);
  }
  // Cache cell centers for O(N) cluster checks per frame
  _cellPositions = Array.from(grid.querySelectorAll(".bg-cell")).map((el) => {
    const r = el.getBoundingClientRect();
    return { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
}

function updateCluster(mx, my) {
  const r2 = CLUSTER_RADIUS * CLUSTER_RADIUS;
  for (let i = 0; i < _cellPositions.length; i++) {
    const c = _cellPositions[i];
    const dx = mx - c.cx,
      dy = my - c.cy;
    const inCluster = dx * dx + dy * dy < r2;
    // toggle only when state changes — avoids redundant DOM writes
    if (inCluster !== c.el.classList.contains("flipped")) {
      c.el.classList.toggle("flipped", inCluster);
    }
  }
}

let _frameQueued = false;
let _lastMx = -9999,
  _lastMy = -9999;
document.addEventListener("mousemove", (e) => {
  _lastMx = e.clientX;
  _lastMy = e.clientY;
  if (!_frameQueued) {
    _frameQueued = true;
    requestAnimationFrame(() => {
      _frameQueued = false;
      updateCluster(_lastMx, _lastMy);
    });
  }
});

buildBgGrid();
let _resizeT;
window.addEventListener("resize", () => {
  clearTimeout(_resizeT);
  _resizeT = setTimeout(buildBgGrid, 250);
});

// Inline swap touch fallback (unchanged)
if (window.matchMedia("(hover: none)").matches) {
  document.querySelectorAll(".swap").forEach((s) => {
    s.addEventListener("click", () => s.classList.toggle("flipped"));
  });
}

// Tune fast typewriter timing per corrected phrase in hero recent section.
document.querySelectorAll(".hero-recent .swap").forEach((swap) => {
  const right = swap.querySelector(".right");
  if (!right) return;
  const text = right.textContent.replace(/\s+/g, " ").trim();
  const chars = text.length || 8;
  const steps = Math.max(6, Math.min(20, chars));
  const durationMs = Math.max(120, Math.min(300, 80 + chars * 11));
  swap.style.setProperty("--type-steps", String(steps));
  swap.style.setProperty("--type-ms", `${durationMs}ms`);
});

// Hero slogan sequence: hover/focus can trigger it, and it auto-resets to "Failures".
const heroWordSwap = document.querySelector(".hero-word-swap");
if (heroWordSwap) {
  const firstFlipDelayMs = 3200;
  const strikePhaseMs = 760;
  const holdSuccessMs = 3000;
  let crossTimer = null;
  let resetTimer = null;
  let cleanupTimer = null;

  function clearHeroSwapTimers() {
    clearTimeout(crossTimer);
    clearTimeout(resetTimer);
    clearTimeout(cleanupTimer);
  }

  function resetHeroSwapToFailure() {
    heroWordSwap.classList.remove("state-success");
    cleanupTimer = setTimeout(() => {
      heroWordSwap.classList.remove("state-cross");
    }, 180);
  }

  function playHeroSwapSequence() {
    clearHeroSwapTimers();
    heroWordSwap.classList.remove("state-success");
    heroWordSwap.classList.add("state-cross");
    crossTimer = setTimeout(() => {
      heroWordSwap.classList.add("state-success");
      resetTimer = setTimeout(resetHeroSwapToFailure, holdSuccessMs);
    }, strikePhaseMs);
  }

  setTimeout(playHeroSwapSequence, firstFlipDelayMs);
  heroWordSwap.addEventListener("mouseenter", playHeroSwapSequence);
  heroWordSwap.addEventListener("focus", playHeroSwapSequence);
  heroWordSwap.addEventListener("click", playHeroSwapSequence);
}

// ---------- Example-card fake-edit: auto-play on scroll-in + replay on re-hover ----------
const exCards = Array.from(document.querySelectorAll(".examples .ex-card"));
function playCard(card, baseDelay = 0) {
  const swaps = Array.from(card.querySelectorAll(".swap"));
  swaps.forEach((s, i) => {
    // Each swap takes ~1100ms to fully play out; stagger so #2 begins after #1 finishes.
    setTimeout(() => s.classList.add("flipped"), baseDelay + i * 1300);
  });
}
function resetCard(card) {
  card
    .querySelectorAll(".swap.flipped")
    .forEach((s) => s.classList.remove("flipped"));
}

if (exCards.length && "IntersectionObserver" in window) {
  const cardObs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting || e.target.dataset.played === "true") return;
        e.target.dataset.played = "true";
        const idx = exCards.indexOf(e.target);
        playCard(e.target, idx * 350 + 400);
      });
    },
    { threshold: 0.4 },
  );
  exCards.forEach((c) => cardObs.observe(c));
} else {
  // No-IO fallback: play immediately on load
  exCards.forEach((c, i) => playCard(c, i * 350 + 400));
}

// Re-play when the user re-enters a card after the auto-play finished
exCards.forEach((card) => {
  let replayTimer = null;
  card.addEventListener("mouseenter", () => {
    if (!card.dataset.played) return; // first play hasn't fired yet — let auto-play handle it
    const swaps = card.querySelectorAll(".swap.flipped");
    if (swaps.length === 0) return; // already idle, hover :hover will play it
    clearTimeout(replayTimer);
    resetCard(card);
    // double-rAF so the class removal commits before re-add
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        replayTimer = setTimeout(() => playCard(card, 0), 80);
      }),
    );
  });
});

// ---------- Failure mode corpus live clusters ----------
(function initFailureCorpus() {
  const plot = document.getElementById("failureCorpusPlot");
  const scene = document.getElementById("failureCorpusScene");
  const dotsLayer = document.getElementById("failureCorpusDots");
  const totalEl = document.getElementById("corpusTotal");
  const removedEl = document.getElementById("corpusRemoved");
  const legendEl = document.getElementById("corpusLegend");
  const liveNoteEl = document.getElementById("corpusLiveNote");
  const zoomInBtn = document.getElementById("corpusZoomIn");
  const zoomOutBtn = document.getElementById("corpusZoomOut");
  const zoomResetBtn = document.getElementById("corpusZoomReset");
  if (
    !plot ||
    !scene ||
    !dotsLayer ||
    !totalEl ||
    !removedEl ||
    !legendEl ||
    !liveNoteEl
  )
    return;

  const heroTotalEl = document.getElementById("heroVerifiedClaims");
  const renderedDotTotal = 1286;
  const SHARED_VERIFIED_TOTAL_KEY = "hugClaimsSharedVerifiedTotal";
  const SHARED_VERIFIED_MIN = 35000;
  function randomSharedVerifiedStart() {
    return SHARED_VERIFIED_MIN + Math.floor(Math.random() * 5001);
  }
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
    const seeded = randomSharedVerifiedStart();
    try {
      window.localStorage.setItem(SHARED_VERIFIED_TOTAL_KEY, String(seeded));
    } catch (_) {}
    return seeded;
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
    try {
      window.localStorage.setItem(
        SHARED_VERIFIED_TOTAL_KEY,
        String(Math.max(parsed, SHARED_VERIFIED_MIN)),
      );
    } catch (_) {}
  }

  const domains = [
    { id: "medicine", label: "Medicine", center: [19, 24], spread: [8.8, 7.6] },
    { id: "finance", label: "Finance", center: [76, 27], spread: [9.2, 7.8] },
    { id: "legal", label: "Legal", center: [23, 72], spread: [8.6, 8.0] },
    { id: "math", label: "Math", center: [72, 73], spread: [9.0, 7.8] },
    { id: "coding", label: "Coding", center: [48, 50], spread: [10.2, 9.0] },
    {
      id: "other",
      label: "Other (e.g., music, travel, education)",
      center: [79, 48],
      spread: [15.5, 11.5],
    },
  ];
  const colorMap = {
    medicine: "rgba(196, 74, 63, 0.92)",
    finance: "rgba(45, 112, 152, 0.92)",
    legal: "rgba(47, 107, 64, 0.92)",
    math: "rgba(128, 95, 168, 0.92)",
    coding: "rgba(212, 130, 37, 0.95)",
    other: "rgba(108, 121, 142, 0.9)",
  };
  const state = {
    points: [],
    nextId: 1,
    removed: 0,
    targetCounts: null,
  };
  const zoomState = {
    scale: 1,
    tx: 0,
    ty: 0,
    min: 1,
    max: 2.6,
  };
  let panState = null;
  const domainImprovements = {};
  let activeDomainId = null;
  let defaultCorpusNoteHtml = liveNoteEl.innerHTML;
  const domainIds = domains.map((d) => d.id);

  function randn() {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function clampZoomPan() {
    if (zoomState.scale <= 1.001) {
      zoomState.tx = 0;
      zoomState.ty = 0;
      return;
    }
    const w = plot.clientWidth || 1;
    const h = plot.clientHeight || 1;
    const maxX = (w * (zoomState.scale - 1)) / 2;
    const maxY = (h * (zoomState.scale - 1)) / 2;
    zoomState.tx = clamp(zoomState.tx, -maxX, maxX);
    zoomState.ty = clamp(zoomState.ty, -maxY, maxY);
  }
  function applyZoomTransform() {
    clampZoomPan();
    scene.style.transform = `translate(${zoomState.tx}px, ${zoomState.ty}px) scale(${zoomState.scale})`;
    plot.classList.toggle("is-zoomed", zoomState.scale > 1.001);
    plot.classList.remove("is-panning");
  }
  function setZoom(
    nextScale,
    originX = (plot.clientWidth || 1) / 2,
    originY = (plot.clientHeight || 1) / 2,
  ) {
    const oldScale = zoomState.scale;
    const newScale = clamp(nextScale, zoomState.min, zoomState.max);
    if (Math.abs(newScale - oldScale) < 0.0001) return;
    const ratio = newScale / oldScale;
    zoomState.tx = originX - ratio * (originX - zoomState.tx);
    zoomState.ty = originY - ratio * (originY - zoomState.ty);
    zoomState.scale = newScale;
    applyZoomTransform();
  }
  function resetZoom() {
    zoomState.scale = 1;
    zoomState.tx = 0;
    zoomState.ty = 0;
    applyZoomTransform();
  }
  function getHeroVerifiedTotal() {
    if (!heroTotalEl) return readSharedVerifiedTotal(SHARED_VERIFIED_MIN);
    const raw = heroTotalEl.dataset.value || heroTotalEl.textContent || "1286";
    const fallback = Math.max(
      parsePositiveInt(raw) || SHARED_VERIFIED_MIN,
      SHARED_VERIFIED_MIN,
    );
    const shared = readSharedVerifiedTotal(fallback);
    if (shared !== fallback) {
      heroTotalEl.dataset.value = String(shared);
      heroTotalEl.textContent = new Intl.NumberFormat("en-US").format(shared);
    }
    writeSharedVerifiedTotal(shared);
    return shared;
  }
  function emptyCounts() {
    return Object.fromEntries(domainIds.map((id) => [id, 0]));
  }
  function sumCounts(counts) {
    return domainIds.reduce((sum, id) => sum + (counts[id] || 0), 0);
  }
  function scaleCountsToTotal(counts, total) {
    const safeTotal = Math.max(0, Number.parseInt(String(total), 10) || 0);
    const scaled = emptyCounts();
    if (safeTotal === 0) return scaled;
    const baseTotal = sumCounts(counts);
    if (baseTotal <= 0) {
      const per = Math.floor(safeTotal / domainIds.length);
      let remainder = safeTotal - per * domainIds.length;
      domainIds.forEach((id) => {
        scaled[id] = per;
      });
      let idx = 0;
      while (remainder > 0) {
        scaled[domainIds[idx % domainIds.length]] += 1;
        idx += 1;
        remainder -= 1;
      }
      return scaled;
    }
    const fractions = [];
    let allocated = 0;
    domainIds.forEach((id) => {
      const exact = ((counts[id] || 0) / baseTotal) * safeTotal;
      const floor = Math.floor(exact);
      scaled[id] = floor;
      allocated += floor;
      fractions.push({ id, frac: exact - floor });
    });
    let remainder = safeTotal - allocated;
    fractions.sort((a, b) => b.frac - a.frac);
    let cursor = 0;
    while (remainder > 0) {
      scaled[fractions[cursor % fractions.length].id] += 1;
      cursor += 1;
      remainder -= 1;
    }
    return scaled;
  }
  function displayCountsByDomain() {
    return scaleCountsToTotal(countsByDomain(), getHeroVerifiedTotal());
  }
  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function buildRandomTargetCounts(total) {
    const counts = emptyCounts();
    if (total <= 0) return counts;

    const highThreshold = 201;
    let highWanted = 6;
    if (total < highThreshold * 6) {
      highWanted = 5;
    }
    if (total < highThreshold * 5 + 40) {
      highWanted = 4;
    }
    if (total < highThreshold * 4 + 60) {
      highWanted = Math.max(1, Math.floor(total / highThreshold));
    }

    const shuffled = shuffle(domainIds);
    const highIds = shuffled.slice(0, highWanted);
    const lowIds = shuffled.slice(highWanted);
    const lowFloor = lowIds.length
      ? Math.min(60, Math.max(18, Math.floor(total * 0.02)))
      : 0;

    highIds.forEach((id) => {
      counts[id] = highThreshold;
    });
    lowIds.forEach((id) => {
      counts[id] = lowFloor;
    });

    let baseline = sumCounts(counts);
    if (baseline > total) {
      // Edge fallback when total is too small to satisfy >200 preferences.
      domainIds.forEach((id) => {
        counts[id] = 0;
      });
      baseline = 0;
    }

    let remaining = total - baseline;
    while (remaining > 0) {
      const id = domainIds[Math.floor(Math.random() * domainIds.length)];
      const chunk = Math.min(remaining, 1 + Math.floor(Math.random() * 28));
      counts[id] += chunk;
      remaining -= chunk;
    }

    return counts;
  }
  function adjustCountsToTotal(current, total) {
    const counts = { ...(current || emptyCounts()) };
    let diff = total - sumCounts(counts);

    while (diff > 0) {
      const id = domainIds[Math.floor(Math.random() * domainIds.length)];
      counts[id] += 1;
      diff -= 1;
    }
    while (diff < 0) {
      const removable = domainIds.filter((id) => counts[id] > 1);
      if (!removable.length) break;
      const id = removable[Math.floor(Math.random() * removable.length)];
      counts[id] -= 1;
      diff += 1;
    }

    return counts;
  }
  function randomImprovementPct() {
    return 3 + Math.floor(Math.random() * 35); // 3..37
  }
  function setActiveDomainSource(domainId) {
    document
      .querySelectorAll(".corpus-domain-source.is-active")
      .forEach((el) => el.classList.remove("is-active"));
    if (!domainId) return;
    document
      .querySelectorAll(`.corpus-domain-source[data-domain="${domainId}"]`)
      .forEach((el) => el.classList.add("is-active"));
  }
  function clearActiveDomainPreview() {
    activeDomainId = null;
    setActiveDomainSource(null);
    liveNoteEl.innerHTML = defaultCorpusNoteHtml;
  }
  function previewDomainImprovement(trigger, forceNew = true) {
    const domainId = trigger.dataset.domain;
    const domainLabel = trigger.dataset.domainLabel || domainId;
    if (!domainId) return;
    if (forceNew || !domainImprovements[domainId]) {
      domainImprovements[domainId] = randomImprovementPct();
    }
    const pct = domainImprovements[domainId];
    activeDomainId = domainId;
    setActiveDomainSource(domainId);
    const gainEl = trigger.querySelector(".corpus-domain-gain");
    if (gainEl) gainEl.textContent = `+${pct}%`;
    legendEl
      .querySelectorAll(
        `.corpus-domain-trigger[data-domain="${domainId}"] .corpus-domain-gain`,
      )
      .forEach((el) => {
        el.textContent = `+${pct}%`;
      });
    liveNoteEl.innerHTML = `<strong>${domainLabel}:</strong> LLM performance improved +${pct}%`;
  }
  function pointForDomain(domain, entering) {
    const isOther = domain.id === "other";
    const jitterBoost = (1 + Math.random() * 1.25) * (isOther ? 1.15 : 1);
    const isClusterOutlier = Math.random() < (isOther ? 0.35 : 0.28);
    const isGlobalOutlier = Math.random() < (isOther ? 0.16 : 0.11);
    let x = domain.center[0] + randn() * domain.spread[0] * jitterBoost;
    let y = domain.center[1] + randn() * domain.spread[1] * jitterBoost;
    if (isClusterOutlier) {
      x += randn() * (domain.spread[0] * 1.5) + (Math.random() - 0.5) * 18;
      y += randn() * (domain.spread[1] * 1.5) + (Math.random() - 0.5) * 18;
    }
    if (isGlobalOutlier) {
      x = 2 + Math.random() * 96;
      y = 4 + Math.random() * 92;
    }
    x = clamp(x, 2.4, 97.6);
    y = clamp(y, 4.4, 95.6);
    const size = Math.round(clamp(1.8 + Math.random() * 11.4, 2, 14));
    const el = document.createElement("span");
    el.className = `corpus-dot d-${domain.id}${entering ? " entering" : ""}`;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    dotsLayer.appendChild(el);
    if (entering) {
      setTimeout(() => el.classList.remove("entering"), 380);
    }
    return {
      id: state.nextId++,
      domain: domain.id,
      x,
      y,
      size,
      el,
    };
  }
  function countsByDomain() {
    const counts = Object.fromEntries(domains.map((d) => [d.id, 0]));
    state.points.forEach((p) => {
      counts[p.domain] += 1;
    });
    return counts;
  }
  function removePoints(points) {
    if (!points.length) return 0;
    const ids = new Set(points.map((p) => p.id));
    state.points = state.points.filter((p) => !ids.has(p.id));
    points.forEach((p) => {
      if (!p || !p.el) return;
      p.el.classList.add("leaving");
      state.removed += 1;
      setTimeout(() => p.el.remove(), 320);
    });
    return points.length;
  }
  function removeRandomPoints(count, domainId = null) {
    const pool = domainId
      ? state.points.filter((p) => p.domain === domainId)
      : state.points.slice();
    if (!pool.length || count <= 0) return 0;
    const selected = [];
    const used = new Set();
    while (selected.length < count && selected.length < pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      const candidate = pool[idx];
      if (used.has(candidate.id)) continue;
      used.add(candidate.id);
      selected.push(candidate);
    }
    return removePoints(selected);
  }
  function addPoints(domainId, count, entering) {
    if (count <= 0) return 0;
    const domain = domains.find((d) => d.id === domainId);
    if (!domain) return 0;
    for (let i = 0; i < count; i += 1) {
      state.points.push(pointForDomain(domain, entering));
    }
    return count;
  }
  function rebalanceToTarget(targetCounts, entering) {
    let removed = 0;
    let added = 0;
    const current = countsByDomain();

    domains.forEach((d) => {
      const diff = (current[d.id] || 0) - (targetCounts[d.id] || 0);
      if (diff > 0) {
        removed += removeRandomPoints(diff, d.id);
      }
    });

    const afterRemove = countsByDomain();
    domains.forEach((d) => {
      const diff = (targetCounts[d.id] || 0) - (afterRemove[d.id] || 0);
      if (diff > 0) {
        added += addPoints(d.id, diff, entering);
      }
    });

    return { added, removed };
  }
  function renderLegend() {
    const counts = displayCountsByDomain();
    legendEl.innerHTML = domains
      .map(
        (d) =>
          `<li><button type="button" class="name corpus-domain-source corpus-domain-trigger${activeDomainId === d.id ? " is-active" : ""}" data-domain="${d.id}" data-domain-label="${d.label}"><span class="swatch" style="background:${colorMap[d.id]}"></span><span>${d.label}</span><span class="corpus-domain-gain">${domainImprovements[d.id] ? `+${domainImprovements[d.id]}%` : "+--%"}</span></button><span class="count">${new Intl.NumberFormat("en-US").format(counts[d.id])}</span></li>`,
      )
      .join("");
    totalEl.textContent = new Intl.NumberFormat("en-US").format(
      getHeroVerifiedTotal(),
    );
    removedEl.textContent = new Intl.NumberFormat("en-US").format(
      state.removed,
    );
    if (activeDomainId) {
      setActiveDomainSource(activeDomainId);
    }
  }
  function nudgeExisting() {
    state.points.forEach((p) => {
      const chaosAmp = Math.random() < 0.24 ? 2.35 : 1;
      p.x = clamp(
        p.x + randn() * 0.74 * chaosAmp + (Math.random() - 0.5) * 0.26,
        2.5,
        97.5,
      );
      p.y = clamp(
        p.y + randn() * 0.74 * chaosAmp + (Math.random() - 0.5) * 0.26,
        4.5,
        95.5,
      );
      if (Math.random() < 0.038) {
        p.x = clamp(p.x + randn() * 3.4, 2.5, 97.5);
        p.y = clamp(p.y + randn() * 3.4, 4.5, 95.5);
      }
      p.el.style.left = `${p.x}%`;
      p.el.style.top = `${p.y}%`;
    });
  }
  function syncCorpusToHero(entering, mode = "drift") {
    const targetTotal = renderedDotTotal;
    if (!state.targetCounts || mode === "reshuffle") {
      state.targetCounts = buildRandomTargetCounts(targetTotal);
    } else {
      state.targetCounts = adjustCountsToTotal(state.targetCounts, targetTotal);
    }
    return rebalanceToTarget(state.targetCounts, entering);
  }
  function tickCorpus() {
    const invalidatedRemoved = removeRandomPoints(
      6 + Math.floor(Math.random() * 7),
    );
    const syncDelta = syncCorpusToHero(true, "reshuffle");
    const totalRemoved = invalidatedRemoved + syncDelta.removed;
    const feedRemoved = Math.max(1, totalRemoved);
    const minFeedAdded = feedRemoved * 3;
    const feedAdded = Math.max(
      minFeedAdded + Math.floor(Math.random() * 11),
      syncDelta.added,
    );
    defaultCorpusNoteHtml = `<strong>Last update:</strong> +${feedAdded} verified, -${feedRemoved} removed`;
    nudgeExisting();
    renderLegend();
    if (!activeDomainId) {
      liveNoteEl.innerHTML = defaultCorpusNoteHtml;
    } else {
      const trigger = legendEl.querySelector(
        `.corpus-domain-trigger[data-domain="${activeDomainId}"]`,
      );
      if (trigger) {
        previewDomainImprovement(trigger, false);
      } else {
        clearActiveDomainPreview();
      }
    }
  }

  legendEl.addEventListener("mouseover", (event) => {
    const trigger = event.target.closest(".corpus-domain-trigger");
    if (!trigger || !legendEl.contains(trigger)) return;
    if (activeDomainId === trigger.dataset.domain) return;
    previewDomainImprovement(trigger, true);
  });
  legendEl.addEventListener("focusin", (event) => {
    const trigger = event.target.closest(".corpus-domain-trigger");
    if (!trigger || !legendEl.contains(trigger)) return;
    previewDomainImprovement(trigger, true);
  });
  legendEl.addEventListener("mouseleave", clearActiveDomainPreview);
  legendEl.addEventListener("focusout", () => {
    if (!legendEl.matches(":focus-within")) {
      clearActiveDomainPreview();
    }
  });
  plot.addEventListener("mouseover", (event) => {
    const trigger = event.target.closest(".corpus-cluster-label");
    if (!trigger || !plot.contains(trigger)) return;
    if (activeDomainId === trigger.dataset.domain) return;
    previewDomainImprovement(trigger, true);
  });
  plot.addEventListener("focusin", (event) => {
    const trigger = event.target.closest(".corpus-cluster-label");
    if (!trigger || !plot.contains(trigger)) return;
    previewDomainImprovement(trigger, true);
  });
  plot.addEventListener("mouseleave", () => {
    if (!legendEl.matches(":hover")) {
      clearActiveDomainPreview();
    }
  });
  plot.addEventListener("focusout", () => {
    if (!plot.matches(":focus-within") && !legendEl.matches(":focus-within")) {
      clearActiveDomainPreview();
    }
  });
  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => setZoom(zoomState.scale * 1.2));
  }
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => setZoom(zoomState.scale / 1.2));
  }
  if (zoomResetBtn) {
    zoomResetBtn.addEventListener("click", resetZoom);
  }
  plot.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = plot.getBoundingClientRect();
      const originX = event.clientX - rect.left;
      const originY = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom(zoomState.scale * factor, originX, originY);
    },
    { passive: false },
  );
  scene.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || zoomState.scale <= 1.001) return;
    if (event.target.closest(".corpus-cluster-label")) return;
    panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTx: zoomState.tx,
      startTy: zoomState.ty,
    };
    plot.classList.add("is-panning");
    scene.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  scene.addEventListener("pointermove", (event) => {
    if (!panState || event.pointerId !== panState.pointerId) return;
    zoomState.tx = panState.startTx + (event.clientX - panState.startX);
    zoomState.ty = panState.startTy + (event.clientY - panState.startY);
    clampZoomPan();
    scene.style.transform = `translate(${zoomState.tx}px, ${zoomState.ty}px) scale(${zoomState.scale})`;
  });
  function endPan(event) {
    if (!panState || event.pointerId !== panState.pointerId) return;
    panState = null;
    plot.classList.remove("is-panning");
  }
  scene.addEventListener("pointerup", endPan);
  scene.addEventListener("pointercancel", endPan);
  window.addEventListener("resize", applyZoomTransform);

  syncCorpusToHero(false, "reshuffle");
  applyZoomTransform();
  renderLegend();
  window.hugSyncCorpusToHero = function hugSyncCorpusToHero() {
    syncCorpusToHero(true, "drift");
    renderLegend();
  };
  setInterval(tickCorpus, 3000);
})();

function formatInt(n) {
  return new Intl.NumberFormat("en-US").format(n);
}

const SHARED_VERIFIED_TOTAL_KEY = "hugClaimsSharedVerifiedTotal";
const SHARED_VERIFIED_MIN = 35000;
function randomSharedVerifiedStart() {
  return SHARED_VERIFIED_MIN + Math.floor(Math.random() * 5001);
}
function parseSharedTotal(value) {
  const parsed = Number.parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function ensureSharedVerifiedTotal() {
  let parsed = null;
  try {
    parsed = parseSharedTotal(
      window.localStorage.getItem(SHARED_VERIFIED_TOTAL_KEY) || "",
    );
  } catch (_) {}
  if (parsed !== null && parsed >= SHARED_VERIFIED_MIN) return parsed;
  const seeded = randomSharedVerifiedStart();
  try {
    window.localStorage.setItem(SHARED_VERIFIED_TOTAL_KEY, String(seeded));
  } catch (_) {}
  return seeded;
}
function readSharedVerifiedTotal(fallback = SHARED_VERIFIED_MIN) {
  const parsed = ensureSharedVerifiedTotal();
  return parsed >= SHARED_VERIFIED_MIN
    ? parsed
    : Math.max(fallback, SHARED_VERIFIED_MIN);
}
function writeSharedVerifiedTotal(total) {
  const parsed = parseSharedTotal(total);
  if (parsed === null) return;
  try {
    window.localStorage.setItem(
      SHARED_VERIFIED_TOTAL_KEY,
      String(Math.max(parsed, SHARED_VERIFIED_MIN)),
    );
  } catch (_) {}
}

const heroVerifiedClaimsEl = document.getElementById("heroVerifiedClaims");
const corpusTotalEl = document.getElementById("corpusTotal");
function currentHeroTotal() {
  if (!heroVerifiedClaimsEl)
    return readSharedVerifiedTotal(SHARED_VERIFIED_MIN);
  const fromDom = Math.max(
    parseSharedTotal(
      heroVerifiedClaimsEl.dataset.value ||
        heroVerifiedClaimsEl.textContent ||
        "1286",
    ) || SHARED_VERIFIED_MIN,
    SHARED_VERIFIED_MIN,
  );
  return readSharedVerifiedTotal(fromDom);
}
function setHeroTotal(total) {
  if (!heroVerifiedClaimsEl) return;
  heroVerifiedClaimsEl.dataset.value = String(total);
  heroVerifiedClaimsEl.textContent = formatInt(total);
}
function syncCorpusTotalFromHero() {
  if (!heroVerifiedClaimsEl || !corpusTotalEl) return;
  corpusTotalEl.textContent = heroVerifiedClaimsEl.textContent;
}
function tickHeroVerifiedClaims() {
  if (!heroVerifiedClaimsEl) return;
  const current = currentHeroTotal();
  const next = current + 1;
  setHeroTotal(next);
  writeSharedVerifiedTotal(next);
  syncCorpusTotalFromHero();
  if (typeof window.hugSyncCorpusToHero === "function") {
    window.hugSyncCorpusToHero();
  }
}

if (heroVerifiedClaimsEl) {
  const initial = currentHeroTotal();
  setHeroTotal(initial);
  writeSharedVerifiedTotal(initial);
}
syncCorpusTotalFromHero();
setInterval(tickHeroVerifiedClaims, 2000);
window.addEventListener("storage", (event) => {
  if (event.key !== SHARED_VERIFIED_TOTAL_KEY || !heroVerifiedClaimsEl) return;
  const shared = currentHeroTotal();
  setHeroTotal(shared);
  syncCorpusTotalFromHero();
  if (typeof window.hugSyncCorpusToHero === "function") {
    window.hugSyncCorpusToHero();
  }
});

const ELIGIBLE_CAPTION_NAMES = [
  "UAKEC",
  "NIVAR",
  "MILOX",
  "SAREM",
  "QATEN",
  "RUVIK",
  "LEONA",
  "DYLAN",
  "MARA",
  "KAI",
];

function randomEligibleName() {
  return ELIGIBLE_CAPTION_NAMES[
    Math.floor(Math.random() * ELIGIBLE_CAPTION_NAMES.length)
  ];
}

function randomEligibleCashback() {
  return 2 + Math.floor(Math.random() * 26);
}

function eligibleCaptionText() {
  return `User ${randomEligibleName()} received $${randomEligibleCashback()}`;
}

function refreshEligibleCaptions() {
  document.querySelectorAll(".eligible-caption").forEach((el) => {
    el.classList.add("is-updating");
    setTimeout(() => {
      el.textContent = eligibleCaptionText();
      el.classList.remove("is-updating");
    }, 130);
  });
}

setInterval(refreshEligibleCaptions, 2000);
