/*
 * ui.js — KPI strip, score distribution SVG chart, price vs score scatter SVG, activity feed.
 *
 * Exposes: window.renderKpiStrip, window.renderScoreDistribution,
 *          window.renderPriceScatter, window.renderActivityFeed
 * Reads: window.state, window.fmtEur, window.scoreColor, window.openDetailPanel
 *
 * All DOM writes use .textContent or createElementNS for SVG — never innerHTML with listing data.
 */
(function () {
  "use strict";

  /* SVG namespace constant */
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
    target.appendChild(makeCard(
      "Best",
      best ? (best.title || best.name || best.id || "—") : "—",
      best ? function () {
        if (window.openDetailPanel) window.openDetailPanel(best.id);
      } : null
    ));
  };

  /* ================================================================
     window.renderScoreDistribution — 3-bar vertical SVG chart
     ================================================================ */
  window.renderScoreDistribution = function () {
    var target = document.getElementById("score-dist-svg");
    if (!target) return;
    clearChildren(target);

    var all = window.state.properties.concat(window.state.pending);
    var hi = all.filter(function (e) { return typeof e.score === "number" && e.score >= 75; }).length;
    var mid = all.filter(function (e) { return typeof e.score === "number" && e.score >= 50 && e.score < 75; }).length;
    var lo = all.filter(function (e) { return typeof e.score === "number" && e.score < 50; }).length;
    var maxN = Math.max(hi, mid, lo, 1); // avoid divide-by-zero

    var CHART_W = 200;
    var CHART_H = 100;
    var BAR_BOTTOM = 80; // baseline y for bars
    var BAR_WIDTH = 40;
    var POSITIONS = [20, 80, 140]; // x offsets for bar left edges
    var COLORS = ["#10b981", "#f59e0b", "#ef4444"]; // green, amber, red
    var COUNTS = [hi, mid, lo];
    var LABELS = ["≥75", "50-74", "<50"];

    var svg = svgEl("svg", {
      viewBox: "0 0 " + CHART_W + " " + CHART_H,
      width: "100%",
      height: "100"
    });

    COUNTS.forEach(function (count, i) {
      var barH = (count / maxN) * BAR_BOTTOM;
      var barY = BAR_BOTTOM - barH;

      // Bar rect
      var rect = svgEl("rect", {
        x: POSITIONS[i],
        y: barY,
        width: BAR_WIDTH,
        height: barH,
        fill: COLORS[i],
        rx: "3"
      });
      svg.appendChild(rect);

      // Count label above bar
      var countText = document.createElementNS(SVG_NS, "text");
      countText.setAttribute("x", POSITIONS[i] + BAR_WIDTH / 2);
      countText.setAttribute("y", Math.max(barY - 3, 10));
      countText.setAttribute("text-anchor", "middle");
      countText.setAttribute("fill", "#94a3b8");
      countText.setAttribute("font-size", "11");
      countText.setAttribute("font-family", "IBM Plex Mono, monospace");
      countText.textContent = String(count);
      svg.appendChild(countText);

      // Tier label below bar
      var labelText = document.createElementNS(SVG_NS, "text");
      labelText.setAttribute("x", POSITIONS[i] + BAR_WIDTH / 2);
      labelText.setAttribute("y", String(CHART_H - 2));
      labelText.setAttribute("text-anchor", "middle");
      labelText.setAttribute("fill", "#94a3b8");
      labelText.setAttribute("font-size", "10");
      labelText.setAttribute("font-family", "IBM Plex Mono, monospace");
      labelText.textContent = LABELS[i];
      svg.appendChild(labelText);
    });

    target.appendChild(svg);
  };

  /* ================================================================
     window.renderPriceScatter — price vs score SVG scatter plot
     ================================================================ */
  window.renderPriceScatter = function () {
    var target = document.getElementById("scatter-svg");
    if (!target) return;
    clearChildren(target);

    var all = window.state.properties.concat(window.state.pending);
    var points = all.filter(function (e) {
      return typeof e.price_eur === "number" && e.price_eur > 0 && typeof e.score === "number";
    });

    var CANVAS_W = 300;
    var CANVAS_H = 200;
    var MARGIN = 10;

    var svg = svgEl("svg", {
      viewBox: "0 0 " + CANVAS_W + " " + CANVAS_H,
      width: "100%",
      height: "200"
    });

    if (points.length === 0) {
      var noData = document.createElementNS(SVG_NS, "text");
      noData.setAttribute("x", String(CANVAS_W / 2));
      noData.setAttribute("y", String(CANVAS_H / 2));
      noData.setAttribute("text-anchor", "middle");
      noData.setAttribute("fill", "#94a3b8");
      noData.setAttribute("font-size", "12");
      noData.setAttribute("font-family", "Space Grotesk, sans-serif");
      noData.textContent = "No data yet";
      svg.appendChild(noData);
      target.appendChild(svg);
      return;
    }

    var prices = points.map(function (p) { return p.price_eur; });
    var minP = Math.min.apply(null, prices);
    var maxP = Math.max.apply(null, prices);
    var priceRange = maxP - minP || 1;

    var drawW = CANVAS_W - 2 * MARGIN;
    var drawH = CANVAS_H - 2 * MARGIN;

    points.forEach(function (p) {
      var cx = MARGIN + ((p.price_eur - minP) / priceRange) * drawW;
      var cy = MARGIN + (1 - p.score / 100) * drawH; // inverted: higher score = higher on canvas

      var circle = svgEl("circle", {
        cx: String(cx),
        cy: String(cy),
        r: "4",
        fill: window.scoreColor(p.score),
        stroke: "#ffffff",
        "stroke-width": "1",
        opacity: "0.85"
      });

      // SVG native tooltip — textContent for XSS safety (T-05-34)
      var titleEl = document.createElementNS(SVG_NS, "title");
      var titleName = (p.title || p.name || p.id || "");
      titleEl.textContent = titleName + " · " + window.fmtEur(p.price_eur) + " · " + p.score + "/100";
      circle.appendChild(titleEl);

      svg.appendChild(circle);
    });

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
