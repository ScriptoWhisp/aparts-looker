/*
 * detail-panel.js — Detail tab: sidebar list (20%) + main detail pane (80%).
 *
 * Exposes: window.renderDetailList(), window.openDetailPanel(listingId)
 * Calls:   window.loadData
 * Reads:   window.state, window.FULL_CHECKLIST, window.TEXT_ITEM_KEYS,
 *          window.commuteTier, window.fmtEur, window.scoreColor
 *
 * All listing strings use .textContent — no innerHTML with user data (T-05-32).
 * Mini-map lifecycle: destroy on each main-pane re-render (Pitfall 1).
 * URL safety: links only for http:// or https:// URLs (T-05-33).
 */
(function () {
  "use strict";

  /* Hard dealbreakers — if any are ✗, Approve is blocked */
  var DEALBREAKER_KEYS = new Set([
    "s01_07", // All costs fit income + buffer
    "s02_01", // Kinnistusraamat: encumbrances/liens/arrest
    "s02_05", // Owner matches seller
    "s02_08", // Full apartment, not a share
    "s02_09", // No third-party rights
    "s03_04", // Building debt to utility providers
    "s03_05", // Apartment utility debt
    "s10_01", // Unauthorized renovations
    "s10_03"  // Load-bearing walls not touched
  ]);

  var currentMiniMap = null;
  var currentListingId = null;

  /* ================================================================
     window.renderDetailList() — populate sidebar with all listings
     Wave 3: Nocturne sidebar redesign with filter input, grouped sections,
     score-colored left rules.
     ================================================================ */
  window.renderDetailList = function () {
    var sidebar = document.getElementById("detail-sidebar");
    if (!sidebar) return;
    while (sidebar.firstChild) sidebar.removeChild(sidebar.firstChild);

    /* --- Filter input --- */
    var filterWrap = document.createElement("div");
    filterWrap.className = "detail-sidebar-filter";

    var filterInput = document.createElement("input");
    filterInput.type = "text";
    filterInput.className = "detail-sidebar-input";
    filterInput.id = "sidebar-title-filter";
    filterInput.setAttribute("autocomplete", "off");
    filterInput.setAttribute("spellcheck", "false");

    /* Restore previously typed filter if any */
    if (window._sidebarTitleFilter) filterInput.value = window._sidebarTitleFilter;

    filterInput.addEventListener("input", function () {
      window._sidebarTitleFilter = filterInput.value;
      _renderSidebarList(listEl, allItems);
    });

    filterWrap.appendChild(filterInput);
    sidebar.appendChild(filterWrap);

    /* --- Scrollable list container --- */
    var listEl = document.createElement("div");
    listEl.className = "detail-sidebar-list";
    sidebar.appendChild(listEl);

    var allItems = (window.state.properties || []).map(function (e) { return {entry: e, isPending: false, isRejected: false}; })
      .concat((window.state.pending || []).map(function (e) { return {entry: e, isPending: true, isRejected: false}; }))
      .concat((window.state.rejected || []).map(function (e) { return {entry: e, isPending: false, isRejected: true}; }));

    /* Apply shared filter state */
    if (window.filterListing) {
      allItems = allItems.filter(function (item) {
        return window.filterListing(item.entry, item.isPending, item.isRejected);
      });
    }

    allItems.sort(function (a, b) {
      var sa = a.entry.score != null ? a.entry.score : -1;
      var sb = b.entry.score != null ? b.entry.score : -1;
      return sb - sa;
    });

    /* Update placeholder with count */
    filterInput.placeholder = "Filter " + allItems.length + " listings…";

    _renderSidebarList(listEl, allItems);
  };

  /* Private: re-render the sidebar list items (called on filter change too) */
  function _renderSidebarList(listEl, allItems) {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

    var titleFilter = (window._sidebarTitleFilter || "").toLowerCase().trim();

    var visible = titleFilter
      ? allItems.filter(function (item) {
          var title = (item.entry.title || item.entry.name || item.entry.id || "").toLowerCase();
          return title.indexOf(titleFilter) !== -1;
        })
      : allItems;

    if (visible.length === 0) {
      var empty = document.createElement("div");
      empty.style.cssText = "padding:20px;font-size:12px;color:var(--color-text-muted);text-align:center;";
      empty.textContent = "No listings match filters";
      listEl.appendChild(empty);
      return;
    }

    /* Split approved/viewed/scheduled vs pending */
    var approved = visible.filter(function (i) { return !i.isPending && !i.isRejected; });
    var pending  = visible.filter(function (i) { return i.isPending; });
    var rejected = visible.filter(function (i) { return i.isRejected; });

    function renderGroup(label, items, dimmed) {
      if (items.length === 0) return;
      var hdr = document.createElement("div");
      hdr.className = "detail-sidebar-group-header";
      hdr.textContent = label + " · " + items.length;
      listEl.appendChild(hdr);
      items.forEach(function (item) {
        var row = _buildSidebarItem(item.entry, item.isPending, dimmed);
        listEl.appendChild(row);
      });
    }

    if (approved.length > 0) renderGroup("Approved", approved, false);
    if (pending.length > 0)  renderGroup("Pending", pending, true);
    if (rejected.length > 0) renderGroup("Rejected", rejected, true);

    /* Re-select active */
    if (currentListingId) {
      var si = listEl.querySelector('[data-id="' + currentListingId + '"]');
      if (si) {
        si.classList.add("active");
        si.scrollIntoView({block: "nearest"});
      }
    }
  }

  /* ================================================================
     window.openDetailPanel(listingId) — highlight in sidebar + render main pane
     ================================================================ */
  window.openDetailPanel = function (listingId) {
    var sidebar = document.getElementById("detail-sidebar");
    /* If sidebar not yet rendered or empty, render it first */
    if (!sidebar || !sidebar.querySelector(".sidebar-item")) {
      window.renderDetailList();
      sidebar = document.getElementById("detail-sidebar");
    }

    /* Highlight sidebar item (may be inside .detail-sidebar-list) */
    if (sidebar) {
      sidebar.querySelectorAll(".sidebar-item").forEach(function (el) {
        el.classList.toggle("active", el.dataset.id === listingId);
      });
      var activeItem = sidebar.querySelector('[data-id="' + listingId + '"]');
      if (activeItem) activeItem.scrollIntoView({block: "nearest"});
    }

    currentListingId = listingId;
    _renderMainPane(listingId);
  };

  /* ================================================================
     Private: statusGlyph(entry) — returns a Unicode glyph for the viewing
     status to show in the sidebar meta line.
     - 📅 for viewing_scheduled
     - ✓  for viewed
     - ""  for approved / any other / missing status (Pitfall 6 default)
     - ""  if entry.removed is truthy — removed indicator already covers this (Open Question 4)
     Uses textContent-only writes (T-06-14 XSS guard).
     ================================================================ */
  function statusGlyph(entry) {
    if (entry.removed) return "";
    var status = entry.status || "approved";
    if (status === "viewing_scheduled") return "📅";
    if (status === "viewed") return "✓";
    return "";
  }

  /* ================================================================
     Private: _buildSidebarItem(entry, isPending, dimmed)
     Wave 3 Nocturne redesign: score-colored left rule, mono score,
     title + price·area meta, status glyph on right.
     ================================================================ */
  function _buildSidebarItem(entry, isPending, dimmed) {
    var scoreColor = window.scoreColor(entry.score || 0);

    var item = document.createElement("div");
    item.className = "sidebar-item";
    item.dataset.id = entry.id;
    item.style.setProperty("--rule-color", scoreColor);
    if (dimmed) item.style.opacity = "0.75";

    /* Left: score numeral */
    var scoreEl = document.createElement("span");
    scoreEl.className = "si-score";
    scoreEl.style.color = scoreColor;
    scoreEl.textContent = entry.score != null ? String(entry.score) : "?";
    item.appendChild(scoreEl);

    /* Middle: title + meta */
    var info = document.createElement("div");
    info.className = "si-info";

    var title = document.createElement("div");
    title.className = "si-title";
    title.textContent = entry.title || entry.name || entry.id || "";
    info.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "si-meta";
    var metaParts = [];
    var price = entry.price_eur || entry.price;
    if (price) metaParts.push(window.fmtEur(price));
    if (entry.area_sqm) metaParts.push(entry.area_sqm + " m²");
    meta.textContent = metaParts.join(" · ");
    info.appendChild(meta);

    item.appendChild(info);

    /* Right: status glyph */
    var status = entry.status || (isPending ? "pending" : "approved");
    if (status === "viewing_scheduled") {
      /* Blue 6×6 dot */
      var dot = document.createElement("span");
      dot.className = "si-status-dot";
      dot.style.color = "var(--status-viewing-text)";
      dot.title = "Viewing scheduled";
      item.appendChild(dot);
    } else if (status === "viewed") {
      var viewedEl = document.createElement("span");
      viewedEl.className = "si-status-glyph";
      viewedEl.textContent = "viewed";
      item.appendChild(viewedEl);
    } else if (status === "rejected" || entry.removed) {
      var rejDot = document.createElement("span");
      rejDot.className = "si-status-dot";
      rejDot.style.color = "var(--color-text-muted)";
      rejDot.style.opacity = "0.5";
      item.appendChild(rejDot);
    }

    /* Issues dot (hidden by default, shown by _refreshSidebarIssueDot) */
    var issuesDot = document.createElement("span");
    issuesDot.className = "si-issues-dot";
    issuesDot.id = "si-issues-" + entry.id;
    _refreshSidebarIssueDot(entry.id, issuesDot);
    item.appendChild(issuesDot);

    item.addEventListener("click", function () {
      window.openDetailPanel(entry.id);
    });

    return item;
  }

  function _refreshSidebarIssueDot(listingId, dotEl) {
    var el = dotEl || document.getElementById("si-issues-" + listingId);
    if (!el) return;
    var mc = ((window.state.checklists[listingId] || {}).manual_checklist) || {};
    var count = Object.keys(mc).filter(function (k) {
      return !k.endsWith("_note") && mc[k] === "issue";
    }).length;
    if (count > 0) {
      el.textContent = count;
      el.style.display = "inline-block";
    } else {
      el.style.display = "none";
    }
  }

  /* ================================================================
     Private: _renderMainPane(listingId) — Wave 3 Nocturne redesign
     Layout: hero row → verdict band → content row (checklist | cost+neg)
     All legacy action handlers preserved (scheduleViewingClick, etc.)
     ================================================================ */
  function _renderMainPane(listingId) {
    var main = document.getElementById("detail-main");
    if (!main) return;

    /* Destroy previous mini-map */
    if (currentMiniMap) {
      try { currentMiniMap.remove(); } catch (e) {}
      currentMiniMap = null;
    }

    while (main.firstChild) main.removeChild(main.firstChild);
    currentListingId = listingId;

    /* ---- Resolve entry ---- */
    var entry = null, isPending = false, isRejected = false;
    for (var i = 0; i < window.state.properties.length; i++) {
      if (window.state.properties[i].id === listingId) { entry = window.state.properties[i]; break; }
    }
    if (!entry) {
      for (var j = 0; j < window.state.pending.length; j++) {
        if (window.state.pending[j].id === listingId) { entry = window.state.pending[j]; isPending = true; break; }
      }
    }
    if (!entry) {
      for (var k = 0; k < (window.state.rejected || []).length; k++) {
        if (window.state.rejected[k].id === listingId) { entry = window.state.rejected[k]; isRejected = true; break; }
      }
    }
    if (!entry) return;

    var scoreColor = window.scoreColor(entry.score || 0);
    var status = entry.status || (isPending ? "pending" : isRejected ? "rejected" : "approved");

    /* ---- [1] HERO ROW ---- */
    var heroRow = _buildHeroRow(entry, isPending, isRejected, status, scoreColor);
    main.appendChild(heroRow);

    /* ---- [2] VERDICT BAND ---- */
    main.appendChild(_buildVerdictBand(entry, scoreColor));

    /* ---- [3] CONTENT ROW: checklist (left) + cost/neg (right) ---- */
    var contentRow = document.createElement("div");
    contentRow.className = "dm-content-row";

    /* Left col: 5-column signal grid + legacy action buttons */
    var leftCol = document.createElement("div");
    leftCol.className = "dm-left-col";

    /* Dealbreaker banner */
    var dealbreakerBanner = document.createElement("div");
    dealbreakerBanner.className = "dealbreaker-banner";
    dealbreakerBanner.style.display = "none";
    var bannerIcon = document.createElement("span");
    bannerIcon.textContent = "Dealbreaker issue — cannot approve until resolved";
    dealbreakerBanner.appendChild(bannerIcon);
    leftCol.appendChild(dealbreakerBanner);

    var approveBtnRef = null;

    function onChecklistChange() {
      _refreshSidebarIssueDot(entry.id);
      _updateDealbreakerBanner(entry.id, dealbreakerBanner, approveBtnRef);
    }

    leftCol.appendChild(_buildSignalGrid(entry, onChecklistChange));

    /* Legacy action buttons for pending entries */
    if (isPending) {
      var actionsDiv = document.createElement("div");
      actionsDiv.className = "detail-actions";
      actionsDiv.style.cssText = "margin-top:8px;display:flex;gap:8px;";

      var approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "btn btn-primary";
      approveBtn.textContent = "Approve";
      approveBtnRef = approveBtn;
      approveBtn.addEventListener("click", function () {
        approveBtn.disabled = true;
        fetch("/api/pending/" + encodeURIComponent(entry.id) + "/approve", {method: "POST"})
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.ok) window.loadData();
            else approveBtn.disabled = false;
          }).catch(function () { approveBtn.disabled = false; });
      });
      actionsDiv.appendChild(approveBtn);

      var rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "btn btn-secondary";
      rejectBtn.textContent = "Reject";
      rejectBtn.addEventListener("click", function () {
        var reason = window.prompt("Reason:", "other");
        if (reason === null) return;
        rejectBtn.disabled = true;
        fetch("/api/pending/" + encodeURIComponent(entry.id) + "/reject", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({reason: reason || "other"})
        }).then(function (r) { return r.json(); })
          .then(function (d) { if (d.ok) window.loadData(); else rejectBtn.disabled = false; })
          .catch(function () { rejectBtn.disabled = false; });
      });
      actionsDiv.appendChild(rejectBtn);

      leftCol.appendChild(actionsDiv);
    }

    /* Re-eval + debug + delete utility buttons */
    leftCol.appendChild(_buildUtilityButtons(entry));

    contentRow.appendChild(leftCol);

    /* Right col: cost + negotiation */
    var rightCol = document.createElement("div");
    rightCol.className = "dm-right-col";

    if (entry.cost_of_ownership) {
      rightCol.appendChild(_buildNocturneCostCard(entry.cost_of_ownership, entry));
    }

    rightCol.appendChild(_buildNocturneNegCard(entry, isPending, isRejected));

    /* KÜ section: collapsible at the bottom of right col */
    var kuHasAuto = entry.ku && entry.ku.auto && entry.ku.auto.reg_code;
    var kuHasManual = entry.ku && entry.ku.manual;
    if (kuHasAuto || kuHasManual) {
      var kuWrap = document.createElement("div");
      kuWrap.className = "dm-ku-section";
      kuWrap.appendChild(_buildKuCard(entry.ku, entry));
      rightCol.appendChild(kuWrap);
    }

    contentRow.appendChild(rightCol);
    main.appendChild(contentRow);

    /* Initialize dealbreaker banner */
    _updateDealbreakerBanner(entry.id, dealbreakerBanner, approveBtnRef);
  }

  /* ----------------------------------------------------------------
     _buildHeroRow — photo card (300px) + header block
     ---------------------------------------------------------------- */
  function _buildHeroRow(entry, isPending, isRejected, status, scoreColor) {
    var heroRow = document.createElement("div");
    heroRow.className = "dm-hero-row";

    /* ---- Left: photo card 300×184 ---- */
    var photoCard = document.createElement("div");
    photoCard.className = "dm-photo-card";

    var imgUrl = entry.image_url || entry.imageUrl || "";
    if (imgUrl && (imgUrl.startsWith("http://") || imgUrl.startsWith("https://"))) {
      var img = document.createElement("img");
      img.src = imgUrl;
      img.alt = entry.title || entry.name || "";
      img.loading = "lazy";
      img.addEventListener("error", function () {
        img.style.display = "none";
      });
      photoCard.appendChild(img);

      /* Link overlay to kv.ee */
      var entryUrl = entry.url || "";
      if (entryUrl.startsWith("http://") || entryUrl.startsWith("https://")) {
        var linkOverlay = document.createElement("a");
        linkOverlay.href = entryUrl;
        linkOverlay.target = "_blank";
        linkOverlay.rel = "noopener noreferrer";
        linkOverlay.style.cssText = "position:absolute;inset:0;z-index:2;";
        photoCard.appendChild(linkOverlay);
      }
    } else {
      var placeholder = document.createElement("span");
      placeholder.textContent = "photo";
      photoCard.appendChild(placeholder);
    }

    /* Photo count dots (visual only) */
    var photoCount = entry.image_count || entry.imageCount || 0;
    var dotsWrap = document.createElement("div");
    dotsWrap.className = "dm-photo-dots";
    var dotCount = Math.min(photoCount > 1 ? 3 : 1, 5);
    for (var di = 0; di < dotCount; di++) {
      var dot = document.createElement("span");
      dot.className = "dm-photo-dot" + (di === 0 ? " active" : "");
      dotsWrap.appendChild(dot);
    }
    if (photoCount > 0) photoCard.appendChild(dotsWrap);

    heroRow.appendChild(photoCard);

    /* ---- Right: header block ---- */
    var hdrBlock = document.createElement("div");
    hdrBlock.className = "dm-header-block";

    /* Status row */
    var statusRow = document.createElement("div");
    statusRow.className = "dm-status-row";

    /* Status tag */
    var tagClass = "tag-" + (status === "viewing_scheduled" ? "viewing" : status === "viewed" ? "viewed" : status === "rejected" ? "rejected" : isPending ? "pending" : "approved");
    var statusTag = document.createElement("span");
    statusTag.className = "tag " + tagClass;
    var statusLabels = {
      "approved": "approved",
      "viewing_scheduled": "viewing scheduled",
      "viewed": "viewed",
      "rejected": "rejected",
      "pending": "pending"
    };
    statusTag.textContent = statusLabels[status] || status;
    statusRow.appendChild(statusTag);

    /* Viewing info */
    if (entry.scheduled_at) {
      var sep = document.createElement("span");
      sep.style.color = "var(--color-text-muted)";
      sep.textContent = "·";
      statusRow.appendChild(sep);

      var viewingInfo = document.createElement("span");
      viewingInfo.className = "dm-viewing-info";
      try {
        var d = new Date(entry.scheduled_at);
        var months = ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","dets"];
        viewingInfo.textContent = "viewing " + d.getDate() + ". " + months[d.getMonth()] + " " +
          String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      } catch (_) {
        viewingInfo.textContent = entry.scheduled_at;
      }
      statusRow.appendChild(viewingInfo);
    }

    /* Action buttons top-right */
    var actionRow = document.createElement("div");
    actionRow.className = "dm-action-row";

    if (!isPending && !isRejected) {
      if (status === "approved") {
        var scheduleBtn = document.createElement("button");
        scheduleBtn.type = "button";
        scheduleBtn.className = "btn btn-primary";
        scheduleBtn.id = "schedule-viewing-btn-" + entry.id;
        scheduleBtn.textContent = "Schedule viewing";

        /* Inline picker (hidden) */
        var pickerWrap = document.createElement("div");
        pickerWrap.style.cssText = "display:none;position:absolute;top:100%;right:0;z-index:100;background:var(--color-surface);border-radius:var(--radius-md);box-shadow:var(--shadow-md);padding:12px;margin-top:4px;flex-direction:column;gap:8px;min-width:220px;";
        var dtInput = document.createElement("input");
        dtInput.type = "datetime-local";
        dtInput.id = "scheduled-at-input-" + entry.id;
        dtInput.style.cssText = "background:var(--color-sunken);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:6px 8px;color:var(--color-text);font-family:var(--font-body);font-size:13px;";
        var defDate = new Date();
        defDate.setHours(17, 0, 0, 0);
        dtInput.value = defDate.toISOString().slice(0, 16);
        var confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "btn btn-primary";
        confirmBtn.textContent = "Confirm";
        confirmBtn.addEventListener("click", function () {
          window.scheduleViewingClick(entry.id);
          pickerWrap.style.display = "none";
        });
        pickerWrap.appendChild(dtInput);
        pickerWrap.appendChild(confirmBtn);

        var scheduleBtnWrap = document.createElement("div");
        scheduleBtnWrap.style.cssText = "position:relative;display:inline-block;";
        scheduleBtn.addEventListener("click", function () {
          pickerWrap.style.display = pickerWrap.style.display === "none" ? "flex" : "none";
        });
        scheduleBtnWrap.appendChild(scheduleBtn);
        scheduleBtnWrap.appendChild(pickerWrap);
        actionRow.appendChild(scheduleBtnWrap);

      } else if (status === "viewing_scheduled") {
        var markViewedBtn = document.createElement("button");
        markViewedBtn.type = "button";
        markViewedBtn.className = "btn btn-primary";
        markViewedBtn.id = "mark-viewed-btn-" + entry.id;
        markViewedBtn.textContent = "Mark viewed";
        if (entry.scheduled_at) {
          var scheduledTime = new Date(entry.scheduled_at);
          if (new Date() < scheduledTime) {
            markViewedBtn.disabled = true;
            markViewedBtn.title = "Available from " + scheduledTime.toLocaleString();
          }
        }
        markViewedBtn.addEventListener("click", function () {
          window.markViewedClick(entry.id);
        });
        actionRow.appendChild(markViewedBtn);
      }

      /* kv.ee link button */
      var entryUrl2 = entry.url || "";
      if (entryUrl2.startsWith("http://") || entryUrl2.startsWith("https://")) {
        var kvLink = document.createElement("a");
        kvLink.href = entryUrl2;
        kvLink.target = "_blank";
        kvLink.rel = "noopener noreferrer";
        kvLink.className = "btn btn-secondary";
        kvLink.style.textDecoration = "none";
        kvLink.textContent = "kv.ee ↗";
        actionRow.appendChild(kvLink);
      }
    }

    var statusAndActions = document.createElement("div");
    statusAndActions.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;";
    statusAndActions.appendChild(statusRow);
    statusAndActions.appendChild(actionRow);
    hdrBlock.appendChild(statusAndActions);

    /* Title */
    var titleEl = document.createElement("div");
    titleEl.className = "dm-title";
    titleEl.textContent = entry.title || entry.name || entry.id || "";
    hdrBlock.appendChild(titleEl);

    /* Meta line: district · rooms · floor · year · energiaklass */
    var metaParts = [];
    if (entry.district) metaParts.push(entry.district);
    if (entry.rooms) metaParts.push(entry.rooms + " tuba");
    if (entry.floor != null && entry.floor_total != null) metaParts.push(entry.floor + "/" + entry.floor_total + " korrus");
    else if (entry.floor != null) metaParts.push(entry.floor + ". korrus");
    if (entry.year_built || entry.year) metaParts.push(String(entry.year_built || entry.year));
    if (entry.energy_class) metaParts.push("energiaklass " + entry.energy_class);
    var metaLine = document.createElement("div");
    metaLine.className = "dm-meta-line";
    metaLine.textContent = metaParts.join(" · ");
    hdrBlock.appendChild(metaLine);

    /* 4-metric strip */
    var strip = document.createElement("div");
    strip.className = "dm-metric-strip";

    function _metricCell(val, meta, color) {
      var cell = document.createElement("div");
      cell.className = "dm-metric-cell";
      var v = document.createElement("div");
      v.className = "dm-metric-val";
      if (color) v.style.color = color;
      v.textContent = val;
      var m = document.createElement("div");
      m.className = "dm-metric-meta";
      m.textContent = meta;
      cell.appendChild(v);
      cell.appendChild(m);
      return cell;
    }

    /* Price */
    var price = entry.price_eur || entry.price || 0;
    var pricePerSqm = entry.price_per_sqm || entry.pricePerSqm;
    var priceMetaParts = [];
    if (pricePerSqm) priceMetaParts.push(Math.round(pricePerSqm) + " €/m²");
    /* District delta: not reliably in entry data, skip if absent */
    strip.appendChild(_metricCell(price ? window.fmtEur(price) : "—", priceMetaParts.join(" · ") || "asking price", null));

    /* Area */
    var areaMeta = entry.area_sqm ? "m²" : "";
    if (entry.rooms) areaMeta += (areaMeta ? " · " : "") + entry.rooms + " tuba";
    strip.appendChild(_metricCell(entry.area_sqm ? entry.area_sqm : "—", areaMeta || "area", null));

    /* Score */
    /* Rank among all known listings */
    var allScored = (window.state.properties || []).concat(window.state.pending || []).filter(function (e) { return e.score != null; });
    allScored.sort(function (a, b) { return b.score - a.score; });
    var rank = allScored.findIndex(function (e) { return e.id === entry.id; });
    var rankPct = allScored.length > 0 && rank >= 0 ? Math.round((rank / allScored.length) * 100) : null;
    var scoreMeta = "score" + (rankPct !== null ? " · top " + Math.max(1, rankPct) + "%" : "");
    strip.appendChild(_metricCell(entry.score != null ? String(entry.score) : "—", scoreMeta, scoreColor));

    /* Monthly total */
    var coo = entry.cost_of_ownership;
    var monthlyTotal = coo ? coo.monthly_total_eur : null;
    strip.appendChild(_metricCell(monthlyTotal ? window.fmtEur(monthlyTotal) : "—", "monthly, all-in", null));

    hdrBlock.appendChild(strip);
    heroRow.appendChild(hdrBlock);

    return heroRow;
  }

  /* ----------------------------------------------------------------
     _buildVerdictBand — colored border card with verdict + flag/unknown/ok counts
     ---------------------------------------------------------------- */
  function _buildVerdictBand(entry, scoreColor) {
    var band = document.createElement("div");
    band.className = "dm-verdict-band";
    band.style.borderLeft = "2px solid " + scoreColor;

    /* Left: kicker + verdict text */
    var content = document.createElement("div");
    content.className = "dm-verdict-content";

    var kicker = document.createElement("div");
    kicker.className = "dm-verdict-kicker";
    kicker.textContent = "Вердикт";
    content.appendChild(kicker);

    var verdictText = document.createElement("div");
    verdictText.className = "dm-verdict-text";
    verdictText.textContent = entry.verdict || "AI verdict not yet generated — click Re-evaluate.";
    content.appendChild(verdictText);

    band.appendChild(content);

    /* Right: 3 status tags — flags / unknown / ok */
    var tags = document.createElement("div");
    tags.className = "dm-verdict-tags";

    /* Count checklist statuses */
    var clData = window.state.checklists[entry.id] || {};
    var manualChecklist = clData.manual_checklist || {};
    var aiFills = entry.ai_checklist_fills || {};

    var okCount = 0, unknownCount = 0, flagCount = 0, totalCount = 0;

    (window.FULL_CHECKLIST || []).forEach(function (section) {
      (section.items || []).forEach(function (it) {
        totalCount++;
        var isAi = it.id.startsWith("ai__");
        var storageKey = isAi ? it.id.slice(4) : it.id;
        var aiVal = it.aiVal;
        if (aiVal && typeof aiVal === "object") aiVal = aiVal.result;
        if (aiVal === "pass") aiVal = "ok";
        if (aiVal === "fail") aiVal = "issue";
        /* Also check AI fills from entry */
        var aiEntryVal = entry.checklist && entry.checklist[storageKey];
        if (aiEntryVal && typeof aiEntryVal === "object") aiEntryVal = aiEntryVal.result;
        if (aiEntryVal === "pass") aiEntryVal = "ok";
        if (aiEntryVal === "fail") aiEntryVal = "issue";
        var effective = manualChecklist[storageKey] || aiVal || aiEntryVal || null;
        if (effective === "ok") okCount++;
        else if (effective === "issue") flagCount++;
        else unknownCount++;
      });
    });

    /* Fallback: if FULL_CHECKLIST not populated, try entry.checklist keys */
    if (totalCount === 0 && entry.checklist) {
      Object.keys(entry.checklist).forEach(function (k) {
        var v = entry.checklist[k];
        if (typeof v === "object") v = v.result;
        if (v === "pass" || v === "ok") okCount++;
        else if (v === "fail" || v === "issue") flagCount++;
        else unknownCount++;
        totalCount++;
      });
    }

    function _verdictTag(text, cls) {
      var t = document.createElement("span");
      t.className = "tag " + cls;
      t.textContent = text;
      return t;
    }

    if (flagCount > 0 || unknownCount > 0 || okCount > 0) {
      if (flagCount > 0) tags.appendChild(_verdictTag(flagCount + " flags", "tag-rejected"));
      if (unknownCount > 0) tags.appendChild(_verdictTag(unknownCount + " unknown", "tag-viewed"));
      if (okCount > 0) tags.appendChild(_verdictTag(okCount + " ok", "tag-approved"));
    }

    band.appendChild(tags);
    return band;
  }

  /* ================================================================
     Private: _updateDealbreakerBanner
     ================================================================ */
  function _updateDealbreakerBanner(listingId, bannerEl, approveBtn) {
    var mc = ((window.state.checklists[listingId] || {}).manual_checklist) || {};
    var hit = false;
    DEALBREAKER_KEYS.forEach(function (k) { if (mc[k] === "issue") hit = true; });
    if (bannerEl) bannerEl.style.display = hit ? "flex" : "none";
    if (approveBtn) {
      approveBtn.disabled = hit;
      approveBtn.title = hit ? "Cannot approve: dealbreaker issue marked" : "";
    }
  }

  /* ================================================================
     Private: _buildChecklistGroup — one collapsible section
     ================================================================ */
  function _buildChecklistGroup(label, items, listingId, manualChecklist, startOpen, onChange, aiFills) {
    aiFills = aiFills || {};
    var group = document.createElement("div");
    group.className = "cl-group";

    var groupHeader = document.createElement("div");
    groupHeader.className = "cl-group-header";
    groupHeader.setAttribute("role", "button");
    groupHeader.setAttribute("tabindex", "0");

    var groupLabel = document.createElement("span");
    groupLabel.className = "cl-group-label";
    groupLabel.textContent = label;
    groupHeader.appendChild(groupLabel);

    var groupCount = document.createElement("span");
    groupCount.className = "cl-group-count";
    groupHeader.appendChild(groupCount);

    var groupIssues = document.createElement("span");
    groupIssues.className = "cl-group-issues";
    groupHeader.appendChild(groupIssues);

    var groupChevron = document.createElement("span");
    groupChevron.className = "cl-group-chevron";
    groupChevron.textContent = startOpen ? "▴" : "▾";
    groupHeader.appendChild(groupChevron);

    group.appendChild(groupHeader);

    var groupBody = document.createElement("div");
    groupBody.className = "cl-group-body";
    groupBody.style.display = startOpen ? "block" : "none";

    function _refreshCounts() {
      var mc = ((window.state.checklists[listingId] || {}).manual_checklist) || {};
      var done = 0, issues = 0;
      items.forEach(function (it) {
        var k = it.id.startsWith("ai__") ? it.id.slice(4) : it.id;
        var aiVal = it.aiVal;
        if (aiVal && typeof aiVal === "object") aiVal = aiVal.result;
        if (aiVal === "pass") aiVal = "ok";
        if (aiVal === "fail") aiVal = "issue";
        var v = mc[k] || aiVal || null;
        if (v === "ok") done++;
        if (v === "issue") issues++;
      });
      groupCount.textContent = done + "/" + items.length;
      if (issues > 0) {
        groupIssues.textContent = "· " + issues + " ✗";
        groupIssues.style.display = "inline";
      } else {
        groupIssues.style.display = "none";
      }
    }
    _refreshCounts();

    items.forEach(function (it) {
      var isAi = it.id.startsWith("ai__");
      var storageKey = isAi ? it.id.slice(4) : it.id;
      var isDealbreakerItem = DEALBREAKER_KEYS.has(storageKey);
      var isTextItem = !isAi && (window.TEXT_ITEM_KEYS || new Set()).has(storageKey);
      var noteKey = storageKey + "_note";

      /* Initial effective state */
      var manualVal = manualChecklist[storageKey];
      var aiVal = it.aiVal;
      if (aiVal && typeof aiVal === "object") aiVal = aiVal.result;
      if (aiVal === "pass") aiVal = "ok";
      if (aiVal === "fail") aiVal = "issue";
      var effective = manualVal || aiVal || null;
      var savedNote = manualChecklist[noteKey] || "";
      var aiFillText = aiFills[storageKey] || "";
      /* Show AI text ONLY if user has no manual note. First user keystroke replaces it. */
      var showingAiFill = !savedNote && !!aiFillText;
      var displayNote = savedNote || aiFillText;

      /* Item row */
      var row = document.createElement("div");
      row.className = "cl-item" + (isDealbreakerItem ? " cl-item-dealbreaker" : "");

      var btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.value = effective || "null";
      btn.className = "cl-btn " + (effective === "ok" ? "cl-ok" : effective === "issue" ? "cl-issue" : "cl-unchecked");
      btn.textContent = effective === "ok" ? "✓" : effective === "issue" ? "✗" : "○";
      btn.title = isDealbreakerItem ? "⚠ Dealbreaker — click to cycle" : "Click to cycle: unchecked → ok → issue";

      var itemText = document.createElement("span");
      itemText.className = "cl-item-text";
      itemText.textContent = it.text;

      row.appendChild(btn);
      row.appendChild(itemText);

      if (isDealbreakerItem) {
        var dbMark = document.createElement("span");
        dbMark.className = "cl-dealbreaker-mark";
        dbMark.title = "Dealbreaker";
        dbMark.textContent = "⚠";
        row.appendChild(dbMark);
      } else if (isAi && aiVal && !manualVal) {
        var aiTag = document.createElement("span");
        aiTag.className = "cl-ai-tag";
        aiTag.textContent = "AI";
        row.appendChild(aiTag);
      }

      groupBody.appendChild(row);

      /* Note / text row — visible if item is text-type, if user marked ✗, or if AI has a suggestion */
      var noteRow = document.createElement("div");
      noteRow.className = "cl-item-note-row";
      noteRow.style.display = (isTextItem || effective === "issue" || showingAiFill) ? "flex" : "none";

      var noteInput = document.createElement("input");
      noteInput.type = "text";
      noteInput.className = "cl-note-input" + (showingAiFill ? " cl-note-ai-fill" : "");
      noteInput.placeholder = isTextItem ? "Записать ответ…" : "Заметка…";
      noteInput.value = displayNote;
      noteRow.appendChild(noteInput);

      if (showingAiFill) {
        var aiFillBadge = document.createElement("span");
        aiFillBadge.className = "cl-note-ai-badge";
        aiFillBadge.textContent = "AI";
        aiFillBadge.title = "Заполнено ИИ на основе описания. Отредактируйте, чтобы сохранить свою версию.";
        noteRow.appendChild(aiFillBadge);
      }

      var noteTimer = null;
      /* First user keystroke on an AI-filled input: drop the AI styling — from now on it's the user's own text */
      noteInput.addEventListener("input", function () {
        if (noteInput.classList.contains("cl-note-ai-fill")) {
          noteInput.classList.remove("cl-note-ai-fill");
          var badge = noteRow.querySelector(".cl-note-ai-badge");
          if (badge) badge.parentNode.removeChild(badge);
        }
        clearTimeout(noteTimer);
        noteTimer = setTimeout(function () {
          var val = noteInput.value.trim();
          var localCl = window.state.checklists[listingId];
          if (!localCl) { window.state.checklists[listingId] = {}; localCl = window.state.checklists[listingId]; }
          if (!localCl.manual_checklist) localCl.manual_checklist = {};
          if (val) localCl.manual_checklist[noteKey] = val;
          else delete localCl.manual_checklist[noteKey];
          if (!val) return;
          fetch("/api/listings/" + encodeURIComponent(listingId) + "/checklist", {
            method: "PATCH",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({key: noteKey, value: val})
          }).catch(function (e) { console.error("note save error", e); });
        }, 600);
      });

      groupBody.appendChild(noteRow);

      /* Toggle cycle: null → ok → issue → null */
      btn.addEventListener("click", function () {
        var cur = btn.dataset.value === "null" ? null : btn.dataset.value;
        var next = cur === null ? "ok" : cur === "ok" ? "issue" : null;
        btn.dataset.value = next === null ? "null" : next;
        btn.className = "cl-btn " + (next === "ok" ? "cl-ok" : next === "issue" ? "cl-issue" : "cl-unchecked");
        btn.textContent = next === "ok" ? "✓" : next === "issue" ? "✗" : "○";

        /* For check items: show/hide note row; for text items note row stays */
        if (!isTextItem) {
          noteRow.style.display = next === "issue" ? "flex" : "none";
          if (next !== "issue") noteInput.value = "";
        }

        var localCl = window.state.checklists[listingId];
        if (!localCl) { window.state.checklists[listingId] = {}; localCl = window.state.checklists[listingId]; }
        if (!localCl.manual_checklist) localCl.manual_checklist = {};
        if (next === null) {
          delete localCl.manual_checklist[storageKey];
          if (!isTextItem) delete localCl.manual_checklist[noteKey];
        } else {
          localCl.manual_checklist[storageKey] = next;
        }

        _refreshCounts();
        if (onChange) onChange();

        fetch("/api/listings/" + encodeURIComponent(listingId) + "/checklist", {
          method: "PATCH",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({key: storageKey, value: next === null ? "unknown" : next})
        }).catch(function (e) { console.error("checklist save error", e); });
      });
    });

    groupHeader.addEventListener("click", function () {
      var open = groupBody.style.display !== "none";
      groupBody.style.display = open ? "none" : "block";
      groupChevron.textContent = open ? "▾" : "▴";
    });
    groupHeader.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); groupHeader.click(); }
    });

    group.appendChild(groupBody);
    return group;
  }

  /* ================================================================
     Private: _buildCostOfOwnership(coo) — true monthly cost card
     ================================================================ */
  function _buildCostOfOwnership(coo, entry) {
    var card = document.createElement("div");
    card.className = "coo-card";
    if (coo.overridden) card.classList.add("coo-overridden");

    /* Headline row */
    var head = document.createElement("div");
    head.className = "coo-headline";

    var totalWrap = document.createElement("div");
    totalWrap.className = "coo-total-wrap";
    var total = document.createElement("span");
    total.className = "coo-total";
    total.textContent = window.fmtEur(coo.monthly_total_eur || 0);
    totalWrap.appendChild(total);
    var suf = document.createElement("span");
    suf.className = "coo-total-suffix";
    suf.textContent = " / month · Cost of ownership";
    totalWrap.appendChild(suf);
    if (coo.overridden) {
      var badge = document.createElement("span");
      badge.className = "coo-override-badge";
      badge.textContent = "manual";
      badge.title = "Values manually overridden — settings recompute will skip this entry";
      totalWrap.appendChild(badge);
    }
    head.appendChild(totalWrap);

    var right = document.createElement("div");
    right.className = "coo-head-right";
    if (coo.cost_per_sqm_eur != null) {
      var perSqm = document.createElement("span");
      perSqm.className = "coo-per-sqm";
      perSqm.textContent = coo.cost_per_sqm_eur + " €/m²/mo";
      right.appendChild(perSqm);
    }
    var editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "coo-edit-btn";
    editBtn.textContent = "Edit";
    right.appendChild(editBtn);
    head.appendChild(right);
    card.appendChild(head);

    /* Breakdown (read view) */
    var b = coo.breakdown || {};
    var readGrid = document.createElement("div");
    readGrid.className = "coo-breakdown";
    var lines = [
      ["mortgage",  "Mortgage"],
      ["ku_fee",    "Building fee (KÜ)"],
      ["heating",   "Heating"],
      ["utilities", "Utilities"],
    ];
    lines.forEach(function (pair) {
      var lbl = document.createElement("span");
      lbl.className = "coo-item-label";
      lbl.textContent = pair[1];
      readGrid.appendChild(lbl);
      var val = document.createElement("span");
      val.className = "coo-item-val";
      val.textContent = b[pair[0]] != null ? window.fmtEur(b[pair[0]]) : "—";
      readGrid.appendChild(val);
    });
    card.appendChild(readGrid);

    /* Assumptions footnote */
    var a = coo.assumptions || {};
    var foot = document.createElement("div");
    foot.className = "coo-assumptions";
    foot.textContent =
      a.down_pct + "% down · " +
      a.interest_pct + "% rate · " +
      a.term_years + "y term · " +
      "KÜ " + a.ku_rate_per_sqm + " €/m² · " +
      "heat " + a.heating_per_sqm + " €/m² · " +
      "utilities " + a.utilities_base + " €/mo";
    card.appendChild(foot);

    /* Edit view — hidden until user clicks Edit */
    var editWrap = document.createElement("div");
    editWrap.className = "coo-edit-wrap";
    editWrap.style.display = "none";

    var editHint = document.createElement("div");
    editHint.className = "coo-edit-hint";
    editHint.textContent = "Override per-listing values. Blank = keep current. Global settings recompute will skip this entry until you reset.";
    editWrap.appendChild(editHint);

    var editGrid = document.createElement("div");
    editGrid.className = "coo-edit-grid";
    var inputs = {};
    lines.forEach(function (pair) {
      var key = pair[0], label = pair[1];
      var field = document.createElement("div");
      field.className = "coo-edit-field";
      var lbl = document.createElement("label");
      lbl.textContent = label;
      var inp = document.createElement("input");
      inp.type = "number";
      inp.min = "0";
      inp.step = "1";
      inp.placeholder = String(b[key] != null ? b[key] : "");
      inp.value = b[key] != null ? String(b[key]) : "";
      inputs[key] = inp;
      field.appendChild(lbl);
      field.appendChild(inp);
      editGrid.appendChild(field);
    });
    editWrap.appendChild(editGrid);

    var actions = document.createElement("div");
    actions.className = "coo-edit-actions";
    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "coo-btn coo-btn-primary";
    saveBtn.textContent = "Save";
    var cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "coo-btn";
    cancelBtn.textContent = "Cancel";
    var resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "coo-btn coo-btn-ghost";
    resetBtn.textContent = "Reset to computed";
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    actions.appendChild(resetBtn);
    editWrap.appendChild(actions);
    card.appendChild(editWrap);

    function _swap(showEdit) {
      editWrap.style.display = showEdit ? "block" : "none";
      readGrid.style.display  = showEdit ? "none"  : "grid";
      foot.style.display      = showEdit ? "none"  : "block";
      editBtn.textContent     = showEdit ? "Close" : "Edit";
    }
    editBtn.addEventListener("click", function () {
      _swap(editWrap.style.display === "none");
    });
    cancelBtn.addEventListener("click", function () { _swap(false); });

    function _replaceCard(newCoo) {
      if (!entry) return;
      entry.cost_of_ownership = newCoo;
      var fresh = _buildCostOfOwnership(newCoo, entry);
      card.parentNode.replaceChild(fresh, card);
    }

    saveBtn.addEventListener("click", function () {
      var body = {};
      Object.keys(inputs).forEach(function (k) {
        var v = inputs[k].value.trim();
        if (v !== "") body[k] = Number(v);
      });
      saveBtn.disabled = true;
      fetch("/api/entry/" + encodeURIComponent(entry.id) + "/cost-override", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
        .then(function (j) {
          window.showToast && window.showToast("Cost updated", "success");
          _replaceCard(j.cost_of_ownership);
        })
        .catch(function () {
          saveBtn.disabled = false;
          window.showToast && window.showToast("Save failed", "error");
        });
    });

    resetBtn.addEventListener("click", function () {
      resetBtn.disabled = true;
      fetch("/api/entry/" + encodeURIComponent(entry.id) + "/cost-override", {
        method: "DELETE",
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
        .then(function (j) {
          window.showToast && window.showToast("Reset to computed", "success");
          _replaceCard(j.cost_of_ownership);
        })
        .catch(function () {
          resetBtn.disabled = false;
          window.showToast && window.showToast("Reset failed", "error");
        });
    });

    return card;
  }

  /* ================================================================
     Private: _buildNegotiationBrief(brief, entry) — AI negotiation brief card
     Mirrors _buildCostOfOwnership shape: card root, headline row with Regenerate
     button, brief text via textContent (XSS-safe per project convention), offer
     range line, optional needs_review warning badge. D-07 placement: rendered
     AFTER AI Verdict block and BEFORE COO card in _renderMainPane.
     ================================================================ */
  function _buildNegotiationBrief(brief, entry) {
    var card = document.createElement("div");
    card.className = "brief-card";

    /* Headline row: label on left, Regenerate button on right */
    var head = document.createElement("div");
    head.className = "brief-headline";

    var labelEl = document.createElement("div");
    labelEl.className = "brief-card-label";
    labelEl.textContent = "Negotiation brief";
    head.appendChild(labelEl);

    var regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.className = "coo-edit-btn";
    regenBtn.textContent = "Regenerate";
    // Debounce: disable for 2 seconds after click to prevent runaway Anthropic calls (T-06-09)
    regenBtn.addEventListener("click", function () {
      regenBtn.disabled = true;
      window.regenerateBriefClick && window.regenerateBriefClick(entry.id, regenBtn);
    });
    head.appendChild(regenBtn);

    card.appendChild(head);

    /* needs_review warning badge (Pitfall 4 surfacing) */
    if (brief.needs_review === true) {
      var badge = document.createElement("div");
      badge.className = "brief-review-badge";
      badge.textContent = "⚠ Numbers may need review";
      card.appendChild(badge);
    }

    /* Error state */
    if (brief.error) {
      var errEl = document.createElement("p");
      errEl.className = "brief-error";
      errEl.textContent = brief.error;
      card.appendChild(errEl);
      return card;
    }

    /* Brief text — textContent only, never innerHTML (XSS safety, T-06-06) */
    var body = document.createElement("p");
    body.className = "brief-body";
    body.textContent = brief.brief_ru;
    card.appendChild(body);

    /* Suggested offer range */
    var low = brief.suggested_offer_low_eur;
    var high = brief.suggested_offer_high_eur;
    if (low || high) {
      var offerLine = document.createElement("div");
      offerLine.className = "brief-offer-range";
      var fmtEur = window.fmtEur || function (n) { return n + " €"; };
      offerLine.textContent = "Suggested offer range: " + fmtEur(low) + " – " + fmtEur(high);
      card.appendChild(offerLine);
    }

    return card;
  }

  /* ================================================================
     Private: _buildKuCard(ku, entry) — KÜ data card (ENRICH-01, D-11, D-13)
     Mirrors _buildNegotiationBrief shape. Renders only when ku.auto has content
     (D-13 hide-when-empty). If ku.manual is present but ku.auto is empty,
     renders a minimal card with just the manual textarea (notes are never hidden).
     All registry/API-supplied strings written via .textContent (XSS-safe, T-06-13).
     ================================================================ */
  function _buildKuCard(ku, entry) {
    var card = document.createElement("div");
    card.className = "ku-card";

    /* Headline row: label + timestamp on left, Refresh button on right */
    var head = document.createElement("div");
    head.className = "ku-headline";

    var labelWrap = document.createElement("div");
    labelWrap.className = "ku-label-wrap";

    var labelEl = document.createElement("div");
    labelEl.className = "ku-card-label";
    labelEl.textContent = "KÜ data";
    labelWrap.appendChild(labelEl);

    if (ku.looked_up_at) {
      var tsEl = document.createElement("span");
      tsEl.className = "ku-timestamp";
      try {
        tsEl.textContent = " — " + new Date(ku.looked_up_at).toLocaleDateString();
      } catch (_) {
        tsEl.textContent = "";
      }
      labelWrap.appendChild(tsEl);
    }
    head.appendChild(labelWrap);

    var refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "coo-edit-btn";
    refreshBtn.textContent = "Refresh";
    refreshBtn.addEventListener("click", function () {
      refreshBtn.disabled = true;
      window.refreshKuClick && window.refreshKuClick(entry.id, refreshBtn);
    });
    head.appendChild(refreshBtn);

    card.appendChild(head);

    /* Auto lookup results — only when present */
    if (ku.auto && ku.auto.reg_code) {
      var auto = ku.auto;

      var nameRow = document.createElement("div");
      nameRow.className = "ku-row";
      var nameLabel = document.createElement("span");
      nameLabel.className = "ku-row-label";
      nameLabel.textContent = "Name";
      var nameVal = document.createElement("span");
      nameVal.className = "ku-row-val";
      nameVal.textContent = auto.name || "";
      nameRow.appendChild(nameLabel);
      nameRow.appendChild(nameVal);
      card.appendChild(nameRow);

      var codeRow = document.createElement("div");
      codeRow.className = "ku-row";
      var codeLabel = document.createElement("span");
      codeLabel.className = "ku-row-label";
      codeLabel.textContent = "Reg code";
      var codeVal = document.createElement("span");
      codeVal.className = "ku-row-val";
      codeVal.textContent = auto.reg_code != null ? String(auto.reg_code) : "";
      codeRow.appendChild(codeLabel);
      codeRow.appendChild(codeVal);
      card.appendChild(codeRow);

      var addrRow = document.createElement("div");
      addrRow.className = "ku-row";
      var addrLabel = document.createElement("span");
      addrLabel.className = "ku-row-label";
      addrLabel.textContent = "Address";
      var addrVal = document.createElement("span");
      addrVal.className = "ku-row-val";
      addrVal.textContent = auto.legal_address || "";
      addrRow.appendChild(addrLabel);
      addrRow.appendChild(addrVal);
      card.appendChild(addrRow);

      /* ariregister source link — href set via property assignment (XSS-safe) */
      if (auto.url) {
        var linkEl = document.createElement("a");
        linkEl.className = "ku-source-link";
        linkEl.href = auto.url;  // property assignment, not innerHTML
        linkEl.target = "_blank";
        linkEl.rel = "noopener noreferrer";
        linkEl.textContent = "ariregister.rik.ee";
        card.appendChild(linkEl);
      }
    }

    /* Manual notes textarea — always rendered when the card is visible */
    var notesLabel = document.createElement("span");
    notesLabel.className = "ku-notes-label";
    notesLabel.textContent = "Notes";
    card.appendChild(notesLabel);

    var textarea = document.createElement("textarea");
    textarea.className = "ku-notes-textarea";
    textarea.placeholder = "Notes: paste facts from meeting minutes here";
    textarea.value = (ku && ku.manual) ? ku.manual : "";
    textarea.addEventListener("blur", function () {
      window.saveKuManualNotes && window.saveKuManualNotes(entry.id, textarea.value);
    });
    card.appendChild(textarea);

    return card;
  }

  /* ================================================================
     Private: _buildAiDepthSection(entry) — verdict + score breakdown + risks + strengths
     ================================================================ */
  function _buildAiDepthSection(entry) {
    var wrap = document.createElement("div");
    wrap.className = "ai-depth-wrap";

    var verdict = entry.verdict || "";
    var breakdown = entry.score_breakdown || {};
    var risks = entry.risks || [];
    var strengths = entry.strengths || [];
    var hasNewSchema = Object.keys(breakdown).length > 0 || risks.length > 0;

    /* Verdict block — always shown if a verdict exists */
    if (verdict) {
      var vblock = document.createElement("div");
      vblock.className = "ai-block";
      var vlabel = document.createElement("div");
      vlabel.className = "ai-block-label";
      vlabel.textContent = "AI Verdict";
      vblock.appendChild(vlabel);
      var vbox = document.createElement("div");
      vbox.className = "ai-verdict";
      var vLower = verdict.toLowerCase();
      if (vLower.startsWith("skip")) vbox.classList.add("verdict-skip");
      else if (vLower.startsWith("prioritise") || vLower.startsWith("prioritize")) vbox.classList.add("verdict-priority");
      vbox.textContent = verdict;
      vblock.appendChild(vbox);
      wrap.appendChild(vblock);
    }

    /* Score breakdown */
    var bdBlock = document.createElement("div");
    bdBlock.className = "ai-block";
    var bdLabel = document.createElement("div");
    bdLabel.className = "ai-block-label";
    bdLabel.textContent = "Score Breakdown · " + (entry.score != null ? entry.score : "?") + "/100";
    bdBlock.appendChild(bdLabel);

    var CATEGORIES = [
      ["location",    "Location"],
      ["price_value", "Value"],
      ["condition",   "Condition"],
      ["layout",      "Layout"],
      ["extras",      "Extras"],
    ];
    var hasAnyBreakdown = false;
    CATEGORIES.forEach(function (pair) {
      var key = pair[0], label = pair[1];
      var d = breakdown[key];
      if (!d) return;
      hasAnyBreakdown = true;
      var row = document.createElement("div");
      row.className = "breakdown-row";
      var lbl = document.createElement("span");
      lbl.className = "breakdown-label";
      lbl.textContent = label;
      row.appendChild(lbl);
      var barOuter = document.createElement("div");
      barOuter.className = "breakdown-bar-outer";
      var barInner = document.createElement("div");
      barInner.className = "breakdown-bar-inner";
      var pct = d.max ? Math.max(0, Math.min(100, (d.points / d.max) * 100)) : 0;
      barInner.style.width = pct + "%";
      barInner.style.background = window.scoreColor(pct);
      barOuter.appendChild(barInner);
      row.appendChild(barOuter);
      var pts = document.createElement("span");
      pts.className = "breakdown-points";
      pts.textContent = (d.points != null ? d.points : "?") + "/" + (d.max != null ? d.max : "?");
      row.appendChild(pts);
      bdBlock.appendChild(row);
      if (d.reason) {
        var reason = document.createElement("div");
        reason.className = "breakdown-reason";
        reason.textContent = d.reason;
        bdBlock.appendChild(reason);
      }
    });
    if (!hasAnyBreakdown) {
      var empty = document.createElement("div");
      empty.className = "ai-empty";
      empty.textContent = "No breakdown yet — click 🤖 Re-evaluate to compute.";
      bdBlock.appendChild(empty);
    }
    wrap.appendChild(bdBlock);

    /* Risks */
    var rBlock = document.createElement("div");
    rBlock.className = "ai-block";
    var rLabel = document.createElement("div");
    rLabel.className = "ai-block-label";
    rLabel.textContent = "Risks";
    rBlock.appendChild(rLabel);

    if (risks && risks.length > 0) {
      risks.forEach(function (r) {
        var item = document.createElement("div");
        var sev = (r.severity || "low").toLowerCase();
        if (sev !== "high" && sev !== "medium" && sev !== "low") sev = "low";
        item.className = "risk-item sev-" + sev;

        var sevEl = document.createElement("span");
        sevEl.className = "risk-severity";
        sevEl.textContent = sev;
        item.appendChild(sevEl);

        var body = document.createElement("div");
        body.className = "risk-body";
        var textEl = document.createElement("div");
        textEl.className = "risk-text";
        textEl.textContent = r.text || "";
        if (r.category) {
          var chip = document.createElement("span");
          chip.className = "risk-category-chip";
          chip.textContent = r.category;
          textEl.appendChild(chip);
        }
        body.appendChild(textEl);
        if (r.mitigation) {
          var mit = document.createElement("div");
          mit.className = "risk-mitigation";
          mit.textContent = "↳ " + r.mitigation;
          body.appendChild(mit);
        }
        item.appendChild(body);
        rBlock.appendChild(item);
      });
    } else if (hasNewSchema) {
      var noRisk = document.createElement("div");
      noRisk.className = "ai-empty";
      noRisk.textContent = "No risks flagged by AI.";
      rBlock.appendChild(noRisk);
    } else if ((entry.concerns || []).length > 0) {
      /* Backward compat — old entries had "concerns" list */
      entry.concerns.forEach(function (c) {
        var item = document.createElement("div");
        item.className = "risk-item sev-medium";
        var sevEl = document.createElement("span");
        sevEl.className = "risk-severity";
        sevEl.textContent = "legacy";
        item.appendChild(sevEl);
        var body = document.createElement("div");
        body.className = "risk-body";
        var textEl = document.createElement("div");
        textEl.className = "risk-text";
        textEl.textContent = c;
        body.appendChild(textEl);
        item.appendChild(body);
        rBlock.appendChild(item);
      });
    } else {
      var emptyR = document.createElement("div");
      emptyR.className = "ai-empty";
      emptyR.textContent = "No risks yet — click 🤖 Re-evaluate to compute.";
      rBlock.appendChild(emptyR);
    }
    wrap.appendChild(rBlock);

    /* Strengths */
    if (strengths && strengths.length > 0) {
      var sBlock = document.createElement("div");
      sBlock.className = "ai-block";
      var sLabel = document.createElement("div");
      sLabel.className = "ai-block-label";
      sLabel.textContent = "Strengths";
      sBlock.appendChild(sLabel);
      var list = document.createElement("ul");
      list.className = "strength-list";
      strengths.forEach(function (s) {
        var li = document.createElement("li");
        li.className = "strength-item";
        li.textContent = s;
        list.appendChild(li);
      });
      sBlock.appendChild(list);
      wrap.appendChild(sBlock);
    }

    return wrap;
  }

  /* ================================================================
     Private: _showDebugModal(debugData) — full-screen modal with JSON dump
     ================================================================ */
  function _showDebugModal(d) {
    /* Remove any existing modal */
    var existing = document.getElementById("debug-modal");
    if (existing) existing.parentNode.removeChild(existing);

    var overlay = document.createElement("div");
    overlay.id = "debug-modal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;";

    var modal = document.createElement("div");
    modal.style.cssText = "background:var(--surface);border:1px solid var(--border);border-radius:8px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.5);";

    var header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:12px;";
    var title = document.createElement("h3");
    title.style.cssText = "margin:0;font-size:14px;color:var(--text);";
    title.textContent = "🐛 Debug: " + (d.listing_id || "");
    header.appendChild(title);
    var closeBtn = document.createElement("button");
    closeBtn.className = "header-action-btn";
    closeBtn.textContent = "Close ✕";
    closeBtn.addEventListener("click", function () { overlay.parentNode.removeChild(overlay); });
    header.appendChild(closeBtn);
    modal.appendChild(header);

    /* Config status banner */
    var status = document.createElement("div");
    status.style.cssText = "font-size:11px;font-family:var(--font-mono);margin-bottom:12px;padding:8px;background:var(--surface-2);border-radius:4px;";
    var anthText = d.anthropic_key_configured ? "✓ ANTHROPIC_API_KEY set" : "✗ ANTHROPIC_API_KEY missing";
    var orsText = d.ors_key_configured ? "✓ ORS_API_KEY set" : "✗ ORS_API_KEY missing (commute unavailable)";
    status.textContent = anthText + "   |   " + orsText;
    modal.appendChild(status);

    /* Diagnosis banner — smart interpretation of why this listing looks the way it does */
    if (d.diagnosis) {
      var diag = d.diagnosis;
      var severity = diag.severity || "info";
      var colorMap = {
        error: {bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.4)", fg: "var(--red)", icon: "🚫"},
        warn:  {bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.4)", fg: "var(--amber)", icon: "⚠"},
        info:  {bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.4)", fg: "var(--blue)", icon: "ℹ"},
        ok:    {bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.4)", fg: "var(--green)", icon: "✓"}
      };
      var c = colorMap[severity] || colorMap.info;
      var diagBox = document.createElement("div");
      diagBox.style.cssText = "background:" + c.bg + ";border:1px solid " + c.border + ";color:" + c.fg + ";padding:12px 14px;border-radius:6px;margin-bottom:14px;";
      var diagTitle = document.createElement("div");
      diagTitle.style.cssText = "font-weight:600;font-size:13px;margin-bottom:4px;";
      diagTitle.textContent = c.icon + "  " + (diag.title || "");
      diagBox.appendChild(diagTitle);
      var diagDetail = document.createElement("div");
      diagDetail.style.cssText = "font-size:12px;line-height:1.5;";
      diagDetail.textContent = diag.detail || "";
      diagBox.appendChild(diagDetail);
      modal.appendChild(diagBox);
    }

    function _section(label, content, isMono) {
      var sec = document.createElement("div");
      sec.style.marginBottom = "14px";
      var lbl = document.createElement("div");
      lbl.style.cssText = "font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px;font-family:var(--font-mono);";
      lbl.textContent = label;
      sec.appendChild(lbl);
      var pre = document.createElement("pre");
      pre.style.cssText = "background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:10px;font-size:11px;font-family:var(--font-mono);color:var(--text);white-space:pre-wrap;word-break:break-word;margin:0;max-height:280px;overflow-y:auto;";
      pre.textContent = isMono ? content : JSON.stringify(content, null, 2);
      sec.appendChild(pre);
      return sec;
    }

    /* Highlight null/empty fields in normalized listing */
    var normalized = d.normalized_listing || {};
    var missing = Object.keys(normalized).filter(function (k) {
      var v = normalized[k];
      return v === null || v === undefined || v === "";
    });
    if (missing.length) {
      var warn = document.createElement("div");
      warn.style.cssText = "background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.4);color:var(--amber);padding:8px 12px;border-radius:4px;font-size:12px;margin-bottom:12px;";
      warn.textContent = "⚠ Missing/empty fields sent to AI: " + missing.join(", ");
      modal.appendChild(warn);
    }

    modal.appendChild(_section("What Claude sees (listing_summary)", d.listing_summary_sent_to_ai || "", true));
    modal.appendChild(_section("Resolved Listing (after legacy field aliasing)", normalized, false));
    modal.appendChild(_section("Context prefix (calibration anchors)", d.context_prefix || "", true));
    modal.appendChild(_section("Raw stored entry (before normalization)", d.raw_entry || {}, false));
    modal.appendChild(_section("Stored score / verdict", {score: d.stored_score, verdict: d.stored_verdict}, false));

    overlay.appendChild(modal);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.parentNode.removeChild(overlay);
    });
    document.body.appendChild(overlay);
  }

})();

/* ================================================================
   Global: scheduleViewingClick(listingId)
   Reads the datetime-local input, converts to UTC ISO, POSTs to
   /api/entry/{id}/schedule-viewing. (06-RESEARCH § Pitfall 1 fix)
   ================================================================ */
window.scheduleViewingClick = function (listingId) {
  var input = document.getElementById("scheduled-at-input-" + listingId);
  if (!input || !input.value) {
    window.showToast && window.showToast("Pick a date and time first", "error");
    return;
  }
  /* Convert browser local time to UTC ISO (Pitfall 1: datetime-local is TZ-agnostic) */
  var utcIso = new Date(input.value).toISOString();
  var btn = document.getElementById("schedule-viewing-btn-" + listingId);
  if (btn) btn.disabled = true;
  fetch("/api/entry/" + encodeURIComponent(listingId) + "/schedule-viewing", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({scheduled_at: utcIso}),
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        window.loadData && window.loadData();
      } else {
        window.showToast && window.showToast("Failed to schedule viewing", "error");
        if (btn) btn.disabled = false;
      }
    })
    .catch(function () {
      window.showToast && window.showToast("Network error — retry", "error");
      if (btn) btn.disabled = false;
    });
};

/* ================================================================
   Global: markViewedClick(listingId)
   POSTs empty body to /api/entry/{id}/mark-viewed and refreshes UI.
   ================================================================ */
window.markViewedClick = function (listingId) {
  var btn = document.getElementById("mark-viewed-btn-" + listingId);
  if (btn) btn.disabled = true;
  fetch("/api/entry/" + encodeURIComponent(listingId) + "/mark-viewed", {
    method: "POST",
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        window.loadData && window.loadData();
      } else {
        window.showToast && window.showToast("Failed to mark as viewed", "error");
        if (btn) btn.disabled = false;
      }
    })
    .catch(function () {
      window.showToast && window.showToast("Network error — retry", "error");
      if (btn) btn.disabled = false;
    });
};

/* ================================================================
   Global: regenerateBriefClick(listingId, btn)
   POSTs to /api/entry/{id}/regenerate-brief and refreshes UI after ~1500ms
   to give the daemon thread time to save the brief. Client-side debounce via
   the button disable (2s) to prevent runaway Anthropic calls (T-06-09).
   ================================================================ */
window.regenerateBriefClick = function (listingId, btn) {
  fetch("/api/entry/" + encodeURIComponent(listingId) + "/regenerate-brief", {
    method: "POST",
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        window.showToast && window.showToast("Generating…", "ok");
        // Wait ~1500ms for the daemon thread to finish before refreshing
        setTimeout(function () {
          window.loadData && window.loadData();
          if (btn) btn.disabled = false;
        }, 1500);
      } else {
        window.showToast && window.showToast("Regenerate failed", "error");
        if (btn) btn.disabled = false;
      }
    })
    .catch(function () {
      window.showToast && window.showToast("Network error — retry", "error");
      if (btn) btn.disabled = false;
    });
};

/* ================================================================
   Global: refreshKuClick(listingId, btn)
   POSTs to /api/entry/{id}/refresh-ku and refreshes UI after ~1500ms
   to give the daemon thread time to save the KÜ enrichment result.
   (ENRICH-01, D-12 Refresh KÜ button)
   ================================================================ */
window.refreshKuClick = function (listingId, btn) {
  fetch("/api/entry/" + encodeURIComponent(listingId) + "/refresh-ku", {
    method: "POST",
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        window.showToast && window.showToast("KÜ lookup running…", "ok");
        // Wait ~1500ms for the daemon thread to finish before refreshing
        setTimeout(function () {
          window.loadData && window.loadData();
          if (btn) btn.disabled = false;
        }, 1500);
      } else {
        window.showToast && window.showToast("KÜ refresh failed", "error");
        if (btn) btn.disabled = false;
      }
    })
    .catch(function () {
      window.showToast && window.showToast("Network error — retry", "error");
      if (btn) btn.disabled = false;
    });
};

/* ================================================================
   Global: saveKuManualNotes(listingId, notes)
   Persists the ku.manual textarea value via the existing PUT /api/data path.
   Loads current data, patches the matching entry's ku.manual field, then PUTs
   the full dataset back. This reuses the existing data persistence path so no
   new backend endpoint is needed for manual-note editing (RESEARCH.md A1,
   Pitfall 7 — manual notes must survive future Refresh clicks because
   save_ku_enrichment on the backend preserves entry.ku.manual).
   ================================================================ */
window.saveKuManualNotes = function (listingId, notes) {
  fetch("/api/data")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var entry = (data.properties || []).find(function (p) { return p.id === listingId; });
      if (!entry) return;
      if (!entry.ku) entry.ku = {};
      entry.ku.manual = notes;
      return fetch("/api/data", {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data),
      });
    })
    .catch(function () {
      window.showToast && window.showToast("Could not save notes", "error");
    });
};
