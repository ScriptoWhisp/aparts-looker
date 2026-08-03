/*
 * comparison.js — Wave 6D: multi-select in Shortlist sidebar + Compare overlay (SPEC §5).
 *
 * Multi-select: cmd-click (mac) or ctrl-click (win/linux) on sidebar rows.
 *               Max 2 selected; 3rd selection deselects the oldest.
 *               Selected rows get a 1px accent border.
 * Compare button: appears in sidebar header area when ≥1 selected, enabled at 2.
 * Keyboard: 'C' key when 2 are selected (guarded to shortlist tab only).
 *
 * Overlay (SPEC §5, mockup 3d):
 *   - 1000px wide, --app background, --r-lg, --sh-lg
 *   - Backdrop = shortlist at 22% opacity
 *   - Grid 172px 1fr 1fr: label col + one col per listing
 *   - 104px photo + title header row
 *   - Only render rows that DIFFER — same value on both = skip row
 *   - Winner tinting: better side gets color: var(--st-short) (green)
 *   - Footer: Draft offer on this one / Drop this one per column
 *   - Esc closes, backdrop click closes
 *
 * Desktop-only: at ≤768px the overlay and multi-select are disabled.
 *
 * All listing strings via .textContent — no innerHTML with user data (T-05-34).
 * escapeHtml() via window.escapeHtml for any tooltip/attribute strings.
 */
(function () {
  "use strict";

  /* ── Selection state ─────────────────────────────────────────────── */
  /* Use an array (not Set) to track insertion order for the "evict oldest" rule. */
  var _selected = []; /* at most 2 listing IDs */
  var _isDesktop = !window.matchMedia || window.matchMedia("(min-width: 769px)").matches;

  function escapeHtml(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ── Expose selection array for other modules (e.g. detail-panel) ── */
  window._compareSelected = _selected;

  /* ── Public: toggle selection for a listing id ───────────────────── */
  window.compareToggle = function (id) {
    if (!_isDesktop) return;
    var idx = _selected.indexOf(id);
    if (idx !== -1) {
      /* Already selected — deselect */
      _selected.splice(idx, 1);
    } else {
      if (_selected.length >= 2) {
        /* Evict oldest (index 0) */
        _selected.shift();
      }
      _selected.push(id);
    }
    _refreshSidebarSelectionUI();
    _refreshCompareButton();
  };

  /* ── Refresh visual selection state on sidebar rows ─────────────── */
  function _refreshSidebarSelectionUI() {
    var sidebar = document.getElementById("detail-sidebar");
    if (!sidebar) return;
    sidebar.querySelectorAll(".sidebar-item[data-id]").forEach(function (row) {
      var id = row.dataset.id;
      var isSelected = _selected.indexOf(id) !== -1;
      row.classList.toggle("compare-selected", isSelected);
    });
  }

  /* ── Inject / update Compare button in the sidebar ──────────────── */
  function _refreshCompareButton() {
    if (!_isDesktop) return;
    var sidebar = document.getElementById("detail-sidebar");
    if (!sidebar) return;

    var existing = document.getElementById("sl-compare-btn");
    if (_selected.length === 0) {
      if (existing) existing.parentNode.removeChild(existing);
      return;
    }
    if (!existing) {
      existing = document.createElement("button");
      existing.id = "sl-compare-btn";
      existing.type = "button";
      existing.style.cssText = [
        "display:block",
        "width:calc(100% - 24px)",
        "margin:8px 12px 4px",
        "padding:7px 12px",
        "border:none",
        "border-radius:var(--r-md,6px)",
        "background:var(--accent,#9184d9)",
        "color:#fff",
        "font:500 12px Inter,system-ui,sans-serif",
        "cursor:pointer",
        "text-align:center",
        "transition:opacity 120ms",
      ].join(";");
      existing.addEventListener("click", function () {
        if (_selected.length >= 2) window.openCompareOverlay();
      });
      /* Insert before the list element */
      var listEl = sidebar.querySelector(".detail-sidebar-list");
      if (listEl) {
        sidebar.insertBefore(existing, listEl);
      } else {
        sidebar.appendChild(existing);
      }
    }
    var count = _selected.length;
    existing.textContent = count >= 2 ? "Compare (" + count + ")" : "Select 1 more…";
    existing.disabled = count < 2;
    existing.style.opacity = count < 2 ? "0.55" : "1";
  }

  /* ── Hook into detail-panel sidebar row click to support cmd/ctrl-click ── */
  /* We intercept clicks on .sidebar-item elements in the shortlist tab.       */
  document.addEventListener("click", function (e) {
    if (!_isDesktop) return;
    var row = e.target.closest(".sidebar-item[data-id]");
    if (!row) return;
    /* Only active on the shortlist tab */
    var activeTab = document.querySelector(".tab-nav button.active");
    if (!activeTab || activeTab.dataset.tab !== "shortlist") return;
    /* cmd (mac) or ctrl (win/linux) enables multi-select */
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      window.compareToggle(row.dataset.id);
    }
  }, true /* capture — runs before detail-panel's click handler */);

  /* ── Keyboard: 'C' opens overlay when 2 selected (shortlist tab) ── */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "c" && e.key !== "C") return;
    var activeTab = document.querySelector(".tab-nav button.active");
    if (!activeTab || activeTab.dataset.tab !== "shortlist") return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (_selected.length >= 2) {
      e.preventDefault();
      window.openCompareOverlay();
    }
  });

  /* ── Clear selection when leaving shortlist tab ──────────────────── */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".tab-nav button[data-tab]");
    if (btn && btn.dataset.tab !== "shortlist" && _selected.length > 0) {
      _selected.length = 0;
      window._compareSelected = _selected;
      _refreshSidebarSelectionUI();
      _refreshCompareButton();
    }
  });

  /* ── Helper: resolve listing by id from state ────────────────────── */
  function _findListing(id) {
    var lists = [
      (window.state && window.state.properties) || [],
      (window.state && window.state.pending) || [],
    ];
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) {
        if (lists[i][j].id === id) return lists[i][j];
      }
    }
    return null;
  }

  /* ── Helper: count checklist flags for a listing ────────────────── */
  function _countFlags(listing) {
    var clData = (window.state && window.state.checklists && window.state.checklists[listing.id]) || {};
    var fullCl = window.FULL_CHECKLIST || [];
    var flags = 0;
    fullCl.forEach(function (sec) {
      (sec.items || []).forEach(function (it) {
        var sk = it.id.startsWith("ai__") ? it.id.slice(4) : it.id;
        var manual = (clData.manual_checklist || {})[sk];
        var aiV = (listing.checklist || {})[sk];
        if (aiV && typeof aiV === "object") aiV = aiV.result;
        var s = manual || aiV;
        if (s === "issue" || s === "fail") flags++;
      });
    });
    return flags;
  }

  /* ── Helper: get Maa-amet vs-sold delta string for a listing ─────── */
  function _vsSoldLabel(listing) {
    /* Best card shows district avg if no baseline. Return what we can. */
    var district = listing.district || "";
    if (!district) return null;
    /* Check if state has any baseline info embedded via the data endpoint */
    /* We use state.districtsData (populated by /api/data) as proxy — it contains avg asking */
    var districts = (window.state && window.state.districtsData) || [];
    var de = null;
    for (var i = 0; i < districts.length; i++) {
      if (districts[i].name === district) { de = districts[i]; break; }
    }
    if (!de || !de.avg_price_per_sqm || !listing.price_per_sqm) return null;
    var diff = listing.price_per_sqm - de.avg_price_per_sqm;
    var pct = Math.round(Math.abs(diff / de.avg_price_per_sqm) * 100);
    return (diff <= 0 ? "−" : "+") + pct + "% vs " + district;
  }

  /* ── Helper: all-in cost for a listing ──────────────────────────── */
  function _allInCost(listing) {
    if (!window.computeAllIn || !window._settingsData) return null;
    try {
      var r = window.computeAllIn(listing, window._settingsData.values || window._settingsData);
      return r.allIn || null;
    } catch (e) { return null; }
  }

  /* ================================================================
     window.openCompareOverlay — build and show the 3d overlay
     ================================================================ */
  window.openCompareOverlay = function () {
    /* Remove stale overlay if any */
    var old = document.getElementById("cp-overlay-root");
    if (old) old.parentNode.removeChild(old);

    if (_selected.length < 2) return;

    var listings = _selected.map(_findListing).filter(Boolean);
    if (listings.length < 2) return;
    var a = listings[0], b = listings[1];

    /* ── Backdrop ──────────────────────────────────────────────────── */
    var backdrop = document.createElement("div");
    backdrop.id = "cp-overlay-root";
    backdrop.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:9000",
      "background:rgba(22,24,38,.22)",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "backdrop-filter:blur(0px)",
    ].join(";");

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) window.closeCompareOverlay();
    });

    /* ── Dialog ────────────────────────────────────────────────────── */
    var dialog = document.createElement("div");
    dialog.style.cssText = [
      "background:var(--app,#161826)",
      "border-radius:var(--r-lg,8px)",
      "box-shadow:var(--sh-lg,0 10px 30px rgba(0,0,0,.5))",
      "width:min(1000px,96vw)",
      "max-height:92vh",
      "overflow-y:auto",
      "display:flex",
      "flex-direction:column",
    ].join(";");

    /* ── Header row ────────────────────────────────────────────────── */
    var header = document.createElement("div");
    header.style.cssText = "display:grid;grid-template-columns:172px 1fr 1fr;gap:0;border-bottom:1px solid var(--border,#292b31);flex-shrink:0;";

    /* Label column header */
    var labelHdr = document.createElement("div");
    labelHdr.style.cssText = "padding:16px;display:flex;align-items:center;justify-content:space-between;";
    var hdrTitle = document.createElement("span");
    hdrTitle.style.cssText = "font:600 10px Inter,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#75798c);";
    hdrTitle.textContent = "Compare";
    labelHdr.appendChild(hdrTitle);
    /* Close button */
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.style.cssText = "background:none;border:none;cursor:pointer;color:var(--muted,#75798c);font-size:18px;padding:0 4px;line-height:1;";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", window.closeCompareOverlay);
    closeBtn.setAttribute("aria-label", "Close compare overlay");
    labelHdr.appendChild(closeBtn);
    header.appendChild(labelHdr);

    /* Per-listing header cells */
    [a, b].forEach(function (listing) {
      var cell = document.createElement("div");
      cell.style.cssText = "padding:12px 16px;border-left:1px solid var(--border,#292b31);display:flex;flex-direction:column;gap:8px;";

      var imgUrl = listing.image_url || listing.imageUrl || "";
      if (imgUrl && (imgUrl.startsWith("http://") || imgUrl.startsWith("https://"))) {
        var img = document.createElement("img");
        img.src = imgUrl;
        img.alt = "";
        img.loading = "lazy";
        img.style.cssText = "width:100%;height:104px;object-fit:cover;border-radius:var(--r-sm,4px);display:block;";
        cell.appendChild(img);
      } else {
        var imgPh = document.createElement("div");
        imgPh.style.cssText = "width:100%;height:104px;background:var(--sunken,#1d1f2d);border-radius:var(--r-sm,4px);display:flex;align-items:center;justify-content:center;font:400 11px Inter,system-ui,sans-serif;color:var(--faint,#595d6c);";
        imgPh.textContent = "no photo";
        cell.appendChild(imgPh);
      }

      var titleEl = document.createElement("div");
      titleEl.style.cssText = "font:500 13px Inter,system-ui,sans-serif;color:var(--text,#e9e9ed);";
      titleEl.textContent = listing.title || listing.name || listing.id || "";
      cell.appendChild(titleEl);

      header.appendChild(cell);
    });

    dialog.appendChild(header);

    /* ── Build comparison rows ─────────────────────────────────────── */
    var GREEN = "var(--st-short,#6fc9a3)";

    /* Each row def: label, valueFn(listing) → string|null, better(va, vb) → "a"|"b"|"tie" */
    var allIn_a = _allInCost(a), allIn_b = _allInCost(b);
    var price_a = a.price_eur || a.price, price_b = b.price_eur || b.price;
    var monthly_a = (a.cost_of_ownership || {}).monthly_total_eur;
    var monthly_b = (b.cost_of_ownership || {}).monthly_total_eur;
    var flags_a = _countFlags(a), flags_b = _countFlags(b);

    var ROW_DEFS = [
      {
        label: "All-in cost",
        va: allIn_a ? window.fmtEur(allIn_a) : (price_a ? window.fmtEur(price_a) : null),
        vb: allIn_b ? window.fmtEur(allIn_b) : (price_b ? window.fmtEur(price_b) : null),
        winner: _numWinner(allIn_a || price_a, allIn_b || price_b, "lower"),
      },
      {
        label: "Area",
        va: a.area_sqm ? a.area_sqm + " m²" : null,
        vb: b.area_sqm ? b.area_sqm + " m²" : null,
        winner: _numWinner(a.area_sqm, b.area_sqm, "higher"),
      },
      {
        label: "Monthly",
        va: monthly_a ? window.fmtEur(monthly_a) : null,
        vb: monthly_b ? window.fmtEur(monthly_b) : null,
        winner: _numWinner(monthly_a, monthly_b, "lower"),
      },
      {
        label: "vs sold €/m²",
        va: _vsSoldLabel(a),
        vb: _vsSoldLabel(b),
        winner: null, /* no meaningful winner for % comparison */
      },
      {
        label: "AI score",
        va: a.score != null ? String(a.score) : null,
        vb: b.score != null ? String(b.score) : null,
        winner: _numWinner(a.score, b.score, "higher"),
      },
      {
        label: "Flags",
        va: String(flags_a),
        vb: String(flags_b),
        winner: _numWinner(flags_a, flags_b, "lower"),
      },
      {
        label: "Commute",
        va: a.commute_minutes != null ? a.commute_minutes + " min" : null,
        vb: b.commute_minutes != null ? b.commute_minutes + " min" : null,
        winner: _numWinner(a.commute_minutes, b.commute_minutes, "lower"),
      },
    ];

    /* Filter: only rows that DIFFER */
    var diffRows = ROW_DEFS.filter(function (row) {
      if (row.va == null && row.vb == null) return false;
      return row.va !== row.vb;
    });

    if (diffRows.length === 0) {
      var same = document.createElement("div");
      same.style.cssText = "padding:32px;text-align:center;color:var(--muted,#75798c);font:400 13px Inter,system-ui,sans-serif;";
      same.textContent = "Both listings look identical on the metrics that matter.";
      dialog.appendChild(same);
    } else {
      var rowsContainer = document.createElement("div");
      rowsContainer.style.cssText = "flex:1;overflow-y:auto;";

      diffRows.forEach(function (row) {
        var gridRow = document.createElement("div");
        gridRow.style.cssText = "display:grid;grid-template-columns:172px 1fr 1fr;border-bottom:1px solid var(--border,#292b31);";

        /* Label cell */
        var labelCell = document.createElement("div");
        labelCell.style.cssText = "padding:12px 16px;display:flex;align-items:center;font:400 12px Inter,system-ui,sans-serif;color:var(--text-3,#9397ab);";
        labelCell.textContent = row.label;
        gridRow.appendChild(labelCell);

        /* Value cells */
        [
          {val: row.va, isWinner: row.winner === "a"},
          {val: row.vb, isWinner: row.winner === "b"},
        ].forEach(function (col) {
          var cell = document.createElement("div");
          cell.style.cssText = [
            "padding:12px 16px",
            "display:flex",
            "align-items:center",
            "border-left:1px solid var(--border,#292b31)",
            "font:400 13px JetBrains Mono,ui-monospace,Menlo,monospace",
            "color:" + (col.isWinner ? GREEN : "var(--text,#e9e9ed)"),
            "font-weight:" + (col.isWinner ? "500" : "400"),
          ].join(";");
          cell.textContent = col.val != null ? col.val : "—";
          gridRow.appendChild(cell);
        });

        rowsContainer.appendChild(gridRow);
      });

      dialog.appendChild(rowsContainer);
    }

    /* ── Footer: action buttons per column ─────────────────────────── */
    var footer = document.createElement("div");
    footer.style.cssText = "display:grid;grid-template-columns:172px 1fr 1fr;border-top:1px solid var(--border,#292b31);flex-shrink:0;";

    /* Empty label cell */
    footer.appendChild(document.createElement("div"));

    /* Action buttons */
    [a, b].forEach(function (listing, colIdx) {
      var cell = document.createElement("div");
      cell.style.cssText = "padding:12px 16px;border-left:1px solid var(--border,#292b31);display:flex;flex-direction:column;gap:8px;";

      var draftBtn = document.createElement("button");
      draftBtn.type = "button";
      draftBtn.style.cssText = "background:var(--accent,#9184d9);color:#fff;border:none;border-radius:var(--r-md,6px);padding:8px 12px;font:500 12px Inter,system-ui,sans-serif;cursor:pointer;";
      draftBtn.textContent = "Draft offer on this one";
      draftBtn.addEventListener("click", function () {
        window.closeCompareOverlay();
        window.location.hash = "shortlist";
        if (window.openDetailPanel) window.openDetailPanel(listing.id);
      });
      cell.appendChild(draftBtn);

      var dropBtn = document.createElement("button");
      dropBtn.type = "button";
      dropBtn.style.cssText = "background:rgba(255,255,255,.06);color:var(--text-3,#9397ab);border:none;border-radius:var(--r-md,6px);padding:8px 12px;font:400 12px Inter,system-ui,sans-serif;cursor:pointer;";
      dropBtn.textContent = "Drop this one";
      dropBtn.addEventListener("click", function () {
        window.closeCompareOverlay();
        /* If viewed: call viewing-decision drop; else reject */
        var viewedStatuses = ["viewed", "thinking", "offer_drafted", "dropped"];
        if (viewedStatuses.indexOf(listing.status) !== -1) {
          if (window.dropClick) {
            window.dropClick(listing.id);
          }
        } else {
          /* Just navigate to shortlist and let user decide */
          window.location.hash = "shortlist";
          if (window.openDetailPanel) window.openDetailPanel(listing.id);
        }
      });
      cell.appendChild(dropBtn);

      footer.appendChild(cell);
    });

    dialog.appendChild(footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    /* Esc closes */
    function _escHandler(e) {
      if (e.key === "Escape") {
        window.closeCompareOverlay();
        document.removeEventListener("keydown", _escHandler);
      }
    }
    document.addEventListener("keydown", _escHandler);
  };

  /* ── Helper: numeric winner ──────────────────────────────────────── */
  function _numWinner(va, vb, dir) {
    if (va == null && vb == null) return null;
    if (va == null) return "b";
    if (vb == null) return "a";
    var na = parseFloat(String(va).replace(/[^\d.]/g, ""));
    var nb = parseFloat(String(vb).replace(/[^\d.]/g, ""));
    if (isNaN(na) || isNaN(nb) || na === nb) return null;
    if (dir === "lower") return na < nb ? "a" : "b";
    return na > nb ? "a" : "b";
  }

  /* ================================================================
     window.closeCompareOverlay
     ================================================================ */
  window.closeCompareOverlay = function () {
    var el = document.getElementById("cp-overlay-root");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  };

  /* ── CSS for selected sidebar rows ──────────────────────────────── */
  (function () {
    var style = document.createElement("style");
    style.textContent = [
      ".sidebar-item.compare-selected {",
      "  box-shadow: inset 0 0 0 1px var(--accent, #9184d9);",
      "  background: rgba(145,132,217,.08) !important;",
      "}",
      /* Disable Compare overlay + multi-select on mobile */
      "@media (max-width: 768px) {",
      "  #sl-compare-btn { display: none !important; }",
      "  .sidebar-item.compare-selected { box-shadow: none !important; background: transparent !important; }",
      "}",
    ].join("\n");
    document.head.appendChild(style);
  })();

  /* ── Wire old floating button for backward compat (no-op if absent) ── */
  document.addEventListener("DOMContentLoaded", function () {
    var old = document.getElementById("compare-floating");
    if (old) old.style.display = "none";
  });

  /* Expose old API surface (no-op shims so nothing breaks) */
  window.updateCompareSelection = function () {};

})();
