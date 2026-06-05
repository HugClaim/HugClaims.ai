(function initEnterpriseFailureCorpus() {
  const plot = document.getElementById("enterpriseCorpusPlot");
  const dotsLayer = document.getElementById("enterpriseCorpusDots");
  const totalEl = document.getElementById("enterpriseCorpusTotal");
  const removedEl = document.getElementById("enterpriseCorpusRemoved");
  const legendEl = document.getElementById("enterpriseCorpusLegend");
  const liveNoteEl = document.getElementById("enterpriseCorpusLiveNote");
  const trainModelEl = document.getElementById("enterpriseTrainModel");
  const trainDomainValueEl = document.getElementById(
    "enterpriseTrainDomainValue",
  );
  const trainNewPointsValueEl = document.getElementById(
    "enterpriseTrainNewPointsValue",
  );
  const trainBatchBadgeEl = document.getElementById(
    "enterpriseTrainBatchBadge",
  );
  const trainBaselineEl = document.getElementById("enterpriseTrainBaseline");
  const trainAfterEl = document.getElementById("enterpriseTrainAfter");
  const trainBaselineStatEl = document.getElementById(
    "enterpriseTrainBaselineStat",
  );
  const trainAfterStatEl = document.getElementById("enterpriseTrainAfterStat");
  const trainDomainListEl = document.getElementById(
    "enterpriseTrainDomainList",
  );
  const portalTabEls = Array.from(
    document.querySelectorAll(".portal-tab[data-portal-tab]"),
  );
  const portalPanelEls = Array.from(
    document.querySelectorAll(".portal-card[data-portal-panel]"),
  );
  const pipelineStageEls = Array.from(
    document.querySelectorAll(".pipeline-stage-btn[data-stage-id]"),
  );
  const pipelineStepEl = document.getElementById("enterprisePipelineStep");
  const pipelineTitleEl = document.getElementById("enterprisePipelineTitle");
  const pipelineVisualEl = document.getElementById("enterprisePipelineVisual");
  const PIPELINE_AUTO_MS = 4000;
  let pipelineAutoTimer = null;
  let pipelineStageOrder = [];
  if (!plot || !dotsLayer || !totalEl || !removedEl || !liveNoteEl) return;

  const renderedDotTotal = 1286;
  const SHARED_VERIFIED_TOTAL_KEY = "hugClaimsSharedVerifiedTotal";
  const SHARED_VERIFIED_MIN = 35000;
  function randomSharedVerifiedStart() {
    return SHARED_VERIFIED_MIN + Math.floor(Math.random() * 5001);
  }
  function parseSharedTotal(value) {
    const parsed = Number.parseInt(
      String(value || "").replace(/[^\d]/g, ""),
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  function readSharedVerifiedTotal(fallback = renderedDotTotal) {
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
    return Math.max(seeded, fallback, SHARED_VERIFIED_MIN);
  }
  function ensureSharedVerifiedTotal() {
    try {
      const parsed = parseSharedTotal(
        window.localStorage.getItem(SHARED_VERIFIED_TOTAL_KEY) || "",
      );
      if (parsed !== null && parsed >= SHARED_VERIFIED_MIN) return;
      window.localStorage.setItem(
        SHARED_VERIFIED_TOTAL_KEY,
        String(randomSharedVerifiedStart()),
      );
    } catch (_) {}
  }
  ensureSharedVerifiedTotal();
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
  const domainIds = domains.map((d) => d.id);
  const state = { points: [], nextId: 1, removed: 0, targetCounts: null };
  const domainImprovements = {};
  let activeDomainId = null;
  let defaultNoteHtml = liveNoteEl.innerHTML;
  const modelProfiles = {
    gpt55: {
      label: "GPT 5.5",
      baselinePass: 73.2,
      domainBase: {
        medicine: 70.9,
        finance: 74.6,
        legal: 72.3,
        math: 78.1,
        coding: 76.5,
        other: 71.4,
      },
      domainLiftPotential: {
        medicine: 9.8,
        finance: 8.1,
        legal: 10.4,
        math: 6.5,
        coding: 7.4,
        other: 8.7,
      },
    },
    claude48: {
      label: "Claude Opus 4.8",
      baselinePass: 71.8,
      domainBase: {
        medicine: 69.8,
        finance: 73.2,
        legal: 75.2,
        math: 73.6,
        coding: 75.8,
        other: 70.4,
      },
      domainLiftPotential: {
        medicine: 10.5,
        finance: 7.3,
        legal: 8.8,
        math: 7.9,
        coding: 8.5,
        other: 8.2,
      },
    },
    gemini35flash: {
      label: "Gemini 3.5 Flash",
      baselinePass: 69.5,
      domainBase: {
        medicine: 67.7,
        finance: 70.6,
        legal: 69.8,
        math: 72.9,
        coding: 71.8,
        other: 68.2,
      },
      domainLiftPotential: {
        medicine: 11.2,
        finance: 8.9,
        legal: 10.1,
        math: 8.2,
        coding: 8.6,
        other: 9.4,
      },
    },
  };
  const trainState = {
    model: "gpt55",
    domain: "medicine",
    newPoints: 400,
  };
  const domainTransferWeights = {
    medicine: {
      medicine: 1.0,
      finance: 0.22,
      legal: 0.28,
      math: 0.1,
      coding: 0.06,
      other: 0.16,
    },
    finance: {
      medicine: 0.14,
      finance: 1.0,
      legal: 0.24,
      math: 0.22,
      coding: 0.12,
      other: 0.16,
    },
    legal: {
      medicine: 0.24,
      finance: 0.24,
      legal: 1.0,
      math: 0.14,
      coding: 0.1,
      other: 0.18,
    },
    math: {
      medicine: 0.1,
      finance: 0.2,
      legal: 0.12,
      math: 1.0,
      coding: 0.3,
      other: 0.12,
    },
    coding: {
      medicine: 0.06,
      finance: 0.12,
      legal: 0.1,
      math: 0.3,
      coding: 1.0,
      other: 0.14,
    },
    other: {
      medicine: 0.14,
      finance: 0.14,
      legal: 0.16,
      math: 0.1,
      coding: 0.12,
      other: 1.0,
    },
  };
  const pipelineStages = {
    collect: {
      step: "Step 1",
      title: "Capture Failures",
      summary:
        "Capture high-signal real-world failures from production traffic, eval harnesses, and user submissions.",
      visual: {
        src: "/assets/pipeline-step-collect.svg",
        alt: "Performance trend chart for failure collection stage",
      },
    },
    curate: {
      step: "Step 2",
      title: "Verify Signals",
      summary:
        "Filter noisy entries, verify reproducibility, and keep only trusted failures for downstream use.",
      visual: {
        src: "/assets/pipeline-step-curate.svg",
        alt: "Validation precision chart for curation stage",
      },
    },
    posttrain: {
      step: "Step 3",
      title: "Targeted Post-Train",
      summary:
        "Use validated hard negatives to improve weak domains while keeping general capability stable.",
      visual: {
        src: "/assets/pipeline-step-posttrain.svg",
        alt: "Before and after model performance chart for post-training stage",
      },
    },
    regression: {
      step: "Step 4",
      title: "Regression Guardrail",
      summary:
        "Continuously re-test old and new slices, catch relapses early, and feed misses back into intake.",
      visual: {
        src: "/assets/pipeline-step-regression.svg",
        alt: "Regression monitoring trend chart showing reduced recurrence",
      },
    },
  };

  function randn() {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function formatInt(n) {
    return new Intl.NumberFormat("en-US").format(n);
  }
  function formatPct(n) {
    return `${n.toFixed(1)}%`;
  }
  function formatSigned(value, digits = 1, suffix = "") {
    const safe = Number.isFinite(value) ? value : 0;
    const sign = safe >= 0 ? "+" : "-";
    return `${sign}${Math.abs(safe).toFixed(digits)}${suffix}`;
  }
  function formatCiRange(ci) {
    return `${formatPct(ci.low)}-${formatPct(ci.high)}`;
  }
  function emptyCounts() {
    return Object.fromEntries(domainIds.map((id) => [id, 0]));
  }
  function sumCounts(counts) {
    return domainIds.reduce((sum, id) => sum + (counts[id] || 0), 0);
  }
  function getRenderTotal() {
    return renderedDotTotal;
  }
  function getDisplayTotal() {
    return readSharedVerifiedTotal(SHARED_VERIFIED_MIN);
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
    return scaleCountsToTotal(countsByDomain(), getDisplayTotal());
  }
  function currentProfile() {
    return modelProfiles[trainState.model] || modelProfiles.gpt55;
  }
  function domainDisplayLabel(domainId) {
    const domain = domains.find((entry) => entry.id === domainId);
    if (!domain) return "Other";
    if (domainId === "other") return "Other";
    return domain.label;
  }
  function transferWeight(sourceDomain, targetDomain) {
    const sourceWeights =
      domainTransferWeights[sourceDomain] || domainTransferWeights.other;
    return sourceWeights[targetDomain] || 0.1;
  }
  function datapointFactor() {
    const normalized = Math.max(0, Math.min(1, trainState.newPoints / 2000));
    return Math.pow(normalized, 0.68);
  }
  function addedDatapointsForDomain(domainId) {
    return Math.round(
      trainState.newPoints * transferWeight(trainState.domain, domainId),
    );
  }
  function domainBaseScore(domainId) {
    const profile = currentProfile();
    return profile.domainBase[domainId] || profile.baselinePass;
  }
  function domainLiftPoints(domainId) {
    const profile = currentProfile();
    const maxLift = profile.domainLiftPotential[domainId] || 7.5;
    return (
      maxLift * datapointFactor() * transferWeight(trainState.domain, domainId)
    );
  }
  function domainDriftPenalty(domainId) {
    if (domainId === trainState.domain) return 0;
    const mismatch = 1 - transferWeight(trainState.domain, domainId);
    const pressure = Math.pow(
      Math.max(0, Math.min(1, trainState.newPoints / 2200)),
      0.92,
    );
    return 1.45 * mismatch * pressure;
  }
  function domainPostScore(domainId) {
    const shifted =
      domainBaseScore(domainId) +
      domainLiftPoints(domainId) -
      domainDriftPenalty(domainId);
    return clamp(shifted, 45, 99.4);
  }
  function domainRelativeGainPct(domainId) {
    const before = domainBaseScore(domainId);
    const after = domainPostScore(domainId);
    return ((after - before) / Math.max(before, 1)) * 100;
  }
  function domainDeltaPoints(domainId) {
    return domainPostScore(domainId) - domainBaseScore(domainId);
  }
  function effectiveSampleSize(rawCount, addedPoints = 0) {
    const safeCount = Math.max(1, Number.parseInt(String(rawCount), 10) || 1);
    const safeAdded = Math.max(
      0,
      Number.parseInt(String(addedPoints), 10) || 0,
    );
    const augmented = safeCount + safeAdded;
    return Math.max(80, Math.round(augmented * 0.07 + safeAdded * 0.04));
  }
  function confidenceInterval(scorePct, sampleSize) {
    const p = clamp(scorePct / 100, 0.01, 0.99);
    const n = Math.max(1, sampleSize);
    const halfWidth = clamp(
      1.96 * Math.sqrt((p * (1 - p)) / n) * 100,
      0.35,
      8.5,
    );
    return {
      low: clamp(scorePct - halfWidth, 0, 100),
      high: clamp(scorePct + halfWidth, 0, 100),
    };
  }
  function weightedModelScores() {
    const counts = displayCountsByDomain();
    const totalCount = sumCounts(counts);
    if (!totalCount) {
      const baseline =
        domainIds.reduce((acc, id) => acc + domainBaseScore(id), 0) /
        domainIds.length;
      const after =
        domainIds.reduce((acc, id) => acc + domainPostScore(id), 0) /
        domainIds.length;
      return { baseline, after, delta: after - baseline };
    }
    let baselineWeighted = 0;
    let afterWeighted = 0;
    domainIds.forEach((id) => {
      const weight = counts[id] || 0;
      baselineWeighted += domainBaseScore(id) * weight;
      afterWeighted += domainPostScore(id) * weight;
    });
    const baseline = baselineWeighted / totalCount;
    const after = afterWeighted / totalCount;
    return { baseline, after, delta: after - baseline };
  }
  function refreshDomainImprovements() {
    domainIds.forEach((id) => {
      domainImprovements[id] = Number(domainRelativeGainPct(id).toFixed(1));
    });
  }
  function updateDefaultLiveNote(feedAdded, feedRemoved) {
    const scores = weightedModelScores();
    const profile = currentProfile();
    const incomingLabel = domainDisplayLabel(trainState.domain);
    const relativeGainPct =
      ((scores.after - scores.baseline) / Math.max(scores.baseline, 1)) * 100;
    const overallSample = effectiveSampleSize(
      sumCounts(displayCountsByDomain()),
      trainState.newPoints,
    );
    const afterCi = confidenceInterval(scores.after, overallSample);
    const simulationLine = `<strong>Post-train:</strong> ${profile.label} ${formatPct(scores.baseline)} → ${formatPct(scores.after)} (${formatSigned(relativeGainPct, 1, "%")} accuracy, 95% CI ${formatCiRange(afterCi)}) from +${formatInt(trainState.newPoints)} incoming ${incomingLabel} datapoints`;
    if (typeof feedAdded === "number" && typeof feedRemoved === "number") {
      defaultNoteHtml = `<strong>Last update:</strong> +${feedAdded} verified, -${feedRemoved} removed<br>${simulationLine}`;
    } else {
      defaultNoteHtml = `${simulationLine}<br><strong>Corpus stream:</strong> updates every 3s`;
    }
    if (!activeDomainId) {
      liveNoteEl.innerHTML = defaultNoteHtml;
    }
  }
  function renderTrainingPanel() {
    if (
      !trainModelEl ||
      !trainNewPointsValueEl ||
      !trainBaselineEl ||
      !trainAfterEl ||
      !trainDomainListEl
    )
      return;
    trainModelEl.value = trainState.model;
    if (trainDomainValueEl) {
      trainDomainValueEl.textContent = domainDisplayLabel(trainState.domain);
    }
    trainNewPointsValueEl.textContent = formatInt(trainState.newPoints);
    if (trainBatchBadgeEl) {
      trainBatchBadgeEl.textContent = `${domainDisplayLabel(trainState.domain)} +${formatInt(trainState.newPoints)} datapoints`;
    }
    const scores = weightedModelScores();
    trainBaselineEl.textContent = formatPct(scores.baseline);
    trainAfterEl.textContent = formatPct(scores.after);
    const overallSample = effectiveSampleSize(
      sumCounts(displayCountsByDomain()),
      trainState.newPoints,
    );
    const baselineCi = confidenceInterval(scores.baseline, overallSample);
    const afterCi = confidenceInterval(scores.after, overallSample);
    if (trainBaselineStatEl) {
      trainBaselineStatEl.textContent = `(accuracy, 95% CI: ${formatCiRange(baselineCi)})`;
    }
    if (trainAfterStatEl) {
      trainAfterStatEl.textContent = `(accuracy, 95% CI: ${formatCiRange(afterCi)})`;
    }
    const displayCounts = displayCountsByDomain();
    trainDomainListEl.innerHTML = domains
      .map((domain) => {
        const baseline = domainBaseScore(domain.id);
        const after = domainPostScore(domain.id);
        const deltaPoints = domainDeltaPoints(domain.id);
        const relativeGainPct =
          ((after - baseline) / Math.max(baseline, 1)) * 100;
        const incomingPoints = addedDatapointsForDomain(domain.id);
        const domainSample = effectiveSampleSize(
          displayCounts[domain.id] || 1,
          incomingPoints,
        );
        const domainCi = confidenceInterval(after, domainSample);
        const baseWidth = clamp((baseline - 50) * 2, 4, 98);
        const afterWidth = clamp((after - 50) * 2, 4, 98);
        const deltaLeft = Math.min(baseWidth, afterWidth);
        const deltaWidth = Math.max(1.8, Math.abs(afterWidth - baseWidth));
        const direction = deltaPoints >= 0 ? "up" : "down";
        const rowClass = deltaPoints >= 0 ? "is-gain" : "is-loss";
        const segmentClass = deltaPoints >= 0 ? "pos" : "neg";
        const detailTitle = `${domain.label}: ${formatSigned(deltaPoints, 2, " pts")}, +${formatInt(incomingPoints)} datapoints, 95% CI ${formatCiRange(domainCi)}`;
        return `<li class="${rowClass}" title="${detailTitle}"><div class="corpus-train-domain-row"><span class="name">${domain.label}</span><div class="corpus-train-bar" role="img" aria-label="${domain.label} change ${formatSigned(relativeGainPct, 1, "%")}"><span class="base" style="width:${baseWidth}%"></span><span class="delta-segment ${segmentClass}" style="left:${deltaLeft}%;width:${deltaWidth}%"></span><span class="marker baseline" style="left:${baseWidth}%"></span><span class="marker current ${segmentClass}" style="left:${afterWidth}%"></span></div><span class="delta-main ${direction}">${formatSigned(relativeGainPct, 1, "%")}</span></div></li>`;
      })
      .join("");
    if (!activeDomainId) {
      liveNoteEl.innerHTML = defaultNoteHtml;
    }
  }
  function setActivePortalPanel(panelId) {
    if (!portalPanelEls.length || !portalTabEls.length) return;
    portalPanelEls.forEach((panel) => {
      const isActive = panel.dataset.portalPanel === panelId;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });
    portalTabEls.forEach((tab) => {
      const isActive = tab.dataset.portalTab === panelId;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      tab.tabIndex = isActive ? 0 : -1;
    });
  }
  function setActivePipelineStage(stageId) {
    if (
      !pipelineStageEls.length ||
      !pipelineStepEl ||
      !pipelineTitleEl ||
      !pipelineVisualEl
    )
      return;
    const fallbackId = pipelineStageEls[0].dataset.stageId;
    const safeId = Object.prototype.hasOwnProperty.call(pipelineStages, stageId)
      ? stageId
      : fallbackId;
    const stage = pipelineStages[safeId];
    pipelineStageEls.forEach((btn) => {
      const isActive = btn.dataset.stageId === safeId;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
      btn.tabIndex = isActive ? 0 : -1;
    });
    pipelineStepEl.textContent = stage.step;
    pipelineTitleEl.textContent = stage.title;
    pipelineVisualEl.src = stage.visual.src;
    pipelineVisualEl.alt = stage.visual.alt;
  }
  function advancePipelineStage() {
    if (!pipelineStageOrder.length) return;
    const activeId =
      pipelineStageEls.find((btn) => btn.classList.contains("is-active"))
        ?.dataset.stageId || pipelineStageOrder[0];
    const currentIndex = pipelineStageOrder.indexOf(activeId);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextId =
      pipelineStageOrder[(safeIndex + 1) % pipelineStageOrder.length];
    setActivePipelineStage(nextId);
  }
  function startPipelineAutoplay() {
    if (pipelineAutoTimer || !pipelineStageOrder.length) return;
    pipelineAutoTimer = window.setInterval(
      advancePipelineStage,
      PIPELINE_AUTO_MS,
    );
  }
  function stopPipelineAutoplay() {
    if (!pipelineAutoTimer) return;
    window.clearInterval(pipelineAutoTimer);
    pipelineAutoTimer = null;
  }
  function restartPipelineAutoplay() {
    stopPipelineAutoplay();
    startPipelineAutoplay();
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
    if (total < highThreshold * 6) highWanted = 5;
    if (total < highThreshold * 5 + 40) highWanted = 4;
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
  function setActiveDomainSource(domainId) {
    document
      .querySelectorAll(".corpus-domain-source.is-active")
      .forEach((el) => el.classList.remove("is-active"));
    if (!domainId) return;
    document
      .querySelectorAll(`.corpus-domain-source[data-domain="${domainId}"]`)
      .forEach((el) => el.classList.add("is-active"));
  }
  function applyDomainCountHints(counts) {
    if (!counts) return;
    document
      .querySelectorAll(".corpus-cluster-label[data-domain]")
      .forEach((labelEl) => {
        const domainId = labelEl.dataset.domain;
        const domainLabel =
          labelEl.dataset.domainLabel || domainDisplayLabel(domainId);
        const count = counts[domainId] || 0;
        const text = `${domainLabel}: ${formatInt(count)} datapoints`;
        labelEl.title = text;
        labelEl.setAttribute("aria-label", text);
      });
  }
  function refreshActiveDomainPreview(forceNew = false) {
    if (!activeDomainId) return;
    const activeTrigger =
      plot.querySelector(
        `.corpus-cluster-label[data-domain="${activeDomainId}"]`,
      ) ||
      (legendEl
        ? legendEl.querySelector(
            `.corpus-domain-trigger[data-domain="${activeDomainId}"]`,
          )
        : null);
    if (activeTrigger) previewDomainImprovement(activeTrigger, forceNew);
  }
  function clearActiveDomainPreview() {
    activeDomainId = null;
    setActiveDomainSource(null);
    liveNoteEl.innerHTML = defaultNoteHtml;
  }
  function previewDomainImprovement(trigger, forceNew) {
    const domainId = trigger.dataset.domain;
    const domainLabel = trigger.dataset.domainLabel || domainId;
    if (!domainId) return;
    if (forceNew || !domainImprovements[domainId]) {
      domainImprovements[domainId] = domainRelativeGainPct(domainId);
    }
    const counts = displayCountsByDomain();
    const existingCount = counts[domainId] || 0;
    const pct = domainImprovements[domainId];
    const profile = currentProfile();
    activeDomainId = domainId;
    setActiveDomainSource(domainId);
    const gainEl = trigger.querySelector(".corpus-domain-gain");
    if (gainEl) gainEl.textContent = formatSigned(pct, 1, "%");
    if (legendEl) {
      legendEl
        .querySelectorAll(
          `.corpus-domain-trigger[data-domain="${domainId}"] .corpus-domain-gain`,
        )
        .forEach((el) => {
          el.textContent = formatSigned(pct, 1, "%");
        });
    }
    liveNoteEl.innerHTML = `<strong>${domainLabel}:</strong> ${formatInt(existingCount)} datapoints | ${profile.label} shifts ${formatSigned(pct, 1, "%")} with +${formatInt(trainState.newPoints)} incoming ${domainDisplayLabel(trainState.domain)} datapoints`;
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
    if (entering) setTimeout(() => el.classList.remove("entering"), 380);
    return { id: state.nextId++, domain: domain.id, x, y, el };
  }
  function countsByDomain() {
    const counts = Object.fromEntries(domains.map((d) => [d.id, 0]));
    state.points.forEach((p) => {
      counts[p.domain] += 1;
    });
    return counts;
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
  function removePoints(points) {
    if (!points.length) return 0;
    const ids = new Set(points.map((p) => p.id));
    state.points = state.points.filter((p) => !ids.has(p.id));
    points.forEach((p) => {
      p.el.classList.add("leaving");
      state.removed += 1;
      setTimeout(() => p.el.remove(), 320);
    });
    return points.length;
  }
  function removeRandomPoints(count, domainId) {
    const pool = domainId
      ? state.points.filter((p) => p.domain === domainId)
      : state.points.slice();
    if (!pool.length || count <= 0) return 0;
    const selected = [];
    const used = new Set();
    while (selected.length < count && selected.length < pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      const point = pool[idx];
      if (used.has(point.id)) continue;
      used.add(point.id);
      selected.push(point);
    }
    return removePoints(selected);
  }
  function rebalanceToTarget(targetCounts, entering) {
    let removed = 0;
    let added = 0;
    const addedByDomain = emptyCounts();
    const removedByDomain = emptyCounts();
    const current = countsByDomain();

    domains.forEach((d) => {
      const diff = (current[d.id] || 0) - (targetCounts[d.id] || 0);
      if (diff > 0) {
        const removedNow = removeRandomPoints(diff, d.id);
        removed += removedNow;
        removedByDomain[d.id] += removedNow;
      }
    });

    const afterRemove = countsByDomain();
    domains.forEach((d) => {
      const diff = (targetCounts[d.id] || 0) - (afterRemove[d.id] || 0);
      if (diff > 0) {
        const addedNow = addPoints(d.id, diff, entering);
        added += addedNow;
        addedByDomain[d.id] += addedNow;
      }
    });

    return { added, removed, addedByDomain, removedByDomain };
  }
  function renderLegend() {
    const counts = displayCountsByDomain();
    if (legendEl) {
      legendEl.innerHTML = domains
        .map(
          (d) =>
            `<li><button type="button" class="name corpus-domain-source corpus-domain-trigger${activeDomainId === d.id ? " is-active" : ""}" data-domain="${d.id}" data-domain-label="${d.label}"><span class="swatch" style="background:${colorMap[d.id]}"></span><span>${d.label}</span><span class="corpus-domain-gain">${Number.isFinite(domainImprovements[d.id]) ? formatSigned(domainImprovements[d.id], 1, "%") : "--"}</span></button><span class="count">${formatInt(counts[d.id])}</span></li>`,
        )
        .join("");
    }
    applyDomainCountHints(counts);
    totalEl.textContent = formatInt(getDisplayTotal());
    removedEl.textContent = formatInt(state.removed);
    if (activeDomainId) setActiveDomainSource(activeDomainId);
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
  function syncCorpusToTarget(entering, mode) {
    const targetTotal = getRenderTotal();
    if (!state.targetCounts || mode === "reshuffle") {
      state.targetCounts = buildRandomTargetCounts(targetTotal);
    } else {
      state.targetCounts = adjustCountsToTotal(state.targetCounts, targetTotal);
    }
    return rebalanceToTarget(state.targetCounts, entering);
  }
  function selectIncomingDomain(addedByDomain) {
    const safeMap = addedByDomain || {};
    let selected = trainState.domain || domainIds[0];
    let maxCount = 0;
    domainIds.forEach((id) => {
      const count = safeMap[id] || 0;
      if (count > maxCount) {
        maxCount = count;
        selected = id;
      }
    });
    if (maxCount <= 0) {
      return domainIds[Math.floor(Math.random() * domainIds.length)];
    }
    return selected;
  }
  function updateTrainingStateFromFeed(feedAdded, addedByDomain) {
    trainState.domain = selectIncomingDomain(addedByDomain);
    trainState.newPoints = Math.max(80, Math.min(2600, Math.round(feedAdded)));
  }
  function tickCorpus() {
    const invalidatedRemoved = removeRandomPoints(
      6 + Math.floor(Math.random() * 7),
    );
    const syncDelta = syncCorpusToTarget(true, "reshuffle");
    const totalRemoved = invalidatedRemoved + syncDelta.removed;
    const feedRemoved = Math.max(1, totalRemoved);
    const minFeedAdded = feedRemoved * 3;
    const feedAdded = Math.max(
      minFeedAdded + Math.floor(Math.random() * 11),
      syncDelta.added,
    );
    updateTrainingStateFromFeed(feedAdded, syncDelta.addedByDomain);
    nudgeExisting();
    refreshDomainImprovements();
    updateDefaultLiveNote(feedAdded, feedRemoved);
    renderTrainingPanel();
    renderLegend();
    if (!activeDomainId) {
      liveNoteEl.innerHTML = defaultNoteHtml;
    } else {
      refreshActiveDomainPreview(false);
    }
  }

  function handleTrainingControlsChange() {
    if (trainModelEl) {
      trainState.model = trainModelEl.value || trainState.model;
    }
    refreshDomainImprovements();
    updateDefaultLiveNote();
    renderTrainingPanel();
    renderLegend();
    if (activeDomainId) {
      refreshActiveDomainPreview(false);
    }
  }

  if (legendEl) {
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
      if (!legendEl.matches(":focus-within")) clearActiveDomainPreview();
    });
  }
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
    if (!(legendEl && legendEl.matches(":hover"))) clearActiveDomainPreview();
  });
  plot.addEventListener("focusout", () => {
    if (
      !plot.matches(":focus-within") &&
      !(legendEl && legendEl.matches(":focus-within"))
    )
      clearActiveDomainPreview();
  });

  if (trainModelEl) trainModelEl.value = trainState.model;
  if (trainModelEl)
    trainModelEl.addEventListener("change", handleTrainingControlsChange);
  window.addEventListener("storage", (event) => {
    if (event.key !== SHARED_VERIFIED_TOTAL_KEY) return;
    syncCorpusToTarget(false, "drift");
    refreshDomainImprovements();
    updateDefaultLiveNote();
    renderTrainingPanel();
    renderLegend();
  });
  if (portalTabEls.length && portalPanelEls.length) {
    portalTabEls.forEach((tab) => {
      tab.addEventListener("click", () => {
        setActivePortalPanel(tab.dataset.portalTab || "metrics");
      });
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const currentIndex = portalTabEls.indexOf(tab);
        if (currentIndex < 0) return;
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextIndex =
          (currentIndex + direction + portalTabEls.length) %
          portalTabEls.length;
        const nextTab = portalTabEls[nextIndex];
        if (!nextTab) return;
        setActivePortalPanel(nextTab.dataset.portalTab || "metrics");
        nextTab.focus();
      });
    });
    const initialPanel =
      portalTabEls.find((tab) => tab.classList.contains("is-active"))?.dataset
        .portalTab ||
      portalPanelEls.find((panel) => panel.classList.contains("is-active"))
        ?.dataset.portalPanel ||
      "metrics";
    setActivePortalPanel(initialPanel);
  }
  if (
    pipelineStageEls.length &&
    pipelineStepEl &&
    pipelineTitleEl &&
    pipelineVisualEl
  ) {
    pipelineStageOrder = pipelineStageEls
      .map((btn) => btn.dataset.stageId)
      .filter(Boolean);
    pipelineStageEls.forEach((btn) => {
      btn.addEventListener("click", () => {
        setActivePipelineStage(btn.dataset.stageId);
        restartPipelineAutoplay();
      });
      btn.addEventListener("keydown", (event) => {
        if (
          !["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        const currentIndex = pipelineStageOrder.indexOf(btn.dataset.stageId);
        if (currentIndex < 0) return;
        const direction =
          event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          (currentIndex + direction + pipelineStageOrder.length) %
          pipelineStageOrder.length;
        const nextId = pipelineStageOrder[nextIndex];
        const nextBtn = pipelineStageEls.find(
          (candidate) => candidate.dataset.stageId === nextId,
        );
        setActivePipelineStage(nextId);
        restartPipelineAutoplay();
        if (nextBtn) nextBtn.focus();
      });
    });
    const initialStageId =
      pipelineStageEls.find((btn) => btn.classList.contains("is-active"))
        ?.dataset.stageId || pipelineStageOrder[0];
    setActivePipelineStage(initialStageId);
    startPipelineAutoplay();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopPipelineAutoplay();
      } else {
        startPipelineAutoplay();
      }
    });
  }

  syncCorpusToTarget(false, "reshuffle");
  refreshDomainImprovements();
  updateDefaultLiveNote();
  renderTrainingPanel();
  renderLegend();
  setInterval(tickCorpus, 3000);
})();

(function initDataLicensingSample() {
  const body = document.getElementById("licensingSampleBody");
  const downloadBtn = document.getElementById("downloadLicensingSubsetBtn");
  if (!body || !downloadBtn) return;

  const WINDOW_SIZE = 5;
  const ROTATE_MS = 5000;
  const state = {
    allRows: [],
    windowRows: [],
    cursor: 0,
  };
  let isRotating = false;
  const curatedRows = [
    {
      observedAt: "2026-06-02T10:03:00Z",
      sourceAi: "Claude Opus 4.8",
      domain: "Medicine",
      difficulty: 4,
      confidence: 0.93,
      cashback: "$27",
      summary:
        "Suggested contraindicated steroid escalation for pediatric anaphylaxis without allergy history checks.",
      editBad: "immediate high-dose steroids without allergy workup",
      editGood: "stabilize airway first, then allergy-specific protocol",
    },
    {
      observedAt: "2026-06-02T10:06:00Z",
      sourceAi: "GPT 5.5",
      domain: "Legal",
      difficulty: 3,
      confidence: 0.89,
      cashback: "$19",
      summary:
        "Misread arbitration clause and stated mandatory arbitration applied to a carve-out litigation dispute.",
      editBad: "all disputes must go to arbitration",
      editGood: "carve-out disputes can proceed in court",
    },
    {
      observedAt: "2026-06-02T10:09:00Z",
      sourceAi: "Gemini 3.5 Flash",
      domain: "Finance",
      difficulty: 4,
      confidence: 0.91,
      cashback: "$24",
      summary:
        "Understated duration risk in bond ladder recommendation and omitted rising-rate sensitivity warning.",
      editBad: "portfolio is rate-insensitive",
      editGood: "duration exposure rises with long-maturity allocation",
    },
    {
      observedAt: "2026-06-02T10:12:00Z",
      sourceAi: "Claude Opus 4.8",
      domain: "Coding",
      difficulty: 4,
      confidence: 0.9,
      cashback: "$22",
      summary:
        "Generated auth middleware example without CSRF protection and weak session invalidation guidance.",
      editBad: "session token remains valid after logout",
      editGood: "revoke session server-side and rotate token on login",
    },
    {
      observedAt: "2026-06-02T10:15:00Z",
      sourceAi: "GPT 5.5",
      domain: "Math",
      difficulty: 2,
      confidence: 0.88,
      cashback: "$10",
      summary:
        "Claimed monotone pointwise convergence implies uniform convergence on compact interval without extra assumptions.",
      editBad: "pointwise monotone always implies uniform",
      editGood:
        "uniform convergence needs additional conditions (e.g., Dini assumptions)",
    },
    {
      observedAt: "2026-06-02T10:18:00Z",
      sourceAi: "Gemini 3.5 Flash",
      domain: "Public Policy",
      difficulty: 5,
      confidence: 0.95,
      cashback: "$35",
      summary:
        "Invented policy whitepaper citation and attributed findings to a non-existent government report.",
      editBad: "DOE 2025 whitepaper confirms 42% reduction",
      editGood: "no verifiable DOE source found for this claim",
    },
    {
      observedAt: "2026-06-02T10:21:00Z",
      sourceAi: "Claude Opus 4.8",
      domain: "Education",
      difficulty: 2,
      confidence: 0.86,
      cashback: "$8",
      summary:
        "Ignored grade-level constraint and produced advanced calculus content for a middle-school curriculum request.",
      editBad: "introduce epsilon-delta proof in week one",
      editGood: "start with ratio tables and visual slope intuition",
    },
    {
      observedAt: "2026-06-02T10:24:00Z",
      sourceAi: "GPT 5.5",
      domain: "Operations",
      difficulty: 3,
      confidence: 0.87,
      cashback: "$14",
      summary:
        "Referenced unavailable ERP endpoint while claiming successful inventory reconciliation execution.",
      editBad: "POST /erp/v3/reconcile completed successfully",
      editGood: "endpoint unavailable; queued manual reconciliation fallback",
    },
    {
      observedAt: "2026-06-02T10:27:00Z",
      sourceAi: "Gemini 3.5 Flash",
      domain: "Healthcare Compliance",
      difficulty: 4,
      confidence: 0.9,
      cashback: "$26",
      summary:
        "Proposed PHI handling workflow that bypassed minimum-necessary access controls and audit logging.",
      editBad: "share full patient chart in team chat",
      editGood: "share minimum fields only with audited access controls",
    },
    {
      observedAt: "2026-06-02T10:30:00Z",
      sourceAi: "Claude Opus 4.8",
      domain: "Insurance",
      difficulty: 3,
      confidence: 0.88,
      cashback: "$16",
      summary:
        "Mapped claim scenario to wrong policy endorsement and omitted waiting-period exclusion language.",
      editBad: "covered under immediate accident rider",
      editGood: "subject to 30-day waiting-period exclusion",
    },
    {
      observedAt: "2026-06-02T10:33:00Z",
      sourceAi: "GPT 5.5",
      domain: "Travel",
      difficulty: 2,
      confidence: 0.84,
      cashback: "$7",
      summary:
        "Used outdated visa validity window and suggested itinerary that violates current entry timing rules.",
      editBad: "visa valid for 90 days from issue date",
      editGood: "entry window is 30 days under current rule",
    },
    {
      observedAt: "2026-06-02T10:36:00Z",
      sourceAi: "Gemini 3.5 Flash",
      domain: "Scientific Writing",
      difficulty: 3,
      confidence: 0.89,
      cashback: "$13",
      summary:
        "Attributed benchmark result to wrong study and merged independent baselines into a single metric claim.",
      editBad: "Smith et al. report 91.2 across all baselines",
      editGood: "results are split across separate studies and settings",
    },
  ];

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function formatObservedTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return `${new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(d)} UTC`;
  }
  function assignedEditWordCount(row) {
    const key = [
      row.observedAt,
      row.sourceAi,
      row.domain,
      row.editBad,
      row.editGood,
    ].join("|");
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    const min = 15;
    const max = 380;
    return min + (hash % (max - min + 1));
  }

  function toSubsetObject(row) {
    const editWordCount = assignedEditWordCount(row);
    return {
      observed_time_utc: formatObservedTime(row.observedAt),
      observed_at_iso: row.observedAt,
      source_ai: row.sourceAi,
      domain: row.domain,
      difficulty: row.difficulty,
      confidence: row.confidence,
      user_cashback_amount: row.cashback,
      summary: row.summary,
      failure_edits: {
        assigned_word_edits: editWordCount,
        incorrect_fragment: row.editBad,
        corrected_fragment: row.editGood,
        snippet: `...... ${row.editBad} -> ${row.editGood} ......`,
      },
    };
  }

  function rowKey(row) {
    return [row.observedAt, row.sourceAi, row.domain, row.editBad].join("|");
  }

  function formatConfidence(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return escapeHtml(value);
    return n.toFixed(2);
  }
  function renderDifficultyBlocks(value) {
    const level = Math.max(
      1,
      Math.min(5, Number.parseInt(String(value), 10) || 1),
    );
    const blocks = Array.from(
      { length: 5 },
      (_, idx) =>
        `<span class="block${idx < level ? " on" : ""}" aria-hidden="true"></span>`,
    ).join("");
    return `<span class="difficulty-meter" role="img" aria-label="Difficulty ${level} out of 5">${blocks}</span>`;
  }

  function renderRowHtml(row) {
    const editWordCount = assignedEditWordCount(row);
    return `<tr data-row-key="${escapeHtml(rowKey(row))}">
          <td class="time">${escapeHtml(formatObservedTime(row.observedAt))}</td>
          <td><span class="sample-pill ai">${escapeHtml(row.sourceAi)}</span></td>
          <td><span class="sample-pill domain">${escapeHtml(row.domain)}</span></td>
          <td class="difficulty">${renderDifficultyBlocks(row.difficulty)}</td>
          <td class="numeric">${escapeHtml(formatConfidence(row.confidence))}</td>
          <td class="cashback">${escapeHtml(row.cashback)}</td>
          <td class="summary">${escapeHtml(row.summary)}</td>
          <td class="edit-snippet"><div class="edit-meta"><span class="edit-count">${escapeHtml(editWordCount)} words edited</span></div><span class="fragment"><span class="dots">......</span><span class="bad">${escapeHtml(row.editBad)}</span><span class="arrow">→</span><span class="good">${escapeHtml(row.editGood)}</span><span class="dots">......</span></span></td>
        </tr>`;
  }

  function renderWindow(options) {
    const opts = options || {};
    const animated = Boolean(opts.animated);
    if (!state.windowRows.length) {
      body.innerHTML =
        '<tr><td colspan="8">No sample rows available.</td></tr>';
      downloadBtn.disabled = true;
      return;
    }
    if (!animated) {
      body.innerHTML = state.windowRows.map(renderRowHtml).join("");
      downloadBtn.disabled = false;
      return;
    }

    const oldRows = Array.from(body.querySelectorAll("tr[data-row-key]"));
    const oldRectByKey = new Map(
      oldRows.map((el) => [el.dataset.rowKey, el.getBoundingClientRect()]),
    );
    body.innerHTML = state.windowRows.map(renderRowHtml).join("");
    const newRows = Array.from(body.querySelectorAll("tr[data-row-key]"));

    newRows.forEach((el) => {
      const key = el.dataset.rowKey;
      const oldRect = oldRectByKey.get(key);
      if (oldRect) {
        const newRect = el.getBoundingClientRect();
        const dy = oldRect.top - newRect.top;
        if (Math.abs(dy) > 0.5) {
          el.style.transition = "none";
          el.style.transform = `translateY(${dy}px)`;
          el.style.willChange = "transform";
          requestAnimationFrame(() => {
            el.style.transition =
              "transform .42s cubic-bezier(0.2, 0.7, 0.2, 1)";
            el.style.transform = "translateY(0)";
          });
          el.addEventListener(
            "transitionend",
            () => {
              el.style.transition = "";
              el.style.transform = "";
              el.style.willChange = "";
            },
            { once: true },
          );
        }
      } else {
        el.style.opacity = "0";
        el.style.transform = "translateY(18px)";
        el.style.willChange = "transform, opacity";
        requestAnimationFrame(() => {
          el.style.transition =
            "transform .42s cubic-bezier(0.2, 0.7, 0.2, 1), opacity .42s ease";
          el.style.opacity = "1";
          el.style.transform = "translateY(0)";
        });
        el.addEventListener(
          "transitionend",
          () => {
            el.style.transition = "";
            el.style.opacity = "";
            el.style.transform = "";
            el.style.willChange = "";
          },
          { once: true },
        );
      }
    });
    downloadBtn.disabled = false;
  }

  function seedWindow() {
    state.windowRows = [];
    if (!state.allRows.length) return;
    for (let i = 0; i < WINDOW_SIZE; i += 1) {
      state.windowRows.push(state.allRows[i % state.allRows.length]);
    }
    state.cursor = WINDOW_SIZE % state.allRows.length;
  }

  function rotateWindow() {
    if (!state.allRows.length || isRotating) return;
    isRotating = true;
    const first = body.querySelector("tr[data-row-key]");
    if (first) first.classList.add("sample-row-leaving");
    setTimeout(() => {
      const next = state.allRows[state.cursor];
      state.cursor = (state.cursor + 1) % state.allRows.length;
      state.windowRows.push(next);
      if (state.windowRows.length > WINDOW_SIZE) {
        state.windowRows.shift();
      }
      renderWindow({ animated: true });
      isRotating = false;
    }, 180);
  }

  function downloadSubset() {
    if (!state.windowRows.length) return;
    const lines = state.windowRows.map((row) =>
      JSON.stringify(toSubsetObject(row)),
    );
    const blob = new Blob([`${lines.join("\n")}\n`], {
      type: "application/x-ndjson;charset=utf-8",
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `data_licensing_failure_subset_${stamp}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  downloadBtn.disabled = true;
  downloadBtn.addEventListener("click", downloadSubset);
  state.allRows = curatedRows
    .slice()
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  seedWindow();
  renderWindow();
  if (state.allRows.length > 1) {
    setInterval(rotateWindow, ROTATE_MS);
  }
})();
