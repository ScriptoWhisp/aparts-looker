/*
 * charts.js — Hand-rolled SVG charts per SPEC §3.
 *
 * Wave 6D: replaces the div-based histogram + DOM-dot scatter from ui.js.
 * Exports (on window): renderHistogram(entries, container), renderScatter(entries, container)
 *
 * Both charts:
 *   - Pure SVG, no chart lib
 *   - escapeHtml() on every tooltip string
 *   - Preserve call-site signatures: renderHistogram(entries, container),
 *     renderScatter(entries, container)
 *   - Hover popovers via <foreignObject> (histogram) and positioned .card div (scatter)
 *
 * SPEC §3 compliance notes:
 *   - Histogram: 10 bins, scoreColor fill, border-radius shimmed with SVG rx, 1px --border-strong
 *     baseline, ticks at 0/25/50/75/100, 75-tick label, hover popover.
 *   - Scatter: r=4.5 dots, r=5.5 + halo for shortlisted, dashed budget line, two-edge frame,
 *     hover card positioned + clamped.
 */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  /* ── Helper: create SVG element ──────────────────────────────────── */
  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  /* ── Helper: escapeHtml ──────────────────────────────────────────── */
  function escapeHtml(str) {
    if (window.escapeHtml) return window.escapeHtml(str);
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ── Helper: clear container ─────────────────────────────────────── */
  function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  /* ── Helper: getComputedVar — read CSS custom property ───────────── */
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  /* ================================================================
     renderHistogram — SPEC §3.1
     10 bins, <rect> per bar, fill = scoreColor(binMidpoint),
     1px --border-strong baseline, ticks at 0/25/50/75/100.
     75-tick label = "75 · approve line" in --text-3.
     Header right: "median N · n=M" in mono.
     Hover: bar full opacity + <foreignObject> popover.
     ================================================================ */
  window.renderHistogram = function (entries, container) {
    /* Accept old call-site (no container arg — finds by id) for compat */
    var barsEl = container || document.getElementById("histogram-bars");
    var metaEl = document.getElementById("histogram-meta");
    if (!barsEl) return;
    clearEl(barsEl);

    var scored = (entries || []).filter(function (e) { return typeof e.score === "number"; });
    var total = scored.length;

    if (metaEl) {
      if (total === 0) { metaEl.textContent = "n=0"; return; }
      var scores = scored.map(function (e) { return e.score; }).sort(function (a, b) { return a - b; });
      var median = total % 2 === 1
        ? scores[Math.floor((total - 1) / 2)]
        : Math.round((scores[total / 2 - 1] + scores[total / 2]) / 2);
      metaEl.textContent = "median " + median + " \xB7 n=" + total;
    }

    if (total === 0) return;

    /* 10 buckets per SPEC — midpoints drive scoreColor */
    var BUCKETS = [
      {lo: 0,  hi: 9,   mid: 5},
      {lo: 10, hi: 19,  mid: 15},
      {lo: 20, hi: 29,  mid: 25},
      {lo: 30, hi: 39,  mid: 35},
      {lo: 40, hi: 49,  mid: 45},
      {lo: 50, hi: 59,  mid: 55},
      {lo: 60, hi: 69,  mid: 65},
      {lo: 70, hi: 74,  mid: 72},
      {lo: 75, hi: 84,  mid: 80},
      {lo: 85, hi: 100, mid: 90},
    ];
    BUCKETS.forEach(function (b) { b.count = 0; });
    scored.forEach(function (e) {
      for (var i = 0; i < BUCKETS.length; i++) {
        if (e.score >= BUCKETS[i].lo && e.score <= BUCKETS[i].hi) { BUCKETS[i].count++; break; }
      }
    });
    var maxCount = Math.max.apply(null, BUCKETS.map(function (b) { return b.count; }).concat([1]));

    /* SVG dimensions */
    var W = barsEl.clientWidth || 280;
    var H = 96;
    var PAD_B = 18; /* space for ticks below baseline */
    var PAD_L = 0;
    var BAR_AREA_H = H - PAD_B;
    var nBars = BUCKETS.length;
    var gap = 3;
    var barW = Math.max(2, Math.floor((W - PAD_L - (nBars - 1) * gap) / nBars));

    var svg = svgEl("svg", {
      width: W,
      height: H,
      viewBox: "0 0 " + W + " " + H,
      style: "display:block;overflow:visible;"
    });

    /* Baseline: 1px --border-strong */
    var borderStrong = cssVar("--border-strong", "#3f424d");
    svg.appendChild(svgEl("line", {
      x1: PAD_L, y1: BAR_AREA_H,
      x2: W,     y2: BAR_AREA_H,
      stroke: borderStrong, "stroke-width": "1"
    }));

    /* Ticks at 0/25/50/75/100 */
    var tickColor = cssVar("--muted", "#75798c");
    var text3 = cssVar("--text-3", "#9397ab");
    var TICKS = [
      {val: 0,   label: "0",                specialLabel: null},
      {val: 25,  label: "25",               specialLabel: null},
      {val: 50,  label: "50",               specialLabel: null},
      {val: 75,  label: "75",               specialLabel: "75 · approve line"},
      {val: 100, label: "100",              specialLabel: null},
    ];
    TICKS.forEach(function (tick) {
      var xPos = PAD_L + (tick.val / 100) * (W - PAD_L);
      var lbl = tick.specialLabel || tick.label;
      var t = svgEl("text", {
        x: xPos,
        y: H - 2,
        "text-anchor": tick.val === 0 ? "start" : tick.val === 100 ? "end" : "middle",
        "font-family": "JetBrains Mono, ui-monospace, Menlo, monospace",
        "font-size": "9.5",
        fill: tick.specialLabel ? text3 : tickColor,
      });
      t.textContent = lbl;
      svg.appendChild(t);
    });

    /* Bars + hover */
    BUCKETS.forEach(function (bucket, idx) {
      var x = PAD_L + idx * (barW + gap);
      var barH = bucket.count > 0
        ? Math.max(2, Math.round((bucket.count / maxCount) * BAR_AREA_H))
        : 1;
      var y = BAR_AREA_H - barH;
      var color = window.scoreColor ? window.scoreColor(bucket.mid) : "#c4635f";
      var opacity = bucket.count === 0 ? 0.25 : 0.85;

      var rect = svgEl("rect", {
        x: x, y: y,
        width: barW, height: barH,
        fill: color,
        opacity: opacity,
        rx: 2, ry: 2,
        style: "cursor:default;transition:opacity 120ms;",
      });

      /* Hover behaviour */
      var popoverId = "hist-pop-" + idx;
      rect.addEventListener("mouseenter", function () {
        rect.setAttribute("opacity", "1");
        /* Remove any existing popover */
        var old = svg.getElementById(popoverId);
        if (old) old.parentNode.removeChild(old);
        /* Build foreignObject popover */
        var popW = 120, popH = 34;
        var px = Math.min(x, W - popW - 4);
        var py = Math.max(0, y - popH - 6);
        var fo = svgEl("foreignObject", {
          id: popoverId,
          x: px, y: py,
          width: popW, height: popH,
          style: "pointer-events:none;"
        });
        var body = document.createElement("div");
        body.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        body.style.cssText = "background:var(--surface,#232532);border-radius:4px;padding:5px 8px;font-family:Inter,system-ui,sans-serif;font-size:11px;color:var(--text,#e9e9ed);white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.45);";
        var cnt = escapeHtml(String(bucket.count));
        var range = escapeHtml(bucket.lo + "–" + bucket.hi);
        body.innerHTML = cnt + " listings, " + range;
        fo.appendChild(body);
        svg.appendChild(fo);
      });

      rect.addEventListener("mouseleave", function () {
        rect.setAttribute("opacity", String(opacity));
        var pop = svg.getElementById(popoverId);
        if (pop) pop.parentNode.removeChild(pop);
      });

      svg.appendChild(rect);
    });

    barsEl.appendChild(svg);
  };

  /* ================================================================
     renderScatter — SPEC §3.2
     X = score 30→100, Y = price (inverted: cheap at top).
     r=4.5 fill=scoreColor. Shortlisted: r=5.5 + 4px halo (second circle).
     Dashed budget line at budget ceiling.
     Two-edge frame (right + bottom only) via <line> elements.
     Hover card: .card-styled div, clamped to container.
     ================================================================ */
  window.renderScatter = function (entries, container) {
    var areaEl = container || document.getElementById("scatter-area");
    if (!areaEl) return;
    clearEl(areaEl);

    var ttEl = document.getElementById("scatter-tooltip");
    var ttTitle = document.getElementById("scatter-tt-title");
    var ttMeta = document.getElementById("scatter-tt-meta");

    var points = (entries || []).filter(function (e) {
      return typeof e.score === "number" && typeof e.price_eur === "number" && e.price_eur > 0;
    });

    if (points.length === 0) return;

    var W = areaEl.clientWidth || 280;
    var H = 96;

    var scoreMin = 30, scoreMax = 100;
    var prices = points.map(function (p) { return p.price_eur; });
    var priceMin = Math.min.apply(null, prices);
    var priceMax = Math.max.apply(null, prices);
    if (priceMin === priceMax) { priceMin = priceMin * 0.8; priceMax = priceMax * 1.2; }
    var priceRange = priceMax - priceMin || 1;

    var budgetPrice = 265000;
    if (window.state && window.state.filters && window.state.filters.max_price) {
      budgetPrice = window.state.filters.max_price;
    }

    var borderStrong = cssVar("--border-strong", "#3f424d");
    var accentLt = cssVar("--accent-lt", "#b5abfc");
    var mutedColor = cssVar("--muted", "#75798c");

    var svg = svgEl("svg", {
      width: W,
      height: H,
      viewBox: "0 0 " + W + " " + H,
      style: "display:block;overflow:visible;",
    });

    /* Two-edge frame: right + bottom only (SPEC §3.2) */
    svg.appendChild(svgEl("line", {
      x1: W, y1: 0, x2: W, y2: H,
      stroke: borderStrong, "stroke-width": "1"
    }));
    svg.appendChild(svgEl("line", {
      x1: 0, y1: H, x2: W, y2: H,
      stroke: borderStrong, "stroke-width": "1"
    }));

    /* Budget dashed line */
    var budgetPct = 1 - (budgetPrice - priceMin) / priceRange;
    budgetPct = Math.max(0.02, Math.min(0.98, budgetPct));
    var budgetY = Math.round(budgetPct * H);

    svg.appendChild(svgEl("line", {
      x1: 0, y1: budgetY, x2: W, y2: budgetY,
      stroke: borderStrong,
      "stroke-width": "1",
      "stroke-dasharray": "4 5",
    }));

    /* Budget label */
    var budgetLabel = svgEl("text", {
      x: W - 2,
      y: Math.max(budgetY - 4, 10),
      "text-anchor": "end",
      "font-family": "JetBrains Mono, ui-monospace, Menlo, monospace",
      "font-size": "9.5",
      fill: mutedColor,
    });
    budgetLabel.textContent = "budget " + Math.round(budgetPrice / 1000) + "k";
    svg.appendChild(budgetLabel);

    /* Determine shortlisted IDs (from state.properties with qualifying status) */
    var shortlistedStatuses = new Set(["approved", "viewing_scheduled", "viewed", "thinking", "offer_drafted"]);
    var shortlistedIds = new Set();
    (window.state && window.state.properties || []).forEach(function (e) {
      if (!e.status || shortlistedStatuses.has(e.status)) shortlistedIds.add(e.id);
    });

    /* Hover card element — one shared, repositioned on hover */
    var hoverCard = null;
    function _removeHoverCard() {
      if (hoverCard && hoverCard.parentNode) hoverCard.parentNode.removeChild(hoverCard);
      hoverCard = null;
    }

    /* Draw dots */
    points.forEach(function (p) {
      var xPct = (Math.max(scoreMin, Math.min(scoreMax, p.score)) - scoreMin) / (scoreMax - scoreMin);
      var yPct = 1 - (p.price_eur - priceMin) / priceRange;
      xPct = Math.max(0.02, Math.min(0.98, xPct));
      yPct = Math.max(0.02, Math.min(0.98, yPct));
      var cx = Math.round(xPct * W);
      var cy = Math.round(yPct * H);
      var color = window.scoreColor ? window.scoreColor(p.score) : "#7fbf7a";
      var isShortlisted = shortlistedIds.has(p.id);
      var r = isShortlisted ? 5.5 : 4.5;

      /* Halo circle for shortlisted */
      if (isShortlisted) {
        svg.appendChild(svgEl("circle", {
          cx: cx, cy: cy,
          r: r + 4,
          fill: color,
          opacity: "0.16",
        }));
      }

      var dot = svgEl("circle", {
        cx: cx, cy: cy, r: r,
        fill: color,
        style: "cursor:pointer;",
      });

      dot.addEventListener("mouseenter", function () {
        _removeHoverCard();
        hoverCard = document.createElement("div");
        hoverCard.style.cssText = [
          "position:absolute",
          "z-index:100",
          "background:var(--surface,#232532)",
          "border-radius:var(--r-md,6px)",
          "box-shadow:var(--sh-md,0 4px 12px rgba(0,0,0,.45))",
          "padding:7px 10px",
          "white-space:nowrap",
          "pointer-events:none",
          "font-family:Inter,system-ui,sans-serif",
          "font-size:11px",
        ].join(";");

        var titleDiv = document.createElement("div");
        titleDiv.style.cssText = "font-weight:500;color:var(--text,#e9e9ed);margin-bottom:2px;";
        titleDiv.textContent = escapeHtml(p.title || p.id || "");
        hoverCard.appendChild(titleDiv);

        var metaDiv = document.createElement("div");
        metaDiv.style.cssText = "font-family:JetBrains Mono,ui-monospace,Menlo,monospace;font-size:10px;color:var(--text-3,#9397ab);";
        var metaParts = [
          window.fmtEur ? window.fmtEur(p.price_eur) : (p.price_eur + " €"),
        ];
        if (p.price_per_sqm) metaParts.push(p.price_per_sqm + " €/m\xB2");
        metaParts.push(escapeHtml(String(p.score)) + "/100");
        metaDiv.textContent = metaParts.join(" \xB7 ");
        hoverCard.appendChild(metaDiv);

        areaEl.style.position = "relative";
        areaEl.appendChild(hoverCard);

        /* Clamp position to container */
        var cW = areaEl.offsetWidth || W;
        var cH = areaEl.offsetHeight || H;
        var cardW = hoverCard.offsetWidth || 140;
        var cardH = hoverCard.offsetHeight || 46;
        var leftX = cx - cardW / 2;
        var topY = cy - cardH - 8;
        leftX = Math.max(4, Math.min(leftX, cW - cardW - 4));
        topY = topY < 0 ? cy + 8 : topY;
        hoverCard.style.left = leftX + "px";
        hoverCard.style.top = topY + "px";

        /* Also update legacy tooltip elements if present */
        if (ttEl && ttTitle && ttMeta) {
          ttTitle.textContent = p.title || p.id || "";
          var mp = [window.fmtEur ? window.fmtEur(p.price_eur) : (p.price_eur + " €")];
          if (p.price_per_sqm) mp.push(p.price_per_sqm + " €/m\xB2");
          mp.push(p.score + "/100");
          ttMeta.textContent = mp.join(" \xB7 ");
          ttEl.classList.add("visible");
        }
      });

      dot.addEventListener("mouseleave", function () {
        _removeHoverCard();
        if (ttEl) ttEl.classList.remove("visible");
      });

      /* Click: navigate to shortlist detail */
      dot.addEventListener("click", function () {
        if (window.openDetailPanel) {
          var detailBtn = document.querySelector('.tab-nav button[data-tab="shortlist"]');
          if (detailBtn) detailBtn.click();
          window.openDetailPanel(p.id);
        }
      });

      svg.appendChild(dot);
    });

    areaEl.appendChild(svg);
  };

})();
