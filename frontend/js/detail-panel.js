/*
 * detail-panel.js — Shortlist tab: sidebar funnel (To view / Viewed / Dropped)
 * + main detail pane with hero, after-viewing decision bar, accordion checklist,
 * Ask at the viewing card, and gated Negotiation card.
 *
 * Wave 5C rewrite — design brief v2 section 2b.
 *
 * Exposes: window.renderDetailList(), window.openDetailPanel(listingId)
 *          window.scheduleViewingClick, window.markViewedClick,
 *          window.regenerateBriefClick, window.refreshKuClick,
 *          window.saveKuManualNotes
 *          window.stillInDraftOfferClick, window.thinkingClick,
 *          window.dropClick, window.undoDropClick
 * Calls:   window.loadData
 * Reads:   window.state, window.FULL_CHECKLIST, window.TEXT_ITEM_KEYS,
 *          window.commuteTier, window.fmtEur, window.scoreColor, window.escapeHtml
 *
 * All listing strings use .textContent — no innerHTML with user data (T-05-32).
 */
(function () {
  "use strict";

  /* ── Shortlist funnel status groups (mirrors backend/models.py) ─── */
  var SHORTLIST_TO_VIEW  = ["approved", "viewing_scheduled"];
  var SHORTLIST_VIEWED   = ["viewed", "thinking", "offer_drafted"];
  var SHORTLIST_DROPPED  = ["dropped"];

  /* Hard dealbreakers — kept for legacy signal grid compat */
  var DEALBREAKER_KEYS = new Set([
    "s01_07", "s02_01", "s02_05", "s02_08", "s02_09",
    "s03_04", "s03_05", "s10_01", "s10_03"
  ]);

  /* 5 checklist accordion categories (flags-first order computed at render time) */
  var ACCORDION_CATEGORIES = [
    {label: "Building fund", subtitle: "KÜ, remondifond", sections: ["s03", "s05"]},
    {label: "Risk",          subtitle: "õiguslik, naabrid, müügiajalugu", sections: ["s02", "s08", "s13"]},
    {label: "Finance",       subtitle: "hind, laen, kulud, lisad", sections: ["s01", "s04", "s06", "s07"]},
    {label: "Quality",       subtitle: "tehniline, renoveerimine, kahjurid", sections: ["s09", "s10", "s15", "s11", "s12"]},
    {label: "Location",      subtitle: "asukoht, hinnang", sections: ["s16", "s14"]}
  ];

  var currentListingId = null;
  var currentMiniMap = null;
  var _droppedGroupVisible = false; /* Dropped group toggle state */

  /* ================================================================
     Helpers
     ================================================================ */
  function _inGroup(status, group) {
    return group.indexOf(status) !== -1;
  }

  function _fmtShortDate(isoStr) {
    if (!isoStr) return "";
    try {
      var d = new Date(isoStr);
      var months = ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","dets"];
      return d.getDate() + ". " + months[d.getMonth()];
    } catch (e) { return ""; }
  }

  function _fmtDatetime(isoStr) {
    if (!isoStr) return "";
    try {
      var d = new Date(isoStr);
      var months = ["jan","feb","mar","apr","mai","jun","jul","aug","sep","okt","nov","dets"];
      return d.getDate() + ". " + months[d.getMonth()] + " " +
        String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    } catch (e) { return isoStr; }
  }

  function _daysAgo(isoStr) {
    if (!isoStr) return null;
    try {
      var ms = Date.now() - new Date(isoStr).getTime();
      return Math.max(0, Math.floor(ms / 86400000));
    } catch (e) { return null; }
  }

  /* Resolve checklist status for a given storageKey */
  function _getChecklistStatus(entry, storageKey) {
    var clData = window.state.checklists[entry.id] || {};
    var manual = (clData.manual_checklist || {})[storageKey];
    if (manual) return manual;
    var aiV = (entry.checklist || {})[storageKey];
    if (aiV && typeof aiV === "object") aiV = aiV.result;
    if (aiV === "pass") aiV = "ok";
    if (aiV === "fail") aiV = "issue";
    if (aiV) return aiV;
    return null;
  }

  /* Build sectionMap: sectionId → items[] from FULL_CHECKLIST */
  function _buildSectionMap() {
    var map = {};
    (window.FULL_CHECKLIST || []).forEach(function (sec) {
      map[sec.id] = sec.items || [];
    });
    return map;
  }

  /* Count flag/unknown/ok for a set of ACCORDION_CATEGORIES items */
  function _countCategoryItems(entry, sections, sectionMap) {
    var flags = 0, unknown = 0, ok = 0;
    sections.forEach(function (secId) {
      (sectionMap[secId] || []).forEach(function (it) {
        var sk = it.id.startsWith("ai__") ? it.id.slice(4) : it.id;
        var s = _getChecklistStatus(entry, sk);
        if (s === "issue") flags++;
        else if (s === "ok") ok++;
        else unknown++;
      });
    });
    return {flags: flags, unknown: unknown, ok: ok};
  }

  /* ================================================================
     window.renderDetailList() — populate the Shortlist sidebar funnel
     Wave 5C: 3 groups (To view / Viewed / Dropped) with status labels.
     ================================================================ */
  window.renderDetailList = function () {
    var sidebar = document.getElementById("detail-sidebar");
    if (!sidebar) return;
    while (sidebar.firstChild) sidebar.removeChild(sidebar.firstChild);

    /* Filter input */
    var filterWrap = document.createElement("div");
    filterWrap.className = "detail-sidebar-filter";
    var filterInput = document.createElement("input");
    filterInput.type = "text";
    filterInput.className = "detail-sidebar-input";
    filterInput.id = "sidebar-title-filter";
    filterInput.placeholder = "Filter shortlist…";
    filterInput.setAttribute("autocomplete", "off");
    filterInput.setAttribute("spellcheck", "false");
    if (window._sidebarTitleFilter) filterInput.value = window._sidebarTitleFilter;
    filterInput.addEventListener("input", function () {
      window._sidebarTitleFilter = filterInput.value;
      _renderShortlistGroups(listEl);
    });
    filterWrap.appendChild(filterInput);
    sidebar.appendChild(filterWrap);

    /* Scrollable list */
    var listEl = document.createElement("div");
    listEl.className = "detail-sidebar-list";
    sidebar.appendChild(listEl);

    _renderShortlistGroups(listEl);

    /* Footer */
    var footer = document.createElement("div");
    footer.className = "sl-sidebar-footer";
    footer.textContent = "Inbox decides worth a look. This list decides worth an offer.";
    sidebar.appendChild(footer);
  };

  /* Private: render the three funnel groups */
  function _renderShortlistGroups(listEl) {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

    var titleFilter = (window._sidebarTitleFilter || "").toLowerCase().trim();
    var allEntries = (window.state.properties || []);

    /* Apply title filter */
    var filtered = titleFilter
      ? allEntries.filter(function (e) {
          return (e.title || e.name || e.id || "").toLowerCase().indexOf(titleFilter) !== -1;
        })
      : allEntries;

    /* Partition into 3 groups */
    var toView  = filtered.filter(function (e) { return _inGroup(e.status || "approved", SHORTLIST_TO_VIEW); });
    var viewed  = filtered.filter(function (e) { return _inGroup(e.status, SHORTLIST_VIEWED); });
    var dropped = filtered.filter(function (e) { return _inGroup(e.status, SHORTLIST_DROPPED); });

    /* Sort each group by score desc */
    function byScore(a, b) { return (b.score || 0) - (a.score || 0); }
    toView.sort(byScore);
    viewed.sort(byScore);
    dropped.sort(byScore);

    if (toView.length === 0 && viewed.length === 0 && dropped.length === 0) {
      var empty = document.createElement("div");
      empty.style.cssText = "padding:20px;font-size:12px;color:var(--color-text-muted);text-align:center;";
      empty.textContent = "No listings in Shortlist yet — approve from Inbox";
      listEl.appendChild(empty);
      return;
    }

    /* ---- To view group ---- */
    _renderGroup(listEl, "To view", toView, "to-view", function (e) {
      return _buildToViewIndicator(e);
    }, false);

    /* ---- Viewed group ---- */
    _renderGroup(listEl, "Viewed", viewed, "viewed", function (e) {
      return _buildViewedIndicator(e);
    }, false);

    /* ---- Dropped group (collapsed by default) ---- */
    _renderDroppedGroup(listEl, dropped);

    /* Restore selection highlight */
    if (currentListingId) {
      var si = listEl.querySelector('[data-id="' + currentListingId + '"]');
      if (si) {
        si.classList.add("active");
        si.scrollIntoView({block: "nearest"});
      }
    }
  }

  function _renderGroup(listEl, label, entries, groupKey, indicatorFn, startsCollapsed) {
    if (entries.length === 0) return;

    /* Group header */
    var hdr = document.createElement("div");
    hdr.className = "sl-group-header";

    var labelEl = document.createElement("span");
    labelEl.className = "sl-group-label";
    labelEl.textContent = label + " · ";
    hdr.appendChild(labelEl);

    var countEl = document.createElement("span");
    countEl.className = "sl-group-count";
    countEl.textContent = String(entries.length);
    hdr.appendChild(countEl);

    listEl.appendChild(hdr);

    /* Rows */
    entries.forEach(function (entry) {
      var row = _buildSidebarRow(entry, indicatorFn(entry));
      listEl.appendChild(row);
    });
  }

  function _renderDroppedGroup(listEl, entries) {
    /* Header with toggle */
    var hdr = document.createElement("div");
    hdr.className = "sl-group-header";

    var leftPart = document.createElement("span");
    leftPart.style.cssText = "flex:1;display:flex;gap:4px;align-items:center;";

    var labelEl = document.createElement("span");
    labelEl.className = "sl-group-label";
    labelEl.textContent = "Dropped · ";
    leftPart.appendChild(labelEl);

    var countEl = document.createElement("span");
    countEl.className = "sl-group-count";
    countEl.textContent = String(entries.length);
    leftPart.appendChild(countEl);

    hdr.appendChild(leftPart);

    /* Toggle link */
    var toggleLink = document.createElement("button");
    toggleLink.type = "button";
    toggleLink.className = "sl-dropped-toggle";
    toggleLink.textContent = _droppedGroupVisible ? "hide" : "show";
    hdr.appendChild(toggleLink);

    listEl.appendChild(hdr);

    /* Body (conditionally visible) */
    var body = document.createElement("div");
    body.className = "sl-dropped-body";
    body.style.display = _droppedGroupVisible ? "block" : "none";

    if (entries.length > 0) {
      entries.forEach(function (entry) {
        var indicator = _buildDroppedIndicator(entry);
        var row = _buildSidebarRow(entry, indicator, true /* strikethrough */);
        body.appendChild(row);
      });
    }
    listEl.appendChild(body);

    toggleLink.addEventListener("click", function () {
      _droppedGroupVisible = !_droppedGroupVisible;
      body.style.display = _droppedGroupVisible ? "block" : "none";
      toggleLink.textContent = _droppedGroupVisible ? "hide" : "show";
    });
  }

  /* Build right-side indicator for To view group */
  function _buildToViewIndicator(entry) {
    var el = document.createElement("span");
    el.className = "sl-row-indicator";
    if (entry.scheduled_at) {
      el.style.color = "#93aee0";
      el.textContent = _fmtShortDate(entry.scheduled_at);
    } else {
      el.style.color = "var(--color-text-muted)";
      el.textContent = "unbooked";
    }
    return el;
  }

  /* Build right-side indicator for Viewed group */
  function _buildViewedIndicator(entry) {
    var el = document.createElement("span");
    el.className = "sl-row-indicator";
    var status = entry.status || "viewed";
    if (status === "thinking") {
      el.style.color = "var(--color-text-muted)";
      el.textContent = "thinking";
    } else if (status === "offer_drafted") {
      el.style.cssText = "font-weight:500;color:#6fc9a3;";
      el.textContent = "offer";
    }
    /* viewed with no sub-status: no label (or soft "viewed" label) */
    return el;
  }

  /* Build right-side indicator for Dropped group */
  function _buildDroppedIndicator(entry) {
    var el = document.createElement("span");
    el.className = "sl-row-indicator";
    el.style.color = "var(--color-text-muted)";
    /* Try to get drop reason from viewing_history */
    var history = entry.viewing_history || [];
    var dropEvent = null;
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].action === "decision" && history[i].decision === "drop") {
        dropEvent = history[i]; break;
      }
    }
    if (dropEvent && dropEvent.drop_reason) {
      el.textContent = dropEvent.drop_reason;
    }
    return el;
  }

  /* Build a sidebar row */
  function _buildSidebarRow(entry, indicatorEl, isDropped) {
    var scoreColor = window.scoreColor(entry.score || 0);

    var row = document.createElement("div");
    row.className = "sidebar-item";
    row.dataset.id = entry.id;
    row.style.setProperty("--rule-color", scoreColor);
    if (isDropped) {
      row.style.opacity = "0.4";
    }

    /* Score numeral */
    var scoreEl = document.createElement("span");
    scoreEl.className = "si-score";
    scoreEl.style.color = scoreColor;
    scoreEl.textContent = entry.score != null ? String(entry.score) : "?";
    row.appendChild(scoreEl);

    /* Title + meta */
    var info = document.createElement("div");
    info.className = "si-info";

    var title = document.createElement("div");
    title.className = "si-title";
    if (isDropped) title.style.textDecoration = "line-through";
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

    row.appendChild(info);

    /* Right indicator */
    if (indicatorEl) row.appendChild(indicatorEl);

    row.addEventListener("click", function () {
      window.openDetailPanel(entry.id);
    });

    return row;
  }

  /* ================================================================
     window.openDetailPanel(listingId) — highlight sidebar + render main pane
     ================================================================ */
  window.openDetailPanel = function (listingId) {
    var sidebar = document.getElementById("detail-sidebar");
    if (!sidebar || !sidebar.querySelector(".sidebar-item")) {
      window.renderDetailList();
      sidebar = document.getElementById("detail-sidebar");
    }

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
     Private: _renderMainPane(listingId) — Wave 5C main pane layout
     1. Hero row
     2. After-viewing decision bar (conditional)
     3. Content row: accordion checklist (left) + ask/neg (right)
     ================================================================ */
  function _renderMainPane(listingId) {
    var main = document.getElementById("detail-main");
    if (!main) return;

    if (currentMiniMap) {
      try { currentMiniMap.remove(); } catch (e) {}
      currentMiniMap = null;
    }

    while (main.firstChild) main.removeChild(main.firstChild);
    currentListingId = listingId;

    /* Resolve entry from properties only (shortlist = approved+) */
    var entry = null;
    var allEntries = (window.state.properties || []);
    for (var i = 0; i < allEntries.length; i++) {
      if (allEntries[i].id === listingId) { entry = allEntries[i]; break; }
    }

    if (!entry) {
      /* Fallback: check pending (listing may not be approved yet) */
      var pending = (window.state.pending || []);
      for (var pi = 0; pi < pending.length; pi++) {
        if (pending[pi].id === listingId) { entry = pending[pi]; break; }
      }
      if (!entry) {
        var notFound = document.createElement("div");
        notFound.className = "empty-state";
        var msg = document.createElement("div");
        msg.className = "big";
        msg.textContent = "Select a listing";
        notFound.appendChild(msg);
        var sub = document.createElement("div");
        sub.style.cssText = "margin-top:8px;font-size:13px;color:var(--color-text-muted);";
        sub.textContent = "This listing is still in Inbox — approve it first.";
        notFound.appendChild(sub);
        main.appendChild(notFound);
        return;
      }
    }

    var status = entry.status || "approved";
    var scoreColor = window.scoreColor(entry.score || 0);

    /* [1] Hero row */
    main.appendChild(_buildHeroRow(entry, status, scoreColor));

    /* [2] After-viewing decision bar */
    main.appendChild(_buildDecisionBar(entry, status));

    /* [3] Content row */
    var contentRow = document.createElement("div");
    contentRow.className = "dm-content-row";

    /* Left col: accordion checklist */
    var leftCol = document.createElement("div");
    leftCol.className = "dm-left-col";
    leftCol.appendChild(_buildAccordionChecklist(entry));

    /* Utility buttons */
    leftCol.appendChild(_buildUtilityButtons(entry));

    contentRow.appendChild(leftCol);

    /* Right col: Ask at the viewing + gated Negotiation */
    var rightCol = document.createElement("div");
    rightCol.className = "dm-right-col";

    rightCol.appendChild(_buildAskAtViewingCard(entry));
    rightCol.appendChild(_buildNocturneNegCard(entry, status));

    /* KU section */
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
  }

  /* ================================================================
     Private: _buildHeroRow — photo + header block (Wave 5C)
     Status pill on LEFT, shortlisted-N-days-ago, kv.ee on right.
     Mark viewed button for viewing_scheduled only.
     ================================================================ */
  function _buildHeroRow(entry, status, scoreColor) {
    var heroRow = document.createElement("div");
    heroRow.className = "dm-hero-row";

    /* Photo card */
    var photoCard = document.createElement("div");
    photoCard.className = "dm-photo-card";

    var imgUrl = entry.image_url || entry.imageUrl || "";
    if (imgUrl && (imgUrl.startsWith("http://") || imgUrl.startsWith("https://"))) {
      var img = document.createElement("img");
      img.src = imgUrl;
      img.alt = entry.title || "";
      img.loading = "lazy";
      img.addEventListener("error", function () { img.style.display = "none"; });
      photoCard.appendChild(img);
    } else {
      var ph = document.createElement("span");
      ph.textContent = "photo";
      photoCard.appendChild(ph);
    }

    /* Photo count overlay */
    var photoCount = entry.image_count || entry.imageCount || 0;
    if (photoCount > 0) {
      var dotsWrap = document.createElement("div");
      dotsWrap.className = "dm-photo-dots";
      var dotCount = Math.min(photoCount > 1 ? 3 : 1, 5);
      for (var di = 0; di < dotCount; di++) {
        var dot = document.createElement("span");
        dot.className = "dm-photo-dot" + (di === 0 ? " active" : "");
        dotsWrap.appendChild(dot);
      }
      photoCard.appendChild(dotsWrap);
    }

    heroRow.appendChild(photoCard);

    /* Header block */
    var hdrBlock = document.createElement("div");
    hdrBlock.className = "dm-header-block";

    /* Top row: status pill (LEFT) + shortlisted meta + kv.ee (RIGHT) */
    var topRow = document.createElement("div");
    topRow.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;gap:12px;";

    var leftSide = document.createElement("div");
    leftSide.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;";

    /* Status pill */
    var pill = _buildStatusPill(entry, status);
    leftSide.appendChild(pill);

    /* Shortlisted N days ago */
    var days = _daysAgo(entry.created_at || entry.queued_at);
    if (days !== null) {
      var daysEl = document.createElement("span");
      daysEl.style.cssText = "font:400 11px Inter,system-ui,sans-serif;color:var(--color-text-muted);";
      daysEl.textContent = days === 0 ? "shortlisted today" : "shortlisted " + days + "d ago";
      leftSide.appendChild(daysEl);
    }

    topRow.appendChild(leftSide);

    /* Right: kv.ee link + Mark viewed (for viewing_scheduled) */
    var rightActions = document.createElement("div");
    rightActions.className = "dm-action-row";

    if (status === "viewing_scheduled") {
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
      rightActions.appendChild(markViewedBtn);
    }

    if (status === "approved") {
      /* Schedule viewing button + inline picker */
      var scheduleBtn = document.createElement("button");
      scheduleBtn.type = "button";
      scheduleBtn.className = "btn btn-secondary";
      scheduleBtn.id = "schedule-viewing-btn-" + entry.id;
      scheduleBtn.textContent = "Schedule viewing";

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
      rightActions.appendChild(scheduleBtnWrap);
    }

    var entryUrl = entry.url || "";
    if (entryUrl.startsWith("http://") || entryUrl.startsWith("https://")) {
      var kvLink = document.createElement("a");
      kvLink.href = entryUrl;
      kvLink.target = "_blank";
      kvLink.rel = "noopener noreferrer";
      kvLink.className = "btn btn-secondary";
      kvLink.style.textDecoration = "none";
      kvLink.textContent = "kv.ee ↗";
      rightActions.appendChild(kvLink);
    }

    topRow.appendChild(rightActions);
    hdrBlock.appendChild(topRow);

    /* Title */
    var titleEl = document.createElement("div");
    titleEl.className = "dm-title";
    titleEl.textContent = entry.title || entry.name || entry.id || "";
    hdrBlock.appendChild(titleEl);

    /* Meta line */
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

    var price = entry.price_eur || entry.price || 0;
    var pricePerSqm = entry.price_per_sqm || entry.pricePerSqm;
    var priceMetaParts = [];
    if (pricePerSqm) priceMetaParts.push(Math.round(pricePerSqm) + " €/m²");
    strip.appendChild(_metricCell(price ? window.fmtEur(price) : "—", priceMetaParts.join(" · ") || "asking price", null));

    var areaMeta = entry.area_sqm ? "m²" : "";
    if (entry.rooms) areaMeta += (areaMeta ? " · " : "") + entry.rooms + " tuba";
    strip.appendChild(_metricCell(entry.area_sqm ? entry.area_sqm : "—", areaMeta || "area", null));

    var allScored = (window.state.properties || []).filter(function (e) { return e.score != null; });
    allScored.sort(function (a, b) { return b.score - a.score; });
    var rank = allScored.findIndex(function (e) { return e.id === entry.id; });
    var rankPct = allScored.length > 0 && rank >= 0 ? Math.round((rank / allScored.length) * 100) : null;
    var scoreMeta = "score" + (rankPct !== null ? " · top " + Math.max(1, rankPct) + "%" : "");
    strip.appendChild(_metricCell(entry.score != null ? String(entry.score) : "—", scoreMeta, scoreColor));

    var coo = entry.cost_of_ownership;
    var monthlyTotal = coo ? coo.monthly_total_eur : null;
    strip.appendChild(_metricCell(monthlyTotal ? window.fmtEur(monthlyTotal) : "—", "monthly, all-in", null));

    hdrBlock.appendChild(strip);
    heroRow.appendChild(hdrBlock);

    return heroRow;
  }

  /* Build status pill for the hero top-left */
  function _buildStatusPill(entry, status) {
    var pill = document.createElement("span");
    pill.className = "tag";

    if (status === "viewing_scheduled" && entry.scheduled_at) {
      pill.className += " tag-viewing";
      var dateSpan = document.createElement("span");
      dateSpan.style.fontFamily = "'JetBrains Mono',ui-monospace,monospace";
      dateSpan.textContent = "viewing " + _fmtDatetime(entry.scheduled_at);
      pill.appendChild(dateSpan);
    } else if (_inGroup(status, SHORTLIST_VIEWED)) {
      pill.className += " tag-viewed";
      var viewedText = document.createElement("span");
      viewedText.textContent = entry.scheduled_at ? "viewed " + _fmtShortDate(entry.scheduled_at) : "viewed";
      pill.appendChild(viewedText);
    } else if (status === "dropped") {
      pill.className += " tag-rejected";
      pill.textContent = "dropped";
    } else {
      /* approved */
      pill.className += " tag-approved";
      pill.textContent = "approved";
    }
    return pill;
  }

  /* ================================================================
     Private: _buildDecisionBar — after-viewing decision bar
     Shown ONLY when status is viewed | thinking | offer_drafted.
     Shows "Undo drop" ghost button when dropped.
     ================================================================ */
  function _buildDecisionBar(entry, status) {
    var bar = document.createElement("div");
    bar.className = "sl-decision-bar";

    if (status === "dropped") {
      /* Undo drop */
      bar.style.cssText = "flex:none;margin:14px 20px 0;padding:10px 16px;border-radius:var(--radius-md);background:var(--color-sunken);box-shadow:inset 0 0 0 1px var(--color-hairline);display:flex;align-items:center;gap:12px;";
      var undoKicker = document.createElement("span");
      undoKicker.style.cssText = "font:600 9.5px Inter,system-ui,sans-serif;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-text-muted);flex:1;";
      undoKicker.textContent = "Dropped";
      bar.appendChild(undoKicker);
      var undoBtn = document.createElement("button");
      undoBtn.type = "button";
      undoBtn.className = "btn btn-secondary";
      undoBtn.textContent = "Undo drop";
      undoBtn.addEventListener("click", function () {
        window.undoDropClick(entry.id);
      });
      bar.appendChild(undoBtn);
      return bar;
    }

    if (!_inGroup(status, SHORTLIST_VIEWED)) {
      /* Not yet viewed — hide the bar entirely (zero height) */
      bar.style.display = "none";
      return bar;
    }

    /* After the viewing — 3-button decision bar */
    bar.style.cssText = "flex:none;margin:14px 20px 0;padding:12px 16px;border-radius:var(--radius-md);background:var(--color-sunken);box-shadow:inset 0 0 0 1px rgba(145,132,217,.3);display:flex;align-items:center;gap:14px;";

    var kicker = document.createElement("span");
    kicker.style.cssText = "font:600 9.5px Inter,system-ui,sans-serif;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-text-muted);white-space:nowrap;";
    kicker.textContent = "After the viewing";
    bar.appendChild(kicker);

    var btnGroup = document.createElement("div");
    btnGroup.style.cssText = "display:flex;gap:8px;align-items:center;";

    var stillInBtn = document.createElement("button");
    stillInBtn.type = "button";
    stillInBtn.className = "btn btn-primary";
    stillInBtn.style.cssText = "border:1px solid var(--color-accent);color:var(--color-accent-400);background:transparent;";
    if (status === "offer_drafted") {
      stillInBtn.style.background = "var(--color-accent-tint)";
    }
    stillInBtn.textContent = "Still in — draft offer";
    stillInBtn.addEventListener("click", function () {
      window.stillInDraftOfferClick(entry.id);
    });
    btnGroup.appendChild(stillInBtn);

    var thinkingBtn = document.createElement("button");
    thinkingBtn.type = "button";
    thinkingBtn.className = "btn btn-secondary";
    if (status === "thinking") {
      thinkingBtn.style.boxShadow = "inset 0 0 0 1px var(--color-accent)";
    }
    thinkingBtn.textContent = "Thinking";
    thinkingBtn.addEventListener("click", function () {
      window.thinkingClick(entry.id);
    });
    btnGroup.appendChild(thinkingBtn);

    var dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "btn btn-secondary";
    dropBtn.style.borderColor = "rgba(196,99,95,0.4)";
    dropBtn.textContent = "Drop";
    dropBtn.addEventListener("click", function () {
      window.dropClick(entry.id, dropBtn);
    });
    btnGroup.appendChild(dropBtn);

    bar.appendChild(btnGroup);

    var tagline = document.createElement("span");
    tagline.style.cssText = "font:400 11.5px Inter,system-ui,sans-serif;color:var(--color-text-muted);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;";
    tagline.textContent = "The one decision the AI can’t make for you — it’s why the list stays short.";
    bar.appendChild(tagline);

    return bar;
  }

  /* ================================================================
     Private: _buildAccordionChecklist — Wave 5C option A accordion
     5 categories, flags-first ordering, flagged/warning groups expanded by default.
     ================================================================ */
  function _buildAccordionChecklist(entry) {
    var sectionMap = _buildSectionMap();

    /* Compute stats for each category */
    var categoryStats = ACCORDION_CATEGORIES.map(function (cat) {
      var counts = _countCategoryItems(entry, cat.sections, sectionMap);
      return {cat: cat, counts: counts};
    });

    /* Sort: flagged first, then warning-heavy, then ok-heavy */
    categoryStats.sort(function (a, b) {
      if (a.counts.flags !== b.counts.flags) return b.counts.flags - a.counts.flags;
      if (a.counts.unknown !== b.counts.unknown) return b.counts.unknown - a.counts.unknown;
      return b.counts.ok - a.counts.ok;
    });

    /* Total counts */
    var totalFlags = 0, totalUnknown = 0, totalOk = 0;
    categoryStats.forEach(function (cs) {
      totalFlags += cs.counts.flags;
      totalUnknown += cs.counts.unknown;
      totalOk += cs.counts.ok;
    });

    /* Card */
    var card = document.createElement("div");
    card.className = "dm-checklist-card";

    /* Header */
    var head = document.createElement("div");
    head.className = "dm-checklist-head";
    var headTitle = document.createElement("span");
    headTitle.className = "dm-checklist-title";
    headTitle.textContent = "Checklist";
    head.appendChild(headTitle);

    var headStats = document.createElement("span");
    headStats.style.cssText = "font:400 11.5px Inter,system-ui,sans-serif;color:var(--color-text-muted);";
    var statParts = [];
    if (totalFlags > 0) statParts.push(totalFlags + " flag");
    if (totalUnknown > 0) statParts.push(totalUnknown + " unknown");
    if (totalOk > 0) statParts.push(totalOk + " ok");
    headStats.textContent = statParts.join(" · ");
    head.appendChild(headStats);

    card.appendChild(head);

    /* Category accordion groups */
    categoryStats.forEach(function (cs, idx) {
      var cat = cs.cat;
      var counts = cs.counts;
      var hasFlag = counts.flags > 0;
      var hasWarning = counts.unknown > 0;

      /* Group border color */
      var borderColor = hasFlag ? "var(--score-0)" : (hasWarning ? "var(--score-40)" : "var(--score-85)");

      /* Group header */
      var groupHdr = document.createElement("div");
      groupHdr.className = "sl-acc-header";
      groupHdr.style.boxShadow = "inset 2px 0 0 " + borderColor;

      var hdrLeft = document.createElement("div");
      hdrLeft.style.cssText = "flex:1;min-width:0;";

      var catName = document.createElement("span");
      catName.style.cssText = "font:500 13px Inter,system-ui,sans-serif;color:var(--color-text);";
      catName.textContent = cat.label;
      hdrLeft.appendChild(catName);

      var catSub = document.createElement("span");
      catSub.style.cssText = "font:400 11px Inter,system-ui,sans-serif;color:var(--color-text-muted);margin-left:8px;";
      catSub.textContent = cat.subtitle;
      hdrLeft.appendChild(catSub);

      groupHdr.appendChild(hdrLeft);

      /* Signal strip: one 7×7px square per item, coloured by status.
       * SPEC §2.5: ok = --s-best, unknown = --faint, flag/warning = --s-bad/--s-weak.
       * Inserted between the group label block and the count text. */
      var stripEl = document.createElement("div");
      stripEl.style.cssText = "display:flex;flex-wrap:wrap;gap:2px;align-items:center;margin:0 10px;flex-shrink:0;max-width:120px;";
      cat.sections.forEach(function (secId) {
        (sectionMap[secId] || []).forEach(function (it) {
          var sk = it.id.startsWith("ai__") ? it.id.slice(4) : it.id;
          var s = _getChecklistStatus(entry, sk);
          var sq = document.createElement("span");
          sq.style.cssText = "display:inline-block;width:7px;height:7px;border-radius:2px;flex-shrink:0;";
          if (s === "ok") {
            sq.style.background = "var(--score-85)"; /* --s-best */
          } else if (s === "issue") {
            sq.style.background = "var(--score-0)";  /* --s-bad */
          } else if (s === "warning") {
            sq.style.background = "var(--score-40)"; /* --s-weak */
          } else {
            sq.style.background = "var(--color-neutral-700)"; /* --faint */
          }
          stripEl.appendChild(sq);
        });
      });
      groupHdr.appendChild(stripEl);

      /* Status count */
      var statusCount = document.createElement("span");
      statusCount.style.cssText = "font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;color:var(--color-text-muted);margin-right:12px;flex-shrink:0;";
      if (hasFlag) {
        statusCount.style.color = "var(--score-0)";
        statusCount.textContent = counts.flags + " flag";
      } else if (counts.unknown > 0) {
        statusCount.textContent = counts.unknown + " unknown";
      } else {
        statusCount.style.color = "var(--score-85)";
        statusCount.textContent = counts.ok + " ok";
      }
      groupHdr.appendChild(statusCount);

      /* Chevron */
      var chevron = document.createElement("span");
      chevron.style.cssText = "color:var(--color-text-muted);font-size:11px;flex-shrink:0;";

      /* Default: expand first group (the one with flags or idx 0) */
      var startExpanded = idx === 0 || hasFlag;
      chevron.textContent = startExpanded ? "▾" : "▸";

      groupHdr.appendChild(chevron);

      /* Group body */
      var groupBody = document.createElement("div");
      groupBody.className = "sl-acc-body";
      groupBody.style.display = startExpanded ? "flex" : "none";

      /* Collect all items for this category */
      cat.sections.forEach(function (secId) {
        (sectionMap[secId] || []).forEach(function (it) {
          var sk = it.id.startsWith("ai__") ? it.id.slice(4) : it.id;
          var s = _getChecklistStatus(entry, sk);

          var itemRow = document.createElement("div");
          itemRow.style.cssText = "display:flex;gap:9px;align-items:baseline;padding:3px 0;";

          /* Status glyph */
          var glyph = document.createElement("span");
          glyph.style.cssText = "width:12px;flex-shrink:0;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10px;text-align:center;";
          if (s === "ok") {
            glyph.textContent = "✓";
            glyph.style.color = "var(--score-85)";
          } else if (s === "issue") {
            glyph.textContent = "✕";
            glyph.style.color = "var(--score-0)";
          } else if (s === "warning") {
            glyph.textContent = "!";
            glyph.style.color = "var(--score-40)";
          } else {
            glyph.textContent = "?";
            glyph.style.color = "var(--color-text-muted)";
          }
          itemRow.appendChild(glyph);

          /* Label */
          var label = document.createElement("span");
          label.style.cssText = "font:400 13px/1.4 Inter,system-ui,sans-serif;color:" +
            (s === "issue" ? "var(--color-text)" : "var(--color-text-secondary)") + ";flex:1;";
          label.textContent = it.text;
          itemRow.appendChild(label);

          /* Score deduction for flagged items */
          if (s === "issue") {
            var deductEl = document.createElement("span");
            deductEl.style.cssText = "font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;color:var(--color-text-muted);flex-shrink:0;";
            /* Try to get score deduction from ai_checklist_fills or entry data */
            var aiFill = (entry.ai_checklist_fills || {})[sk];
            if (aiFill && typeof aiFill === "string" && aiFill.match(/\d+\s*(pts?|point)/i)) {
              deductEl.textContent = aiFill.match(/[-−]?\d+/)[0] + " pts";
            }
            itemRow.appendChild(deductEl);
          }

          groupBody.appendChild(itemRow);
        });
      });

      /* Toggle */
      groupHdr.addEventListener("click", function () {
        var open = groupBody.style.display !== "none";
        groupBody.style.display = open ? "none" : "flex";
        chevron.textContent = open ? "▸" : "▾";
      });

      card.appendChild(groupHdr);
      card.appendChild(groupBody);
    });

    /* Footer */
    var foot = document.createElement("div");
    foot.className = "dm-checklist-foot";
    foot.textContent = (totalFlags + totalUnknown + totalOk) + " items · the " + totalUnknown + " unknowns become your viewing questions";
    card.appendChild(foot);

    return card;
  }

  /* ================================================================
     Private: _buildAskAtViewingCard — unknown checklist items as checkboxes
     ================================================================ */
  function _buildAskAtViewingCard(entry) {
    var card = document.createElement("div");
    card.className = "dm-coo-card"; /* reuse card styles */
    card.style.flexShrink = "0";

    /* Header */
    var head = document.createElement("div");
    head.className = "dm-coo-head";
    var kicker = document.createElement("span");
    kicker.className = "dm-coo-kicker";
    kicker.textContent = "Ask at the viewing";
    head.appendChild(kicker);
    card.appendChild(head);

    /* Collect unknown items */
    var sectionMap = _buildSectionMap();
    var unknownItems = [];

    ACCORDION_CATEGORIES.forEach(function (cat) {
      cat.sections.forEach(function (secId) {
        (sectionMap[secId] || []).forEach(function (it) {
          var sk = it.id.startsWith("ai__") ? it.id.slice(4) : it.id;
          var s = _getChecklistStatus(entry, sk);
          if (!s || s === "unknown") {
            unknownItems.push(it);
          }
        });
      });
    });

    if (unknownItems.length === 0) {
      var noneEl = document.createElement("div");
      noneEl.style.cssText = "font:400 13px Inter,system-ui,sans-serif;color:var(--color-text-muted);margin-top:10px;font-style:italic;";
      noneEl.textContent = "No open questions — you have everything you need.";
      card.appendChild(noneEl);
      return card;
    }

    var listWrap = document.createElement("div");
    listWrap.style.cssText = "margin-top:10px;display:flex;flex-direction:column;gap:7px;max-height:220px;overflow-y:auto;";

    /* Max 6 visible, rest scroll */
    unknownItems.slice(0, 20).forEach(function (it) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:9px;align-items:baseline;";

      /* Checkbox */
      var cb = document.createElement("span");
      cb.style.cssText = "flex-shrink:0;width:11px;height:11px;border-radius:2px;border:1px solid var(--color-text-muted);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:9px;background:transparent;color:transparent;transition:background 80ms,color 80ms;";
      cb.setAttribute("role", "checkbox");
      cb.setAttribute("aria-checked", "false");

      cb.addEventListener("click", function () {
        var checked = cb.getAttribute("aria-checked") === "true";
        if (checked) {
          cb.setAttribute("aria-checked", "false");
          cb.style.background = "transparent";
          cb.style.color = "transparent";
          cb.style.borderColor = "var(--color-text-muted)";
          cb.textContent = "";
        } else {
          cb.setAttribute("aria-checked", "true");
          cb.style.background = "var(--color-accent)";
          cb.style.color = "#fff";
          cb.style.borderColor = "var(--color-accent)";
          cb.textContent = "✓";
        }
      });
      row.appendChild(cb);

      var qText = document.createElement("span");
      qText.style.cssText = "font:400 13px/1.4 Inter,system-ui,sans-serif;color:var(--color-text-secondary);flex:1;";
      qText.textContent = it.text;
      row.appendChild(qText);

      listWrap.appendChild(row);
    });

    card.appendChild(listWrap);
    return card;
  }

  /* ================================================================
     Private: _buildNocturneNegCard — Negotiation card, gated until viewed
     ================================================================ */
  function _buildNocturneNegCard(entry, status) {
    var card = document.createElement("div");
    card.className = "dm-neg-card";

    var isGated = _inGroup(status, SHORTLIST_TO_VIEW);
    if (isGated) {
      card.style.opacity = "0.45";
      card.style.pointerEvents = "none";
    }

    var brief = entry.negotiation_brief || {};

    /* Header */
    var head = document.createElement("div");
    head.className = "dm-neg-head";
    var kicker = document.createElement("span");
    kicker.className = "dm-neg-kicker";
    kicker.textContent = "Negotiation";
    head.appendChild(kicker);

    if (isGated) {
      var gateNote = document.createElement("span");
      gateNote.style.cssText = "font:400 11px Inter,system-ui,sans-serif;color:var(--color-text-muted);";
      gateNote.textContent = "unlocks after viewing";
      head.appendChild(gateNote);
    } else {
      var regenBtn = document.createElement("button");
      regenBtn.type = "button";
      regenBtn.className = "dm-neg-regen";
      regenBtn.textContent = "regenerate";
      regenBtn.addEventListener("click", function () {
        regenBtn.disabled = true;
        window.regenerateBriefClick && window.regenerateBriefClick(entry.id, regenBtn);
      });
      head.appendChild(regenBtn);
    }
    card.appendChild(head);

    /* needs_review warning */
    if (brief.needs_review === true) {
      var badge = document.createElement("div");
      badge.style.cssText = "font-size:11px;color:var(--score-40);margin-top:6px;";
      badge.textContent = "Numbers may need review";
      card.appendChild(badge);
    }

    /* Offer range */
    var low = brief.suggested_offer_low_eur;
    var high = brief.suggested_offer_high_eur;
    if (low || high) {
      var offerRow = document.createElement("div");
      offerRow.className = "dm-neg-offer-row";
      var offerEl = document.createElement("span");
      offerEl.className = "dm-neg-offer";
      function _kFmt(n) {
        if (!n) return "—";
        return Math.round(n / 1000) + "k";
      }
      offerEl.textContent = (low ? _kFmt(low) : "—") + (high ? "–" + _kFmt(high) : "");
      offerRow.appendChild(offerEl);
      var askPrice = entry.price_eur || entry.price;
      var meta = document.createElement("span");
      meta.className = "dm-neg-offer-meta";
      meta.textContent = "target" + (askPrice ? " · ask " + _kFmt(askPrice) : "");
      offerRow.appendChild(meta);
      card.appendChild(offerRow);

      if (askPrice && low && high) {
        var progressBar = document.createElement("div");
        progressBar.className = "dm-neg-progress";
        var scaleMin = askPrice * 0.70;
        var scaleMax = askPrice;
        var span = scaleMax - scaleMin;
        var leftPct = ((low - scaleMin) / span) * 100;
        var widthPct = ((high - low) / span) * 100;
        leftPct = Math.max(0, Math.min(95, leftPct));
        widthPct = Math.max(2, Math.min(95 - leftPct, widthPct));
        var fill = document.createElement("div");
        fill.className = "dm-neg-progress-fill";
        fill.style.left = leftPct.toFixed(1) + "%";
        fill.style.width = widthPct.toFixed(1) + "%";
        progressBar.appendChild(fill);
        var askMark = document.createElement("div");
        askMark.className = "dm-neg-progress-ask";
        askMark.style.left = "98%";
        progressBar.appendChild(askMark);
        card.appendChild(progressBar);
      }
    } else if (!brief.brief_ru) {
      var emptyMsg = document.createElement("div");
      emptyMsg.style.cssText = "color:var(--color-text-muted);font-size:12px;margin-top:10px;";
      emptyMsg.textContent = isGated ? "Complete the viewing to unlock negotiation brief." : "No brief yet — click regenerate.";
      card.appendChild(emptyMsg);
    }

    if (brief.brief_ru) {
      var body = document.createElement("div");
      body.className = "dm-neg-body";
      body.textContent = brief.brief_ru;
      card.appendChild(body);
    } else if (brief.error) {
      var errEl = document.createElement("div");
      errEl.style.cssText = "color:var(--score-0);font-size:12px;margin-top:10px;";
      errEl.textContent = brief.error;
      card.appendChild(errEl);
    }

    /* Actions */
    var actions = document.createElement("div");
    actions.className = "dm-neg-actions";

    if (!isGated) {
      var draftBtn = document.createElement("button");
      draftBtn.type = "button";
      draftBtn.className = "btn btn-primary";
      draftBtn.style.fontSize = "12px";
      draftBtn.textContent = "Draft broker email";
      var draftStatus = document.createElement("span");
      draftStatus.style.cssText = "font-size:11px;color:var(--color-text-muted);";
      draftBtn.addEventListener("click", function () {
        draftBtn.disabled = true;
        fetch("/api/draft/" + encodeURIComponent(entry.id), {method: "POST"})
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.ok) {
              draftStatus.textContent = "Draft created — check Gmail Drafts";
              window.showToast && window.showToast("Draft created", "ok");
            } else {
              draftStatus.textContent = d.reason === "no_email" ? "No agent email" : "Failed — retry";
              draftBtn.disabled = false;
            }
          }).catch(function () {
            draftStatus.textContent = "Failed — retry";
            draftBtn.disabled = false;
          });
      });
      actions.appendChild(draftBtn);
      actions.appendChild(draftStatus);
    }

    var kuBtn = document.createElement("button");
    kuBtn.type = "button";
    kuBtn.className = "btn btn-secondary";
    kuBtn.style.fontSize = "12px";
    if (isGated) kuBtn.style.pointerEvents = "none";
    kuBtn.textContent = "KÜ · price history";
    kuBtn.addEventListener("click", function () {
      var kuCard = document.querySelector(".dm-ku-section");
      if (kuCard) kuCard.scrollIntoView({behavior: "smooth", block: "start"});
      else window.showToast && window.showToast("No KÜ data available", "ok");
    });
    actions.appendChild(kuBtn);

    card.appendChild(actions);
    return card;
  }

  /* ================================================================
     Private: _buildUtilityButtons — re-evaluate / debug / delete
     ================================================================ */
  function _buildUtilityButtons(entry) {
    var wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;";

    var reevalBtn = document.createElement("button");
    reevalBtn.type = "button";
    reevalBtn.className = "btn btn-secondary";
    reevalBtn.style.fontSize = "12px";
    reevalBtn.textContent = "Re-evaluate";
    reevalBtn.addEventListener("click", function () {
      reevalBtn.disabled = true;
      reevalBtn.textContent = "Evaluating…";
      fetch("/api/listings/" + encodeURIComponent(entry.id) + "/reevaluate", {method: "POST"})
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok) {
            window.showToast && window.showToast("Score: " + d.score + "/100", "ok");
            window.loadData && window.loadData().then(function () { window.openDetailPanel(entry.id); });
          } else {
            window.showToast && window.showToast("Re-evaluate failed: " + (d.error || "unknown"), "error");
            reevalBtn.disabled = false;
            reevalBtn.textContent = "Re-evaluate";
          }
        })
        .catch(function () {
          window.showToast && window.showToast("Re-evaluate failed", "error");
          reevalBtn.disabled = false;
          reevalBtn.textContent = "Re-evaluate";
        });
    });
    wrap.appendChild(reevalBtn);

    var debugBtn = document.createElement("button");
    debugBtn.type = "button";
    debugBtn.className = "btn btn-secondary";
    debugBtn.style.fontSize = "12px";
    debugBtn.textContent = "Debug";
    debugBtn.addEventListener("click", function () {
      fetch("/api/listings/" + encodeURIComponent(entry.id) + "/debug")
        .then(function (r) { return r.json(); })
        .then(function (d) { _showDebugModal(d); })
        .catch(function () { window.showToast && window.showToast("Debug fetch failed", "error"); });
    });
    wrap.appendChild(debugBtn);

    var deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-secondary";
    deleteBtn.style.cssText = "font-size:12px;border-color:rgba(196,99,95,0.4);color:var(--score-0);";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", function () {
      if (!window.confirm("Delete this listing? This cannot be undone.")) return;
      deleteBtn.disabled = true;
      fetch("/api/listings/" + encodeURIComponent(entry.id), {method: "DELETE"})
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.ok) {
            window.showToast && window.showToast("Deleted", "ok");
            currentListingId = null;
            window.loadData && window.loadData().then(function () {
              var mainEl = document.getElementById("detail-main");
              if (mainEl) {
                while (mainEl.firstChild) mainEl.removeChild(mainEl.firstChild);
                var emptyState = document.createElement("div");
                emptyState.className = "empty-state";
                var msg = document.createElement("div");
                msg.className = "big";
                msg.textContent = "Select a listing from the list";
                emptyState.appendChild(msg);
                mainEl.appendChild(emptyState);
              }
            });
          } else {
            window.showToast && window.showToast("Delete failed: " + (d.error || ""), "error");
            deleteBtn.disabled = false;
          }
        }).catch(function () {
          window.showToast && window.showToast("Delete failed", "error");
          deleteBtn.disabled = false;
        });
    });
    wrap.appendChild(deleteBtn);

    return wrap;
  }

  /* ================================================================
     Private: _buildKuCard — KU data card (preserved from Wave 3)
     ================================================================ */
  function _buildKuCard(ku, entry) {
    var card = document.createElement("div");
    card.className = "ku-card";

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
      try { tsEl.textContent = " — " + new Date(ku.looked_up_at).toLocaleDateString(); } catch (_) {}
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

    if (ku.auto && ku.auto.reg_code) {
      var auto = ku.auto;
      function kuRow(label, val) {
        var row = document.createElement("div");
        row.className = "ku-row";
        var l = document.createElement("span"); l.className = "ku-row-label"; l.textContent = label;
        var v = document.createElement("span"); v.className = "ku-row-val"; v.textContent = val || "";
        row.appendChild(l); row.appendChild(v);
        return row;
      }
      card.appendChild(kuRow("Name", auto.name));
      card.appendChild(kuRow("Reg code", auto.reg_code != null ? String(auto.reg_code) : ""));
      card.appendChild(kuRow("Address", auto.legal_address));
      if (auto.url) {
        var linkEl = document.createElement("a");
        linkEl.className = "ku-source-link";
        linkEl.href = auto.url;
        linkEl.target = "_blank";
        linkEl.rel = "noopener noreferrer";
        linkEl.textContent = "ariregister.rik.ee";
        card.appendChild(linkEl);
      }
    }

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
     Private: _showDebugModal — preserved from Wave 3
     ================================================================ */
  function _showDebugModal(d) {
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
    title.textContent = "Debug: " + (d.listing_id || "");
    header.appendChild(title);
    var closeBtn = document.createElement("button");
    closeBtn.className = "header-action-btn";
    closeBtn.textContent = "Close ✕";
    closeBtn.addEventListener("click", function () { overlay.parentNode.removeChild(overlay); });
    header.appendChild(closeBtn);
    modal.appendChild(header);

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

    modal.appendChild(_section("What Claude sees", d.listing_summary_sent_to_ai || "", true));
    modal.appendChild(_section("Resolved Listing", d.normalized_listing || {}, false));
    modal.appendChild(_section("Raw stored entry", d.raw_entry || {}, false));
    modal.appendChild(_section("Score / verdict", {score: d.stored_score, verdict: d.stored_verdict}, false));

    overlay.appendChild(modal);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.parentNode.removeChild(overlay);
    });
    document.body.appendChild(overlay);
  }

})();

/* ================================================================
   Global: scheduleViewingClick(listingId)
   ================================================================ */
window.scheduleViewingClick = function (listingId) {
  var input = document.getElementById("scheduled-at-input-" + listingId);
  if (!input || !input.value) {
    window.showToast && window.showToast("Pick a date and time first", "error");
    return;
  }
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
   ================================================================ */
window.markViewedClick = function (listingId) {
  var btn = document.getElementById("mark-viewed-btn-" + listingId);
  if (btn) btn.disabled = true;
  fetch("/api/entry/" + encodeURIComponent(listingId) + "/mark-viewed", {method: "POST"})
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
   ================================================================ */
window.regenerateBriefClick = function (listingId, btn) {
  fetch("/api/entry/" + encodeURIComponent(listingId) + "/regenerate-brief", {method: "POST"})
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        window.showToast && window.showToast("Generating…", "ok");
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
   ================================================================ */
window.refreshKuClick = function (listingId, btn) {
  fetch("/api/entry/" + encodeURIComponent(listingId) + "/refresh-ku", {method: "POST"})
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        window.showToast && window.showToast("KÜ lookup running…", "ok");
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

/* ================================================================
   Global: stillInDraftOfferClick(listingId)
   POST viewing-decision still-in → offer_drafted
   ================================================================ */
window.stillInDraftOfferClick = function (listingId) {
  fetch("/api/entry/" + encodeURIComponent(listingId) + "/viewing-decision", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({decision: "still-in"}),
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        window.showToast && window.showToast("Marked: Still in — drafting offer", "ok");
        window.loadData && window.loadData().then(function () {
          window.openDetailPanel && window.openDetailPanel(listingId);
        });
      } else {
        window.showToast && window.showToast("Failed: " + (d.error || d.detail || "unknown"), "error");
      }
    })
    .catch(function () {
      window.showToast && window.showToast("Network error", "error");
    });
};

/* ================================================================
   Global: thinkingClick(listingId)
   POST viewing-decision thinking → thinking
   ================================================================ */
window.thinkingClick = function (listingId) {
  fetch("/api/entry/" + encodeURIComponent(listingId) + "/viewing-decision", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({decision: "thinking"}),
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        window.showToast && window.showToast("Marked: Thinking", "ok");
        window.loadData && window.loadData().then(function () {
          window.openDetailPanel && window.openDetailPanel(listingId);
        });
      } else {
        window.showToast && window.showToast("Failed: " + (d.error || d.detail || "unknown"), "error");
      }
    })
    .catch(function () {
      window.showToast && window.showToast("Network error", "error");
    });
};

/* ================================================================
   Global: dropClick(listingId, triggerBtn)
   Opens an inline reason input, then POSTs viewing-decision drop with reason.
   ================================================================ */
window.dropClick = function (listingId, triggerBtn) {
  /* Remove any existing drop modal */
  var existing = document.getElementById("drop-reason-modal");
  if (existing) existing.parentNode.removeChild(existing);

  var overlay = document.createElement("div");
  overlay.id = "drop-reason-modal";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:24px;";

  var box = document.createElement("div");
  box.style.cssText = "background:var(--color-surface);border-radius:var(--radius-md);padding:20px 24px;max-width:400px;width:100%;box-shadow:var(--shadow-md);";

  var titleEl = document.createElement("div");
  titleEl.style.cssText = "font:500 15px/1.2 Inter,system-ui,sans-serif;color:var(--color-text);margin-bottom:12px;";
  titleEl.textContent = "Drop this listing?";
  box.appendChild(titleEl);

  var hintEl = document.createElement("div");
  hintEl.style.cssText = "font:400 12px Inter,system-ui,sans-serif;color:var(--color-text-muted);margin-bottom:14px;";
  hintEl.textContent = "Optional: what put you off?";
  box.appendChild(hintEl);

  var reasonInput = document.createElement("input");
  reasonInput.type = "text";
  reasonInput.placeholder = "Reason (optional)";
  reasonInput.style.cssText = "width:100%;box-sizing:border-box;background:var(--color-sunken);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:8px 10px;color:var(--color-text);font-size:13px;font-family:var(--font-body);outline:none;margin-bottom:14px;";
  reasonInput.addEventListener("focus", function () { reasonInput.style.borderColor = "var(--color-accent)"; });
  reasonInput.addEventListener("blur", function () { reasonInput.style.borderColor = "var(--color-border)"; });
  box.appendChild(reasonInput);

  var btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;";

  var confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "btn btn-secondary";
  confirmBtn.style.borderColor = "rgba(196,99,95,0.5)";
  confirmBtn.style.color = "var(--score-0)";
  confirmBtn.textContent = "Confirm drop";
  confirmBtn.addEventListener("click", function () {
    var reason = reasonInput.value.trim() || null;
    confirmBtn.disabled = true;
    fetch("/api/entry/" + encodeURIComponent(listingId) + "/viewing-decision", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({decision: "drop", reason: reason}),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        overlay.parentNode.removeChild(overlay);
        if (d.ok) {
          window.showToast && window.showToast("Listing dropped", "ok");
          window.loadData && window.loadData().then(function () {
            /* Re-render sidebar — selection may be gone */
            window.renderDetailList && window.renderDetailList();
            var mainEl = document.getElementById("detail-main");
            if (mainEl && mainEl.children.length > 0) {
              window.openDetailPanel && window.openDetailPanel(listingId);
            }
          });
        } else {
          window.showToast && window.showToast("Drop failed: " + (d.error || d.detail || "unknown"), "error");
        }
      })
      .catch(function () {
        overlay.parentNode.removeChild(overlay);
        window.showToast && window.showToast("Network error", "error");
      });
  });
  btnRow.appendChild(confirmBtn);

  var cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", function () {
    overlay.parentNode.removeChild(overlay);
  });
  btnRow.appendChild(cancelBtn);
  box.appendChild(btnRow);

  overlay.appendChild(box);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) overlay.parentNode.removeChild(overlay);
  });
  document.body.appendChild(overlay);
  reasonInput.focus();
};

/* ================================================================
   Global: undoDropClick(listingId)
   POST viewing-decision thinking (restores to viewed-with-thinking-flag)
   ================================================================ */
window.undoDropClick = function (listingId) {
  fetch("/api/entry/" + encodeURIComponent(listingId) + "/viewing-decision", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({decision: "thinking"}),
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        window.showToast && window.showToast("Undo drop — back to Thinking", "ok");
        window.loadData && window.loadData().then(function () {
          window.openDetailPanel && window.openDetailPanel(listingId);
        });
      } else {
        window.showToast && window.showToast("Undo failed: " + (d.error || d.detail || "unknown"), "error");
      }
    })
    .catch(function () {
      window.showToast && window.showToast("Network error", "error");
    });
};
