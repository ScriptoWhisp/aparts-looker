/*
 * detail-panel.js — detail panel renderer: commute badge, mini-map, price sparkline,
 *                   AI checklist badges, listing fields, pending action buttons.
 *
 * Exposes: window.openDetailPanel(listingId), window.closeDetailPanel()
 * Calls: window.updateCompareSelection (comparison.js), window.loadData (index.html)
 * Reads: window.state, window.commuteTier, window.escapeHtml, window.fmtEur, window.scoreColor
 *
 * All listing-supplied strings use .textContent — never innerHTML with user data (T-05-32).
 * Miniature Leaflet map: ALWAYS call miniMap.remove() before re-init (Pitfall 1).
 * URL validation: only render <a> links if url starts with http:// or https:// (T-05-33).
 * No ORS or Nominatim calls from browser — consumes pre-computed backend data only.
 */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  /* Module-level mini-map tracker — needed for lifecycle management (Pitfall 1) */
  var miniMap = null;

  /* ================================================================
     window.openDetailPanel(listingId)
     ================================================================ */
  window.openDetailPanel = function (listingId) {
    /* 1. Locate the entry */
    var properties = window.state.properties;
    var pending = window.state.pending;
    var entry = null;
    for (var i = 0; i < properties.length; i++) {
      if (properties[i].id === listingId) { entry = properties[i]; break; }
    }
    if (!entry) {
      for (var j = 0; j < pending.length; j++) {
        if (pending[j].id === listingId) { entry = pending[j]; break; }
      }
    }
    if (!entry) return;

    /* 2. Is this a pending listing? */
    var isPending = properties.indexOf(entry) === -1;

    /* 3. Get panel */
    var panel = document.getElementById("detail-panel");
    if (!panel) return;

    /* 4. Destroy any existing mini-map (Pitfall 1) */
    if (miniMap !== null) {
      miniMap.remove();
      miniMap = null;
    }

    /* 5. Clear panel */
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    panel.classList.remove("empty");

    /* ---- Section 1: Header (score badge + title + compare checkbox) ---- */
    var headerRow = document.createElement("div");
    headerRow.className = "detail-header";

    var scoreBadge = document.createElement("span");
    scoreBadge.className = "score-badge";
    scoreBadge.style.background = window.scoreColor(entry.score || 0);
    scoreBadge.textContent = (entry.score != null ? entry.score : "?") + "/100";
    headerRow.appendChild(scoreBadge);

    var titleEl = document.createElement("h3");
    titleEl.className = "detail-title";
    titleEl.textContent = entry.title || entry.name || entry.id || "";
    headerRow.appendChild(titleEl);

    /* Compare checkbox */
    var cbWrap = document.createElement("label");
    cbWrap.className = "compare-cb-wrap";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "compare-cb";
    cb.dataset.id = entry.id;
    cb.checked = window.state.compareSelected.has(entry.id);
    cb.addEventListener("change", function () {
      if (window.updateCompareSelection) window.updateCompareSelection(entry.id, cb.checked);
    });
    var cbLabel = document.createTextNode("Compare");
    cbWrap.appendChild(cb);
    cbWrap.appendChild(cbLabel);
    headerRow.appendChild(cbWrap);

    panel.appendChild(headerRow);

    /* ---- Section 2: Commute badge ---- */
    var tier = window.commuteTier(entry.commute_minutes);
    var commuteBadge = document.createElement("span");
    commuteBadge.className = "commute-badge";
    if (tier) {
      commuteBadge.classList.add("commute-" + tier);
      commuteBadge.textContent = "⏱ " + entry.commute_minutes + " min drive";
    } else {
      commuteBadge.classList.add("commute-none");
      commuteBadge.textContent = "⏱ — min drive";
    }
    panel.appendChild(commuteBadge);

    /* ---- Section 3: Mini-map ---- */
    var miniDiv = document.createElement("div");
    miniDiv.id = "mini-map-" + Date.now();
    miniDiv.style.height = "200px";
    miniDiv.style.marginTop = "12px";
    miniDiv.style.borderRadius = "6px";
    miniDiv.style.overflow = "hidden";

    if (entry.lat != null && entry.lng != null) {
      panel.appendChild(miniDiv); // append to DOM FIRST so Leaflet has a rendered node

      // Leaflet [lat, lng] order
      miniMap = L.map(miniDiv, {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false
      }).setView([entry.lat, entry.lng], 14); // Leaflet [lat, lng] order

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19
      }).addTo(miniMap);

      // Listing pin
      L.circleMarker([entry.lat, entry.lng], { // Leaflet [lat, lng] order
        radius: 8,
        fillColor: window.scoreColor(entry.score || 0),
        color: "#ffffff",
        weight: 2,
        fillOpacity: 0.9
      }).addTo(miniMap);

      // Isochrone overlay (cached from main map load)
      if (window.state.isochroneGeoJson && window.state.isochroneGeoJson.features && window.state.isochroneGeoJson.features.length) {
        L.geoJSON(window.state.isochroneGeoJson, {
          style: {fillColor: "#3b82f6", fillOpacity: 0.12, color: "#3b82f6", weight: 1}
        }).addTo(miniMap);
      }
    } else {
      miniDiv.style.display = "flex";
      miniDiv.style.alignItems = "center";
      miniDiv.style.justifyContent = "center";
      miniDiv.style.background = "var(--surface-2)";
      miniDiv.style.color = "var(--text-muted)";
      miniDiv.style.fontSize = "13px";
      var noCoords = document.createTextNode("No coordinates for this listing");
      miniDiv.appendChild(noCoords);
      panel.appendChild(miniDiv);
    }

    /* ---- Section 4: Price sparkline ---- */
    var history = window.state.priceHistory[entry.id];
    if (!history || history.length < 2) {
      var noHistEl = document.createElement("div");
      noHistEl.style.fontSize = "12px";
      noHistEl.style.color = "var(--text-muted)";
      noHistEl.style.marginTop = "8px";
      noHistEl.style.fontFamily = "var(--font-mono)";
      noHistEl.textContent = "No history";
      panel.appendChild(noHistEl);
    } else {
      var prices = history.map(function (h) { return h.price; });
      var minP = Math.min.apply(null, prices);
      var maxP = Math.max.apply(null, prices);
      var priceRange = maxP - minP || 1;

      var sparkSvg = document.createElementNS(SVG_NS, "svg");
      sparkSvg.setAttribute("viewBox", "0 0 100 40");
      sparkSvg.setAttribute("width", "100");
      sparkSvg.setAttribute("height", "40");
      sparkSvg.style.marginTop = "8px";
      sparkSvg.style.display = "block";

      var ptStrs = prices.map(function (price, idx) {
        var x = (idx / (prices.length - 1)) * 100;
        var y = 40 - ((price - minP) / priceRange) * 40;
        return x.toFixed(1) + "," + y.toFixed(1);
      });

      var polyline = document.createElementNS(SVG_NS, "polyline");
      polyline.setAttribute("points", ptStrs.join(" "));
      polyline.setAttribute("stroke", "#3b82f6");
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke-width", "2");
      sparkSvg.appendChild(polyline);
      panel.appendChild(sparkSvg);
    }

    /* ---- Section 5: AI checklist badges ---- */
    var cl = window.state.checklists[entry.id];
    var aiChecklist = cl ? cl.ai_checklist : null;
    if (aiChecklist && Object.keys(aiChecklist).length) {
      var strip = document.createElement("div");
      strip.className = "checklist-strip";
      strip.style.marginTop = "8px";

      Object.keys(aiChecklist).forEach(function (key) {
        var item = aiChecklist[key];
        var result = (item && typeof item === "object") ? item.result : item;
        var dot = result === "pass" ? "✓" : result === "fail" ? "✗" : "?";
        var badgeClass = result === "pass" ? "badge-pass" : result === "fail" ? "badge-fail" : "badge-unknown";

        var badge = document.createElement("span");
        badge.className = "checklist-badge " + badgeClass;
        badge.textContent = dot + " " + key; // textContent only (T-05-32)
        strip.appendChild(badge);
      });

      panel.appendChild(strip);
    }

    /* ---- Section 6: Listing fields ---- */
    var fieldsDiv = document.createElement("div");
    fieldsDiv.className = "detail-fields";

    function addField(label, value) {
      if (value == null || value === "" || value === "null") return;
      var row = document.createElement("div");
      row.className = "detail-field-row";

      var labelEl = document.createElement("span");
      labelEl.className = "detail-field-label";
      labelEl.textContent = label;

      var valueEl = document.createElement("span");
      valueEl.className = "detail-field-value";
      valueEl.textContent = String(value); // textContent only — never innerHTML (T-05-32)

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      fieldsDiv.appendChild(row);
    }

    addField("Verdict", entry.verdict);
    addField("Price", entry.price_eur ? window.fmtEur(entry.price_eur) : (entry.price ? window.fmtEur(entry.price) : null));
    addField("Price/m²", entry.price_per_sqm ? (window.fmtEur(entry.price_per_sqm) + " / m²") : null);
    addField("Area", entry.area_sqm ? (entry.area_sqm + " m²") : null);
    addField("Rooms", entry.rooms);
    addField("Address", entry.title || entry.name);
    addField("District", entry.district);
    if (entry.floor != null && entry.floor_total != null) {
      addField("Floor", entry.floor + "/" + entry.floor_total);
    } else if (entry.floor != null) {
      addField("Floor", entry.floor);
    }
    addField("Year built", entry.year_built);
    addField("Parking", entry.parking);
    addField("Material", entry.material);

    panel.appendChild(fieldsDiv);

    /* External link — only render if URL is safe (T-05-33) */
    var url = entry.url || "";
    if (url.startsWith("http://") || url.startsWith("https://")) {
      var linkRow = document.createElement("div");
      linkRow.style.marginTop = "8px";
      var linkEl = document.createElement("a");
      linkEl.href = url;
      linkEl.target = "_blank";
      linkEl.rel = "noopener noreferrer";
      linkEl.textContent = "View on kv.ee";
      linkEl.style.fontSize = "13px";
      linkRow.appendChild(linkEl);
      panel.appendChild(linkRow);
    }

    /* ---- Section 7: Action buttons (pending only) ---- */
    if (isPending) {
      var actionsDiv = document.createElement("div");
      actionsDiv.className = "detail-actions";

      /* Approve button */
      var approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "action-btn action-btn-primary";
      approveBtn.textContent = "Approve";
      approveBtn.addEventListener("click", function () {
        approveBtn.disabled = true;
        fetch("/api/pending/" + encodeURIComponent(entry.id) + "/approve", {method: "POST"})
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.ok) {
              window.loadData();
              window.closeDetailPanel();
            } else {
              approveBtn.disabled = false;
            }
          })
          .catch(function () {
            console.error("Approve failed");
            approveBtn.disabled = false;
          });
      });
      actionsDiv.appendChild(approveBtn);

      /* Reject button */
      var rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "action-btn action-btn-secondary";
      rejectBtn.textContent = "Reject";
      rejectBtn.addEventListener("click", function () {
        var reason = window.prompt("Reason for rejection:", "other");
        if (reason === null) return; // user cancelled
        rejectBtn.disabled = true;
        fetch("/api/pending/" + encodeURIComponent(entry.id) + "/reject", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({reason: reason || "other"})
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.ok) {
              window.loadData();
              window.closeDetailPanel();
            } else {
              rejectBtn.disabled = false;
            }
          })
          .catch(function () {
            console.error("Reject failed");
            rejectBtn.disabled = false;
          });
      });
      actionsDiv.appendChild(rejectBtn);

      /* Draft Email button */
      var draftBtn = document.createElement("button");
      draftBtn.type = "button";
      draftBtn.className = "action-btn action-btn-secondary";
      draftBtn.textContent = "Draft Email";
      var draftStatus = document.createElement("div");
      draftStatus.className = "action-status";
      draftBtn.addEventListener("click", function () {
        draftBtn.disabled = true;
        fetch("/api/draft/" + encodeURIComponent(entry.id), {method: "POST"})
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.ok) {
              draftStatus.textContent = "Draft created — check Gmail Drafts";
            } else if (d.reason === "no_email") {
              draftStatus.textContent = "No agent email available";
              draftBtn.disabled = false;
            } else {
              draftStatus.textContent = "Draft failed — retry";
              draftBtn.disabled = false;
            }
          })
          .catch(function () {
            draftStatus.textContent = "Draft failed — retry";
            draftBtn.disabled = false;
          });
      });
      actionsDiv.appendChild(draftBtn);

      panel.appendChild(actionsDiv);
      panel.appendChild(draftStatus);
    }
  };

  /* ================================================================
     window.closeDetailPanel
     ================================================================ */
  window.closeDetailPanel = function () {
    /* Destroy mini-map if present (Pitfall 1) */
    if (miniMap !== null) {
      miniMap.remove();
      miniMap = null;
    }
    var panel = document.getElementById("detail-panel");
    if (!panel) return;
    while (panel.firstChild) panel.removeChild(panel.firstChild);
    panel.classList.add("empty");
    panel.textContent = "Select a listing on the map";
  };

})();
