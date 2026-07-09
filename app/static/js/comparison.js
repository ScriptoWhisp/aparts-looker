/*
 * comparison.js — checkbox tracking, floating compare button, full-screen comparison table.
 *
 * Exposes: window.updateCompareSelection(id, checked)
 *          window.openCompareOverlay()
 *          window.closeCompareOverlay()
 *
 * Reads: window.state.compareSelected (Set), window.state.properties, window.state.pending,
 *        window.state.checklists, window.fmtEur
 *
 * All cell content via .textContent — never innerHTML with listing data (T-05-34).
 * Max 4 listings for comparison.
 */
(function () {
  "use strict";

  /* ================================================================
     Private: updateFloatingButton — show/hide the floating compare button
     ================================================================ */
  function updateFloatingButton() {
    var el = document.getElementById("compare-floating");
    if (!el) return;
    if (window.state.compareSelected.size < 2) {
      el.style.display = "none";
    } else {
      el.style.display = "block";
      el.textContent = "Compare " + window.state.compareSelected.size + " selected";
    }
  }

  /* ================================================================
     window.updateCompareSelection(id, checked)
     ================================================================ */
  window.updateCompareSelection = function (id, checked) {
    if (checked) {
      if (window.state.compareSelected.size >= 4) {
        alert("Maximum 4 listings for comparison");
        /* Force the checkbox back to unchecked */
        var checkboxes = document.querySelectorAll(".compare-cb[data-id='" + id + "']");
        checkboxes.forEach(function (cb) { cb.checked = false; });
        return;
      }
      window.state.compareSelected.add(id);
    } else {
      window.state.compareSelected.delete(id);
    }
    updateFloatingButton();
  };

  /* ================================================================
     window.openCompareOverlay — build and show the comparison table
     ================================================================ */
  window.openCompareOverlay = function () {
    var overlay = document.getElementById("compare-overlay");
    var content = document.getElementById("compare-content");
    if (!overlay || !content) return;

    /* Clear previous content */
    while (content.firstChild) content.removeChild(content.firstChild);

    /* Resolve selected listings */
    var ids = Array.from(window.state.compareSelected);
    var listings = ids.map(function (id) {
      var found = null;
      for (var i = 0; i < window.state.properties.length; i++) {
        if (window.state.properties[i].id === id) { found = window.state.properties[i]; break; }
      }
      if (!found) {
        for (var j = 0; j < window.state.pending.length; j++) {
          if (window.state.pending[j].id === id) { found = window.state.pending[j]; break; }
        }
      }
      return found;
    }).filter(Boolean);

    if (listings.length < 2) {
      var msg = document.createElement("p");
      msg.style.color = "var(--text-muted)";
      msg.style.marginTop = "60px";
      msg.textContent = "Select at least 2 listings to compare.";
      content.appendChild(msg);
      overlay.style.display = "block";
      return;
    }

    /* Build comparison table */
    var table = document.createElement("table");
    table.className = "compare-table";

    /* Header row */
    var thead = document.createElement("thead");
    var headerRow = document.createElement("tr");
    var emptyTh = document.createElement("th");
    emptyTh.textContent = "Field";
    headerRow.appendChild(emptyTh);
    listings.forEach(function (listing) {
      var th = document.createElement("th");
      th.textContent = listing.title || listing.name || listing.id || ""; // textContent only (T-05-34)
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    /* Body rows */
    var tbody = document.createElement("tbody");

    /* Helper: build a row with label + one cell per listing */
    function addRow(label, valuesFn, bestFn) {
      var values = listings.map(valuesFn);
      /* Skip row if all values are null/undefined */
      var hasAny = values.some(function (v) { return v != null && v !== ""; });
      if (!hasAny) return;

      var tr = document.createElement("tr");
      var th = document.createElement("th");
      th.textContent = label;
      tr.appendChild(th);

      /* Determine winner(s) */
      var winners = new Set();
      if (bestFn) {
        var bestVal = null;
        values.forEach(function (v) {
          if (v != null) {
            var cmpResult = bestFn(v, bestVal);
            if (bestVal === null || cmpResult > 0) {
              bestVal = v;
              winners = new Set();
              winners.add(v);
            } else if (cmpResult === 0) {
              winners.add(v);
            }
          }
        });
      }

      values.forEach(function (v) {
        var td = document.createElement("td");
        td.textContent = v != null ? String(v) : "—"; // textContent only (T-05-34)
        if (winners.has(v)) td.className = "compare-winner";
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }

    /* Score: higher is better */
    addRow("Score", function (l) { return l.score != null ? l.score + "/100" : null; }, function (a, b) {
      var an = parseInt(a, 10);
      var bn = b != null ? parseInt(b, 10) : null;
      return bn === null ? 1 : an > bn ? 1 : an === bn ? 0 : -1;
    });

    /* Price: lower is better */
    addRow("Price", function (l) {
      var p = l.price_eur || l.price;
      return p ? window.fmtEur(p) : null;
    }, function (a, b) {
      var an = parseFloat(a.replace(/[^\d.]/g, ""));
      var bn = b != null ? parseFloat(b.replace(/[^\d.]/g, "")) : null;
      return bn === null ? 1 : an < bn ? 1 : an === bn ? 0 : -1; // lower price wins
    });

    /* Price/m²: lower is better */
    addRow("Price/m²", function (l) {
      return l.price_per_sqm ? window.fmtEur(l.price_per_sqm) + " / m²" : null;
    }, function (a, b) {
      var an = parseFloat(a.replace(/[^\d.]/g, ""));
      var bn = b != null ? parseFloat(b.replace(/[^\d.]/g, "")) : null;
      return bn === null ? 1 : an < bn ? 1 : an === bn ? 0 : -1;
    });

    /* Area: higher is better */
    addRow("Area", function (l) { return l.area_sqm ? l.area_sqm + " m²" : null; }, function (a, b) {
      var an = parseFloat(a);
      var bn = b != null ? parseFloat(b) : null;
      return bn === null ? 1 : an > bn ? 1 : an === bn ? 0 : -1;
    });

    /* Rooms: higher is better */
    addRow("Rooms", function (l) { return l.rooms != null ? String(l.rooms) : null; }, function (a, b) {
      var an = parseInt(a, 10);
      var bn = b != null ? parseInt(b, 10) : null;
      return bn === null ? 1 : an > bn ? 1 : an === bn ? 0 : -1;
    });

    /* Commute: lower is better */
    addRow("Commute", function (l) {
      return l.commute_minutes != null ? l.commute_minutes + " min" : null;
    }, function (a, b) {
      var an = parseInt(a, 10);
      var bn = b != null ? parseInt(b, 10) : null;
      return bn === null ? 1 : an < bn ? 1 : an === bn ? 0 : -1;
    });

    /* District: no natural order */
    addRow("District", function (l) { return l.district || null; }, null);

    /* Year built: higher is better (newer) */
    addRow("Year built", function (l) { return l.year_built != null ? String(l.year_built) : null; }, function (a, b) {
      var an = parseInt(a, 10);
      var bn = b != null ? parseInt(b, 10) : null;
      return bn === null ? 1 : an > bn ? 1 : an === bn ? 0 : -1;
    });

    /* Material: no natural order */
    addRow("Material", function (l) { return l.material || null; }, null);

    /* Parking: no natural order */
    addRow("Parking", function (l) { return l.parking || null; }, null);

    /* Floor: no natural order */
    addRow("Floor", function (l) { return l.floor != null ? String(l.floor) : null; }, null);

    /* AI checklist rows: collect union of all keys */
    var allAiKeys = new Set();
    listings.forEach(function (l) {
      var cl = window.state.checklists[l.id];
      if (cl && cl.ai_checklist) {
        Object.keys(cl.ai_checklist).forEach(function (k) { allAiKeys.add(k); });
      }
    });
    allAiKeys.forEach(function (key) {
      /* pass > unknown > fail */
      addRow(key, function (l) {
        var cl = window.state.checklists[l.id];
        if (!cl || !cl.ai_checklist) return null;
        var item = cl.ai_checklist[key];
        if (!item) return null;
        return (item && typeof item === "object") ? (item.result || "unknown") : item;
      }, function (a, b) {
        var rank = {pass: 2, unknown: 1, fail: 0};
        var ar = rank[a] != null ? rank[a] : 1;
        var br = b != null ? (rank[b] != null ? rank[b] : 1) : -1;
        return ar > br ? 1 : ar === br ? 0 : -1;
      });
    });

    table.appendChild(tbody);
    content.appendChild(table);
    overlay.style.display = "block";
  };

  /* ================================================================
     window.closeCompareOverlay
     ================================================================ */
  window.closeCompareOverlay = function () {
    var overlay = document.getElementById("compare-overlay");
    var content = document.getElementById("compare-content");
    if (overlay) overlay.style.display = "none";
    if (content) while (content.firstChild) content.removeChild(content.firstChild);
  };

  /* ================================================================
     Initialization — wire buttons on DOMContentLoaded
     ================================================================ */
  document.addEventListener("DOMContentLoaded", function () {
    /* Wire floating button */
    var floatingBtn = document.getElementById("compare-floating");
    if (floatingBtn) {
      floatingBtn.addEventListener("click", function () {
        var overlay = document.getElementById("compare-overlay");
        if (overlay && overlay.style.display === "block") return; // already open
        window.openCompareOverlay();
      });
    }

    /* Wire close button inside overlay */
    var closeBtn = document.querySelector(".compare-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        window.closeCompareOverlay();
      });
    }

    /* Escape key closes overlay when visible */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var overlay = document.getElementById("compare-overlay");
        if (overlay && overlay.style.display === "block") {
          window.closeCompareOverlay();
        }
      }
    });

    /* Initial floating button state */
    updateFloatingButton();
  });

})();
