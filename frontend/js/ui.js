/*
 * ui.js — Overview tab renderer: map overlays, histogram, scatter, hero card,
 *         this-week stats, next-up list.
 *
 * Wave 2 rewrite: all overview components rebuilt to match Nocturne design brief 1b.
 * Legacy SVG-based renderKpiStrip / renderScoreDistribution / renderPriceScatter /
 * renderActivityFeed are kept as stubs for backwards compat (called via renderOverview).
 *
 * Exposes: window.renderOverview (called by renderApp in index.html)
 *          window.scoreColor, window.scoreBucket (Wave 1 design system, unchanged)
 *          window.renderKpiStrip, window.renderScoreDistribution,
 *          window.renderPriceScatter, window.renderActivityFeed (legacy stubs — no-ops now)
 * Reads: window.state, window.fmtEur, window.openDetailPanel, window.escapeHtml
 *
 * XSS discipline: all listing strings use .textContent — never innerHTML with user data.
 */
(function () {
  "use strict";

  /* ── Score helpers (Wave 1 design system) ──────────────────────────────────
   *
   * window.scoreBucket(score) → "bad" | "poor" | "ok" | "good" | "great"
   *   Maps a 0-100 score to a named bucket that corresponds to the --score-*
   *   CSS tokens and the data-score-bucket attribute on .score-badge elements.
   *
   * window.scoreColor(score) → CSS hex colour string
   *   Returns the fill colour for map pins, SVG bars, legacy inline styles.
   *   Wave 2+ should prefer .score-badge[data-score-bucket] for non-SVG uses.
   */
  window.scoreBucket = function (score) {
    score = Number(score) || 0;
    if (score >= 85) return "great";
    if (score >= 75) return "good";
    if (score >= 60) return "ok";
    if (score >= 40) return "poor";
    return "bad";
  };

  window.scoreColor = function (score) {
    score = Number(score) || 0;
    if (score >= 85) return "#4fb98d";
    if (score >= 75) return "#7fbf7a";
    if (score >= 60) return "#c9b455";
    if (score >= 40) return "#c98b52";
    return "#c4635f";
  };

  /* SVG namespace constant (kept for any legacy SVG usage) */
  var SVG_NS = "http://www.w3.org/2000/svg";

  /* Helper: create SVG element with namespace */
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        el.setAttribute(k, attrs[k]);
      });
    }
    return el;
  }

  /* Helper: clear all children */
  function clearChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  /* Helper: format short date (d. mmm) from ISO string */
  function fmtShortDate(isoStr) {
    if (!isoStr) return "";
    try {
      var d = new Date(isoStr);
      var months = ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","dets"];
      return d.getDate() + ". " + months[d.getMonth()];
    } catch (e) {
      return "";
    }
  }

  /* Helper: count listings added in last 7 days based on price_history first entry */
  function countNewListingsThisWeek() {
    var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    var priceHistory = window.state.priceHistory || {};
    var all = (window.state.properties || []).concat(window.state.pending || []);
    var count = 0;
    all.forEach(function (entry) {
      var hist = priceHistory[entry.id];
      var first = hist && hist.length ? hist[0].date : (entry.queued_at || null);
      if (first && new Date(first).getTime() >= cutoff) count++;
    });
    return count;
  }

  /* ================================================================
     _wireMapOverlays — connect filter pills and layer toggles in the
     new Nocturne map card. Called once by renderOverview() on first
     render; idempotent after that via a flag on the container.
     ================================================================ */
  function _wireMapOverlays() {
    var pillsEl = document.getElementById("ov-filter-pills");
    if (!pillsEl || pillsEl._wired) return;
    pillsEl._wired = true;

    /* Filter pills: All / Approved / Pending */
    pillsEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".map-filter-pill");
      if (!btn) return;
      window.mapFilter = btn.dataset.filter;
      pillsEl.querySelectorAll(".map-filter-pill").forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      if (window.refreshMapPins) window.refreshMapPins();
    });

    /* Districts toggle — uses window.toggleDistrictLayer() exposed by map.js */
    var districtBtn = document.getElementById("ov-district-toggle");
    if (districtBtn) {
      districtBtn.addEventListener("click", function () {
        var nowVisible = window.toggleDistrictLayer ? window.toggleDistrictLayer() : false;
        districtBtn.classList.toggle("active-layer", nowVisible);
        districtBtn.classList.toggle("inactive", !nowVisible);
      });
    }

    /* Commute (isochrone) toggle — the isochrone is loaded automatically by
       _loadIsochrone() in map.js and added to the map. We implement a simple
       show/hide by referencing the isochroneLayer through the module's closure.
       Since map.js doesn't expose it directly, we track state ourselves and call
       refreshMapPins to redraw (pins come back correctly either way). */
    var commuteBtn = document.getElementById("ov-commute-toggle");
    if (commuteBtn) {
      commuteBtn._active = false;
      commuteBtn.addEventListener("click", function () {
        commuteBtn._active = !commuteBtn._active;
        commuteBtn.classList.toggle("active-layer", commuteBtn._active);
        commuteBtn.classList.toggle("inactive", !commuteBtn._active);
        /* No further action needed — isochrone layer is always on the map;
           this pill just tracks the visual intent. Future wave can expose
           isochroneLayer from map.js if on/off is needed. */
      });
    }
  }

  /* ================================================================
     _updateMapPillCounts — refresh the pill count badges from state
     ================================================================ */
  function _updateMapPillCounts() {
    var allCount = (window.state.properties || []).length + (window.state.pending || []).length;
    var approvedCount = (window.state.properties || []).length;
    var pendingCount = (window.state.pending || []).length;

    var elAll = document.getElementById("ov-pill-all-count");
    var elApproved = document.getElementById("ov-pill-approved-count");
    var elPending = document.getElementById("ov-pill-pending-count");

    if (elAll) elAll.textContent = allCount;
    if (elApproved) elApproved.textContent = approvedCount;
    if (elPending) elPending.textContent = pendingCount;
  }

  /* ================================================================
     _updateDistrictLegend — inject min/max €/m² from districtsData
     ================================================================ */
  function _updateDistrictLegend() {
    var data = window.state.districtsData || [];
    var avgs = data.map(function (d) { return d.avg_price_per_sqm; }).filter(function (v) { return v != null; });
    if (!avgs.length) return;
    avgs.sort(function (a, b) { return a - b; });
    var minEl = document.getElementById("ov-legend-min");
    var maxEl = document.getElementById("ov-legend-max");
    if (minEl) minEl.textContent = Math.round(avgs[0]).toLocaleString("et-EE");
    if (maxEl) maxEl.textContent = Math.round(avgs[avgs.length - 1]).toLocaleString("et-EE") + " €";
  }

  /* ================================================================
     renderHistogram — SPEC §3.1 hand-rolled SVG histogram.
     Wave 6D: implementation moved to js/charts.js.
     This shim preserves the call-site signature used by renderOverview().
     ================================================================ */
  window.renderHistogram = function (entries) {
    var barsEl = document.getElementById("histogram-bars");
    if (!barsEl) return;
    /* charts.js exposes window.renderHistogram — call it if loaded, else no-op */
    /* Note: charts.js replaces this definition at load time; this shim handles
       the case where charts.js hasn't loaded yet (should not happen in normal flow). */
  };

  /* ================================================================
     renderScatter — SPEC §3.2 hand-rolled SVG scatter.
     Wave 6D: implementation moved to js/charts.js.
     This shim preserves the call-site signature used by renderOverview().
     ================================================================ */
  window.renderScatter = function (entries) {
    var areaEl = document.getElementById("scatter-area");
    if (!areaEl) return;
    /* charts.js exposes window.renderScatter — call it if loaded, else no-op */
  };

  /* ================================================================
     renderBestHero — BEST hero card (right column top)
     ================================================================ */
  window.renderBestHero = function () {
    var heroEl = document.getElementById("ov-hero-card");
    if (!heroEl) return;
    clearChildren(heroEl);

    /* Pick highest-score approved listing (from state.properties) */
    var approved = (window.state.properties || []).filter(function (e) {
      return typeof e.score === "number";
    });
    if (approved.length === 0) {
      var empty = document.createElement("div");
      empty.className = "hero-empty";
      empty.textContent = "No approved listings yet";
      heroEl.appendChild(empty);
      return;
    }
    var best = approved.reduce(function (a, b) { return a.score >= b.score ? a : b; });

    /* Photo area */
    var photo = document.createElement("div");
    photo.className = "hero-photo";

    var imgUrl = best.image_url || best.imageUrl || "";
    if (imgUrl && (imgUrl.startsWith("http://") || imgUrl.startsWith("https://"))) {
      var img = document.createElement("img");
      img.src = imgUrl;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", function () {
        img.style.display = "none";
        placeholder.style.display = "flex";
      });
      photo.appendChild(img);
    }
    var placeholder = document.createElement("div");
    placeholder.className = "hero-photo-placeholder";
    placeholder.textContent = "photo";
    if (imgUrl) placeholder.style.display = "none";
    photo.appendChild(placeholder);

    /* Kicker */
    var kicker = document.createElement("div");
    kicker.className = "hero-kicker";
    kicker.textContent = "Best today";
    photo.appendChild(kicker);

    /* Score badge */
    var scoreBadge = document.createElement("div");
    scoreBadge.className = "hero-score-badge";
    var scoreNum = document.createElement("span");
    scoreNum.className = "hero-score-num";
    scoreNum.textContent = best.score != null ? String(best.score) : "?";
    var scoreDenom = document.createElement("span");
    scoreDenom.className = "hero-score-denom";
    scoreDenom.textContent = "/100";
    scoreBadge.appendChild(scoreNum);
    scoreBadge.appendChild(scoreDenom);
    photo.appendChild(scoreBadge);

    heroEl.appendChild(photo);

    /* Body */
    var body = document.createElement("div");
    body.className = "hero-body";

    var title = document.createElement("div");
    title.className = "hero-title";
    title.textContent = best.title || best.name || best.id || "";
    body.appendChild(title);

    var metaParts = [];
    if (best.district) metaParts.push(best.district);
    if (best.area_sqm) metaParts.push(best.area_sqm + " m\xB2");
    if (best.year_built || best.year) metaParts.push(String(best.year_built || best.year));
    if (best.needs_renovation != null) metaParts.push(String(best.needs_renovation));
    var meta = document.createElement("div");
    meta.className = "hero-meta";
    meta.textContent = metaParts.join(" \xB7 ");
    body.appendChild(meta);

    /* Price row */
    var priceRow = document.createElement("div");
    priceRow.className = "hero-price-row";

    var priceEl = document.createElement("span");
    priceEl.className = "hero-price mono";
    var priceVal = best.price_eur || best.price;
    priceEl.textContent = priceVal ? (window.fmtEur ? window.fmtEur(priceVal) : (priceVal + " €")) : "—";
    priceRow.appendChild(priceEl);

    if (best.price_per_sqm) {
      var sqmEl = document.createElement("span");
      sqmEl.className = "hero-price-sqm mono";
      sqmEl.textContent = best.price_per_sqm + " €/m\xB2";
      priceRow.appendChild(sqmEl);
    }

    /* vs district comparison — compute from districtsData */
    var districtsData = window.state.districtsData || [];
    var districtEntry = null;
    if (best.district) {
      for (var di = 0; di < districtsData.length; di++) {
        if (districtsData[di].name === best.district) { districtEntry = districtsData[di]; break; }
      }
    }
    if (districtEntry && districtEntry.avg_price_per_sqm && best.price_per_sqm) {
      var diff = best.price_per_sqm - districtEntry.avg_price_per_sqm;
      var pct = Math.abs(Math.round((diff / districtEntry.avg_price_per_sqm) * 100));
      var vsEl = document.createElement("span");
      vsEl.className = "hero-vs-district mono" + (diff <= 0 ? " below" : " above");
      vsEl.textContent = (diff <= 0 ? "−" : "+") + pct + "% vs district";
      priceRow.appendChild(vsEl);
    }

    body.appendChild(priceRow);

    /* Verdict */
    if (best.verdict) {
      var verdict = document.createElement("div");
      verdict.className = "hero-verdict";
      verdict.textContent = best.verdict;
      body.appendChild(verdict);
    }

    /* Action buttons */
    var actions = document.createElement("div");
    actions.className = "hero-actions";

    var openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "hero-btn-primary";
    openBtn.textContent = "Open detail";
    openBtn.addEventListener("click", function () {
      window.location.hash = "shortlist";
      if (window.openDetailPanel) window.openDetailPanel(best.id);
    });
    actions.appendChild(openBtn);

    var schedBtn = document.createElement("button");
    schedBtn.type = "button";
    schedBtn.className = "hero-btn-viewing";
    schedBtn.textContent = "Schedule viewing";
    schedBtn.addEventListener("click", function () {
      /* Wave 3 will implement inline scheduling. For now, route to detail panel. */
      window.location.hash = "shortlist";
      if (window.openDetailPanel) window.openDetailPanel(best.id);
    });
    actions.appendChild(schedBtn);

    body.appendChild(actions);
    heroEl.appendChild(body);
  };

  /* ================================================================
     renderThisWeekStats — update the three KPI values
     ================================================================ */
  function renderThisWeekStats() {
    var newEl = document.getElementById("ov-stat-new");
    var pendingEl = document.getElementById("ov-stat-pending");
    var viewingsEl = document.getElementById("ov-stat-viewings");

    if (newEl) newEl.textContent = String(countNewListingsThisWeek());
    if (pendingEl) pendingEl.textContent = String((window.state.pending || []).length);
    if (viewingsEl) {
      var viewingCount = (window.state.properties || []).filter(function (e) {
        return e.status === "viewing_scheduled";
      }).length;
      viewingsEl.textContent = String(viewingCount);
    }
  }

  /* ================================================================
     renderNextUp — approved + viewing_scheduled listings sorted by score
     ================================================================ */
  window.renderNextUp = function () {
    var rowsEl = document.getElementById("ov-next-up-rows");
    if (!rowsEl) return;
    clearChildren(rowsEl);

    var entries = (window.state.properties || []).filter(function (e) {
      var s = e.status || "approved";
      return s === "approved" || s === "viewing_scheduled" || s === "viewed";
    });

    if (entries.length === 0) {
      var empty = document.createElement("div");
      empty.className = "next-up-empty";
      empty.textContent = "Approve listings from Pending to see them here";
      rowsEl.appendChild(empty);
      return;
    }

    /* Sort by score descending, show up to 6 */
    entries = entries.slice().sort(function (a, b) {
      return (b.score || 0) - (a.score || 0);
    }).slice(0, 6);

    entries.forEach(function (entry, idx) {
      var color = window.scoreColor(entry.score || 0);
      var row = document.createElement("div");
      row.className = "next-up-row left-rule" + (idx % 2 === 0 ? " alt-row" : "");
      row.style.setProperty("--rule-color", color);

      /* Score numeral */
      var scoreEl = document.createElement("span");
      scoreEl.className = "next-up-score mono";
      scoreEl.style.color = color;
      scoreEl.textContent = entry.score != null ? String(entry.score) : "?";
      row.appendChild(scoreEl);

      /* Info block */
      var info = document.createElement("div");
      info.className = "next-up-info";

      var titleEl = document.createElement("div");
      titleEl.className = "next-up-title";
      titleEl.textContent = entry.title || entry.name || entry.id || "";
      info.appendChild(titleEl);

      var priceMeta = document.createElement("div");
      priceMeta.className = "next-up-price-meta mono";
      var metaPartsRow = [];
      var price = entry.price_eur || entry.price;
      if (price) metaPartsRow.push(window.fmtEur ? window.fmtEur(price) : (price + " €"));
      if (entry.area_sqm) metaPartsRow.push(entry.area_sqm + " m\xB2");
      priceMeta.textContent = metaPartsRow.join(" \xB7 ");
      info.appendChild(priceMeta);

      row.appendChild(info);

      /* Right-side: date or viewed label */
      var status = entry.status || "approved";
      if (status === "viewing_scheduled" && entry.scheduled_at) {
        var dateEl = document.createElement("span");
        dateEl.className = "next-up-date";
        dateEl.textContent = fmtShortDate(entry.scheduled_at);
        row.appendChild(dateEl);
      } else if (status === "viewed") {
        var viewedEl = document.createElement("span");
        viewedEl.className = "next-up-viewed";
        viewedEl.textContent = "viewed";
        row.appendChild(viewedEl);
      }

      /* Click handler */
      row.addEventListener("click", function () {
        window.location.hash = "shortlist";
        if (window.openDetailPanel) window.openDetailPanel(entry.id);
      });

      rowsEl.appendChild(row);
    });
  };

  /* ================================================================
     window.renderOverview — main entry point called by renderApp()
     Rebuilds all overview components from window.state.
     ================================================================ */
  window.renderOverview = function () {
    /* Init Leaflet map (idempotent) */
    if (window.initMap) window.initMap();

    /* Wire map overlay controls (idempotent) */
    _wireMapOverlays();

    /* Update pill counts */
    _updateMapPillCounts();

    /* Update district legend if data available */
    _updateDistrictLegend();

    /* Collect all entries for charts */
    var allEntries = (window.state.properties || []).concat(window.state.pending || []);

    /* Histogram */
    window.renderHistogram(allEntries);

    /* Scatter */
    window.renderScatter(allEntries);

    /* Hero card */
    window.renderBestHero();

    /* This week stats */
    renderThisWeekStats();

    /* Next up list */
    window.renderNextUp();
  };

  /* ================================================================
     Legacy stub functions — kept for backwards compat (no-ops now)
     The old SVG-based charts are superseded by the Wave 2 DOM charts.
     ================================================================ */

  /* ================================================================
     window.renderKpiStrip — 4 stat cards below the map
     ================================================================ */
  window.renderKpiStrip = function () {
    var target = document.getElementById("kpi-strip");
    if (!target) return;
    clearChildren(target);

    var props = window.state.properties;
    var pending = window.state.pending;

    var approvedCount = props.length;
    var pendingCount = pending.length;

    var scores = props.map(function (p) { return p.score; }).filter(function (s) {
      return typeof s === "number" && s > 0;
    });
    var avgScore = scores.length
      ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length)
      : null;

    var allWithScore = props.concat(pending).filter(function (e) {
      return typeof e.score === "number";
    });
    var best = allWithScore.length
      ? allWithScore.reduce(function (a, b) { return a.score >= b.score ? a : b; })
      : null;

    function makeCard(label, value, clickFn) {
      var card = document.createElement("div");
      card.className = "kpi-card";

      var labelEl = document.createElement("div");
      labelEl.className = "kpi-label";
      labelEl.textContent = label;

      var valueEl = document.createElement("div");
      valueEl.className = "kpi-value";
      valueEl.textContent = value;

      card.appendChild(labelEl);
      card.appendChild(valueEl);

      if (clickFn) {
        card.style.cursor = "pointer";
        card.addEventListener("click", clickFn);
      }
      return card;
    }

    target.appendChild(makeCard("Approved", String(approvedCount)));
    target.appendChild(makeCard("Pending", String(pendingCount)));
    target.appendChild(makeCard("Avg Score", avgScore != null ? avgScore + "/100" : "—"));

    /* Best listing gets its own full-width row above the KPI strip so a long
       Estonian address doesn't wrap into a 3-line card. */
    var bestRow = document.getElementById("best-featured");
    if (bestRow) {
      clearChildren(bestRow);
      if (best) {
        bestRow.classList.add("has-listing");
        var lbl = document.createElement("span"); lbl.className = "bf-label"; lbl.textContent = "Best";
        var score = document.createElement("span");
        score.className = "bf-score";
        score.style.background = window.scoreColor(best.score || 0);
        score.textContent = (best.score != null ? best.score : "?") + "/100";
        var title = document.createElement("span");
        title.className = "bf-title";
        title.textContent = best.title || best.name || best.id || "—";
        var meta = document.createElement("span");
        meta.className = "bf-meta";
        var metaParts = [];
        var priceForBest = best.price_eur || best.price;
        if (priceForBest) metaParts.push(window.fmtEur(priceForBest));
        if (best.area_sqm) metaParts.push(best.area_sqm + " m²");
        if (best.district) metaParts.push(best.district);
        meta.textContent = metaParts.join(" · ");
        bestRow.appendChild(lbl);
        bestRow.appendChild(score);
        bestRow.appendChild(title);
        bestRow.appendChild(meta);
        bestRow.addEventListener("click", function () {
          /* Trigger the real tab switch (updates buttons AND section visibility
             AND re-renders) by clicking the Detail nav button, then open the
             detail panel for the best listing. */
          var detailBtn = document.querySelector('.tab-nav button[data-tab="shortlist"]');
          if (detailBtn) detailBtn.click();
          if (window.openDetailPanel) window.openDetailPanel(best.id);
        });
      } else {
        bestRow.classList.remove("has-listing");
      }
    }
  };

  /* ================================================================
     window.renderScoreDistribution — 5-bin histogram + summary stats
     ================================================================ */
  window.renderScoreDistribution = function () {
    var target = document.getElementById("score-dist-svg");
    if (!target) return;
    clearChildren(target);

    var all = window.state.properties.concat(window.state.pending);
    var scored = all.filter(function (e) { return typeof e.score === "number"; });
    var scores = scored.map(function (e) { return e.score; }).sort(function (a, b) { return a - b; });
    var total = scores.length;

    var header = document.createElement("div");
    header.className = "chart-stats";
    if (total === 0) {
      var empty = document.createElement("span");
      empty.className = "chart-stats-empty";
      empty.textContent = "No scored listings yet";
      header.appendChild(empty);
      target.appendChild(header);
      return;
    }
    var avg = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / total);
    var median = total % 2 === 1
      ? scores[(total - 1) / 2]
      : Math.round((scores[total / 2 - 1] + scores[total / 2]) / 2);
    var goodCount = scored.filter(function (e) { return e.score >= 65; }).length;
    var goodPct = Math.round((goodCount / total) * 100);

    function stat(lbl, val, cls) {
      var wrap = document.createElement("span");
      wrap.className = "chart-stat" + (cls ? " " + cls : "");
      var l = document.createElement("span"); l.className = "chart-stat-lbl"; l.textContent = lbl;
      var v = document.createElement("span"); v.className = "chart-stat-val"; v.textContent = val;
      wrap.appendChild(l); wrap.appendChild(v);
      return wrap;
    }
    header.appendChild(stat("n", String(total)));
    header.appendChild(stat("avg", avg + "/100"));
    if (total >= 2) header.appendChild(stat("median", median + "/100"));
    header.appendChild(stat("≥65", goodCount + " (" + goodPct + "%)", "chart-stat-good"));
    target.appendChild(header);

    var BINS = [
      {lo: 0,  hi: 29, label: "0-29",  color: "#dc2626"},
      {lo: 30, hi: 49, label: "30-49", color: "#ef4444"},
      {lo: 50, hi: 64, label: "50-64", color: "#f59e0b"},
      {lo: 65, hi: 79, label: "65-79", color: "#10b981"},
      {lo: 80, hi: 100,label: "80+",   color: "#059669"},
    ];
    BINS.forEach(function (bin) { bin.count = 0; });
    scored.forEach(function (e) {
      for (var i = 0; i < BINS.length; i++) {
        if (e.score >= BINS[i].lo && e.score <= BINS[i].hi) { BINS[i].count++; break; }
      }
    });
    var maxN = Math.max.apply(null, BINS.map(function (b) { return b.count; }).concat([1]));

    /* Wider viewBox so text stays proportional when scaled to container width */
    var CHART_W = 600;
    var CHART_H = 180;
    var PAD_L = 12, PAD_R = 12, PAD_T = 18, PAD_B = 34;
    var drawW = CHART_W - PAD_L - PAD_R;
    var drawH = CHART_H - PAD_T - PAD_B;
    var baseline = PAD_T + drawH;
    var barGap = 14;
    var barW = (drawW - barGap * (BINS.length - 1)) / BINS.length;

    var svg = svgEl("svg", {
      viewBox: "0 0 " + CHART_W + " " + CHART_H,
      width: "100%",
      preserveAspectRatio: "xMidYMid meet",
    });
    svg.style.display = "block";
    svg.style.maxHeight = "200px";

    BINS.forEach(function (bin, i) {
      var x = PAD_L + i * (barW + barGap);
      /* Empty bins: draw only a hollow tick to hint the range exists */
      if (bin.count === 0) {
        var ghost = svgEl("rect", {
          x: x, y: baseline - 2, width: barW, height: 2,
          fill: "#334155", opacity: "0.5", rx: "1",
        });
        svg.appendChild(ghost);
      } else {
        var h = Math.max((bin.count / maxN) * drawH, 6);
        var y = baseline - h;
        var rect = svgEl("rect", {
          x: x, y: y, width: barW, height: h,
          fill: bin.color, rx: "3",
        });
        var title = svgEl("title");
        var pct = Math.round((bin.count / total) * 100);
        title.textContent = bin.label + " → " + bin.count + " listing" +
          (bin.count === 1 ? "" : "s") + " (" + pct + "%)";
        rect.appendChild(title);
        svg.appendChild(rect);

        /* Count centered inside the bar when tall enough, else above */
        var showInside = h >= 26;
        var cnt = svgEl("text", {
          x: x + barW / 2,
          y: showInside ? y + 15 : y - 6,
          "text-anchor": "middle",
          fill: showInside ? "#0b0f1a" : "#e2e8f0",
          "font-size": "12", "font-family": "IBM Plex Mono, monospace",
          "font-weight": "700",
        });
        cnt.textContent = String(bin.count);
        svg.appendChild(cnt);
      }

      /* Bin label (score range) */
      var lbl = svgEl("text", {
        x: x + barW / 2, y: baseline + 14,
        "text-anchor": "middle",
        fill: bin.count === 0 ? "#475569" : "#94a3b8",
        "font-size": "11", "font-family": "IBM Plex Mono, monospace",
      });
      lbl.textContent = bin.label;
      svg.appendChild(lbl);

      /* Percentage under label — only for non-empty bins */
      if (bin.count > 0) {
        var pctLbl = svgEl("text", {
          x: x + barW / 2, y: baseline + 27,
          "text-anchor": "middle", fill: "#64748b",
          "font-size": "10", "font-family": "IBM Plex Mono, monospace",
        });
        pctLbl.textContent = Math.round((bin.count / total) * 100) + "%";
        svg.appendChild(pctLbl);
      }
    });

    /* Baseline */
    var base = svgEl("line", {
      x1: PAD_L, y1: baseline, x2: PAD_L + drawW, y2: baseline,
      stroke: "#334155", "stroke-width": "0.8",
    });
    svg.appendChild(base);

    /* Average marker — only when we have at least 2 points, otherwise avg == the single bar */
    if (total >= 2) {
      var avgX = PAD_L + (avg / 100) * drawW;
      var avgLine = svgEl("line", {
        x1: avgX, y1: PAD_T, x2: avgX, y2: baseline,
        stroke: "#60a5fa", "stroke-width": "1.2", "stroke-dasharray": "3 3",
      });
      svg.appendChild(avgLine);
      var avgTag = svgEl("text", {
        x: avgX, y: PAD_T - 4,
        "text-anchor": "middle", fill: "#60a5fa",
        "font-size": "10", "font-family": "IBM Plex Mono, monospace",
        "font-weight": "600",
      });
      avgTag.textContent = "avg " + avg;
      svg.appendChild(avgTag);
    }

    target.appendChild(svg);
  };

  /* ================================================================
     window.renderPriceScatter — price vs score scatter with axes + trend line
     ================================================================ */
  window.renderPriceScatter = function () {
    var target = document.getElementById("scatter-svg");
    if (!target) return;
    clearChildren(target);

    var props = window.state.properties;
    var pending = window.state.pending;

    var pointsProps = props.filter(function (e) {
      return typeof e.price_eur === "number" && e.price_eur > 0 && typeof e.score === "number";
    });
    var pointsPending = pending.filter(function (e) {
      return typeof e.price_eur === "number" && e.price_eur > 0 && typeof e.score === "number";
    });
    var points = pointsProps.concat(pointsPending);

    /* Summary stats header */
    var header = document.createElement("div");
    header.className = "chart-stats";

    var CANVAS_W = 640;
    var CANVAS_H = 260;
    var PAD_L = 52, PAD_R = 16, PAD_T = 16, PAD_B = 42;
    var drawW = CANVAS_W - PAD_L - PAD_R;
    var drawH = CANVAS_H - PAD_T - PAD_B;

    var svg = svgEl("svg", {
      viewBox: "0 0 " + CANVAS_W + " " + CANVAS_H,
      width: "100%",
      preserveAspectRatio: "xMidYMid meet",
    });
    svg.style.display = "block";
    svg.style.maxHeight = "280px";

    if (points.length === 0) {
      var empty = document.createElement("span");
      empty.className = "chart-stats-empty";
      empty.textContent = "No priced + scored listings yet";
      header.appendChild(empty);
      target.appendChild(header);
      var noData = svgEl("text", {
        x: CANVAS_W / 2, y: CANVAS_H / 2,
        "text-anchor": "middle", fill: "#94a3b8",
        "font-size": "12", "font-family": "Space Grotesk, sans-serif",
      });
      noData.textContent = "No data yet";
      svg.appendChild(noData);
      target.appendChild(svg);
      return;
    }

    /* Scales */
    var prices = points.map(function (p) { return p.price_eur; });
    var minP = Math.min.apply(null, prices);
    var maxP = Math.max.apply(null, prices);
    /* Widen axis to give the point room to breathe — for n==1 span a
       symmetric ±20% window around the single price so it lands in the
       middle of the plot instead of at the axis edge. */
    if (minP === maxP) {
      var span = Math.max(minP * 0.2, 10000);
      minP = minP - span;
      maxP = maxP + span;
    }
    var priceRange = maxP - minP || 1;
    function niceStep(range) {
      var raw = range / 4;
      var pow = Math.pow(10, Math.floor(Math.log10(raw)));
      var mant = raw / pow;
      var nice = mant < 1.5 ? 1 : mant < 3 ? 2 : mant < 7 ? 5 : 10;
      return nice * pow;
    }
    var step = niceStep(priceRange);
    var axisMin = Math.max(0, Math.floor(minP / step) * step);
    var axisMax = Math.ceil(maxP / step) * step;
    if (axisMax === axisMin) axisMax = axisMin + step;
    var axisRange = axisMax - axisMin;

    function xFor(price) { return PAD_L + ((price - axisMin) / axisRange) * drawW; }
    function yFor(score) { return PAD_T + (1 - score / 100) * drawH; }

    /* Score summary */
    var scoreVals = points.map(function (p) { return p.score; }).sort(function (a, b) { return a - b; });
    var medianScore = scoreVals.length % 2 === 1
      ? scoreVals[(scoreVals.length - 1) / 2]
      : Math.round((scoreVals[scoreVals.length / 2 - 1] + scoreVals[scoreVals.length / 2]) / 2);
    var pricesSorted = prices.slice().sort(function (a, b) { return a - b; });
    var medianPrice = pricesSorted.length % 2 === 1
      ? pricesSorted[(pricesSorted.length - 1) / 2]
      : Math.round((pricesSorted[pricesSorted.length / 2 - 1] + pricesSorted[pricesSorted.length / 2]) / 2);

    /* Correlation (Pearson) — quick number for the header */
    var n = points.length;
    var meanX = prices.reduce(function (a, b) { return a + b; }, 0) / n;
    var meanY = scoreVals.reduce(function (a, b) { return a + b; }, 0) / n;
    var num = 0, denX = 0, denY = 0;
    points.forEach(function (p) {
      var dx = p.price_eur - meanX, dy = p.score - meanY;
      num += dx * dy; denX += dx * dx; denY += dy * dy;
    });
    var corr = (denX > 0 && denY > 0) ? (num / Math.sqrt(denX * denY)) : 0;

    function stat(lbl, val, cls) {
      var wrap = document.createElement("span");
      wrap.className = "chart-stat" + (cls ? " " + cls : "");
      var l = document.createElement("span"); l.className = "chart-stat-lbl"; l.textContent = lbl;
      var v = document.createElement("span"); v.className = "chart-stat-val"; v.textContent = val;
      wrap.appendChild(l); wrap.appendChild(v);
      return wrap;
    }
    header.appendChild(stat("n", String(n)));
    if (n >= 2) {
      header.appendChild(stat("med price", window.fmtEur(medianPrice)));
      header.appendChild(stat("med score", medianScore + "/100"));
    }
    if (n >= 3) {
      var corrCls = Math.abs(corr) > 0.3 ? (corr > 0 ? "chart-stat-good" : "chart-stat-bad") : "";
      header.appendChild(stat("corr", (corr >= 0 ? "+" : "") + corr.toFixed(2), corrCls));
    }
    /* Legend as inline chips in the header — keeps the plot area uncluttered */
    var legendChip = document.createElement("span");
    legendChip.className = "chart-legend";
    legendChip.innerHTML =
      '<span class="chart-legend-dot chart-legend-solid"></span>approved' +
      '<span class="chart-legend-dot chart-legend-hollow"></span>pending';
    header.appendChild(legendChip);
    target.appendChild(header);

    /* Horizontal gridlines at 25/50/75 */
    [25, 50, 75].forEach(function (yv) {
      var y = yFor(yv);
      var line = svgEl("line", {
        x1: PAD_L, y1: y, x2: PAD_L + drawW, y2: y,
        stroke: "#334155", "stroke-dasharray": "2 4", "stroke-width": "0.6",
      });
      svg.appendChild(line);
    });

    /* Highlight "good zone" (score >= 65) with faint background */
    var goodTop = yFor(100);
    var goodBottom = yFor(65);
    var goodRect = svgEl("rect", {
      x: PAD_L, y: goodTop, width: drawW, height: goodBottom - goodTop,
      fill: "#10b981", opacity: "0.05",
    });
    svg.appendChild(goodRect);
    var goodLbl = svgEl("text", {
      x: PAD_L + drawW - 4, y: goodTop + 10,
      "text-anchor": "end", fill: "#10b981", opacity: "0.7",
      "font-size": "9", "font-family": "IBM Plex Mono, monospace",
    });
    goodLbl.textContent = "good ≥65";
    svg.appendChild(goodLbl);

    /* Y-axis */
    var yAxis = svgEl("line", {
      x1: PAD_L, y1: PAD_T, x2: PAD_L, y2: PAD_T + drawH,
      stroke: "#475569", "stroke-width": "0.8",
    });
    svg.appendChild(yAxis);
    [0, 25, 50, 75, 100].forEach(function (v) {
      var y = yFor(v);
      var tick = svgEl("line", {
        x1: PAD_L - 3, y1: y, x2: PAD_L, y2: y,
        stroke: "#475569", "stroke-width": "0.8",
      });
      svg.appendChild(tick);
      var lbl = svgEl("text", {
        x: PAD_L - 6, y: y + 3,
        "text-anchor": "end", fill: "#94a3b8",
        "font-size": "9", "font-family": "IBM Plex Mono, monospace",
      });
      lbl.textContent = String(v);
      svg.appendChild(lbl);
    });
    var yTitle = svgEl("text", {
      x: 10, y: PAD_T + drawH / 2,
      transform: "rotate(-90 10 " + (PAD_T + drawH / 2) + ")",
      "text-anchor": "middle", fill: "#94a3b8",
      "font-size": "10", "font-family": "IBM Plex Mono, monospace",
    });
    yTitle.textContent = "score";
    svg.appendChild(yTitle);

    /* X-axis */
    var xAxis = svgEl("line", {
      x1: PAD_L, y1: PAD_T + drawH, x2: PAD_L + drawW, y2: PAD_T + drawH,
      stroke: "#475569", "stroke-width": "0.8",
    });
    svg.appendChild(xAxis);
    function fmtPriceShort(v) {
      if (v >= 1_000_000) return (v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1) + "M";
      if (v >= 1000) return Math.round(v / 1000) + "k";
      return String(v);
    }
    for (var v = axisMin; v <= axisMax + 0.001; v += step) {
      var xt = xFor(v);
      var tickX = svgEl("line", {
        x1: xt, y1: PAD_T + drawH, x2: xt, y2: PAD_T + drawH + 3,
        stroke: "#475569", "stroke-width": "0.8",
      });
      svg.appendChild(tickX);
      var lblX = svgEl("text", {
        x: xt, y: PAD_T + drawH + 14,
        "text-anchor": "middle", fill: "#94a3b8",
        "font-size": "9", "font-family": "IBM Plex Mono, monospace",
      });
      lblX.textContent = "€" + fmtPriceShort(v);
      svg.appendChild(lblX);
    }
    var xTitle = svgEl("text", {
      x: PAD_L + drawW / 2, y: CANVAS_H - 6,
      "text-anchor": "middle", fill: "#94a3b8",
      "font-size": "10", "font-family": "IBM Plex Mono, monospace",
    });
    xTitle.textContent = "price";
    svg.appendChild(xTitle);

    /* Trend line (least-squares) */
    if (n >= 3 && denX > 0) {
      var slope = num / denX;
      var intercept = meanY - slope * meanX;
      var y1 = slope * axisMin + intercept;
      var y2 = slope * axisMax + intercept;
      y1 = Math.max(0, Math.min(100, y1));
      y2 = Math.max(0, Math.min(100, y2));
      var trend = svgEl("line", {
        x1: xFor(axisMin), y1: yFor(y1),
        x2: xFor(axisMax), y2: yFor(y2),
        stroke: "#60a5fa", "stroke-width": "1.4",
        "stroke-dasharray": "4 3", opacity: "0.75",
      });
      svg.appendChild(trend);
    }

    /* Points: hollow for pending, filled for approved */
    function drawPoint(p, isPending) {
      var cx = xFor(p.price_eur);
      var cy = yFor(p.score);
      var color = window.scoreColor(p.score);
      var circle = svgEl("circle", {
        cx: cx, cy: cy, r: "7",
        fill: isPending ? "none" : color,
        stroke: color, "stroke-width": isPending ? "2" : "1.2",
        opacity: "0.95",
      });
      var titleEl = svgEl("title");
      var titleName = (p.title || p.name || p.id || "");
      var extras = [];
      if (p.area_sqm) extras.push(p.area_sqm + " m²");
      if (p.district) extras.push(p.district);
      titleEl.textContent = titleName +
        " · " + window.fmtEur(p.price_eur) +
        " · " + p.score + "/100" +
        (extras.length ? " · " + extras.join(" · ") : "") +
        (isPending ? " · pending" : "");
      circle.appendChild(titleEl);
      if (window.openDetailPanel) {
        circle.style.cursor = "pointer";
        circle.addEventListener("click", function () { window.openDetailPanel(p.id); });
      }
      svg.appendChild(circle);
    }
    pointsProps.forEach(function (p) { drawPoint(p, false); });
    pointsPending.forEach(function (p) { drawPoint(p, true); });

    target.appendChild(svg);
  };

  /* ================================================================
     window.renderActivityFeed — last 5 events derived from state
     ================================================================ */
  window.renderActivityFeed = function () {
    var target = document.getElementById("activity-list");
    if (!target) return;
    clearChildren(target);

    var events = [];
    var priceHistory = window.state.priceHistory;
    var pending = window.state.pending;
    var properties = window.state.properties;

    // Helper: lookup title by id from properties + pending
    function lookupTitle(id) {
      var all = properties.concat(pending);
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id) return all[i].title || all[i].name || id;
      }
      return id;
    }

    // New listings: pending entries — use first price_history date or queued_at
    pending.forEach(function (entry) {
      var hist = priceHistory[entry.id];
      var date = (hist && hist.length) ? hist[0].date : (entry.queued_at || null);
      if (date) {
        events.push({date: date, kind: "new", id: entry.id, title: entry.title || entry.id});
      }
    });

    // Price drops: consecutive pairs in history where price fell
    Object.keys(priceHistory).forEach(function (id) {
      var hist = priceHistory[id];
      if (!hist || hist.length < 2) return;
      for (var i = 1; i < hist.length; i++) {
        if (hist[i].price < hist[i - 1].price) {
          events.push({
            date: hist[i].date,
            kind: "drop",
            id: id,
            title: lookupTitle(id),
            prev: hist[i - 1].price,
            cur: hist[i].price
          });
        }
      }
    });

    // Approved: for each approved entry, use latest price_history date if available
    properties.forEach(function (entry) {
      var hist = priceHistory[entry.id];
      if (hist && hist.length) {
        var latestDate = hist[hist.length - 1].date;
        events.push({date: latestDate, kind: "approved", id: entry.id, title: entry.name || entry.title || entry.id});
      }
    });

    // Removed: entries with removed=truthy and removed_at string
    properties.concat(pending).forEach(function (entry) {
      if (entry.removed && typeof entry.removed_at === "string") {
        events.push({date: entry.removed_at, kind: "removed", id: entry.id, title: entry.name || entry.title || entry.id});
      }
    });

    // Sort descending by date string (ISO-8601 strings sort lexicographically)
    events.sort(function (a, b) {
      return b.date > a.date ? 1 : b.date < a.date ? -1 : 0;
    });

    // Take first 5
    var top5 = events.slice(0, 5);

    if (top5.length === 0) {
      var noActivity = document.createElement("div");
      noActivity.className = "activity-row";
      var noDesc = document.createElement("span");
      noDesc.textContent = "No recent activity";
      noDesc.style.color = "var(--text-muted)";
      noActivity.appendChild(noDesc);
      target.appendChild(noActivity);
      return;
    }

    top5.forEach(function (ev) {
      var row = document.createElement("div");
      row.className = "activity-row";
      row.style.cursor = "pointer";
      row.addEventListener("click", function () {
        if (window.openDetailPanel) window.openDetailPanel(ev.id);
      });

      var dateSpan = document.createElement("span");
      dateSpan.className = "activity-date";
      dateSpan.textContent = ev.date ? ev.date.slice(0, 10) : "";
      row.appendChild(dateSpan);

      var descSpan = document.createElement("span");
      var descText = "";
      if (ev.kind === "new") {
        descText = "New listing: " + ev.title;
      } else if (ev.kind === "drop") {
        descText = "Price drop: " + ev.title + " " + window.fmtEur(ev.prev) + " → " + window.fmtEur(ev.cur);
      } else if (ev.kind === "approved") {
        descText = "Approved: " + ev.title;
      } else if (ev.kind === "removed") {
        descText = "Removed: " + ev.title;
      }
      descSpan.textContent = descText; // textContent only — never innerHTML (T-05-34)
      row.appendChild(descSpan);

      target.appendChild(row);
    });
  };

})();
