/*
 * map.js — Leaflet map init, pins, isochrone overlay, district heat zone, filter pills.
 *
 * Exposes: window.initMap, window.refreshMapPins
 * Calls: window.openDetailPanel (bound by detail-panel.js at load time)
 * Reads: window.state, window.mapFilter, window.scoreColor, window.escapeHtml, window.fmtEur
 *
 * All listing strings passed to Leaflet tooltips go through window.escapeHtml().
 * All DOM writes go through Leaflet APIs only (textContent via escapeHtml for tooltips).
 * No ORS or Nominatim calls from the browser; this module consumes pre-computed backend data.
 */
(function () {
  "use strict";

  /* ---- Module-level map state ---- */
  var map = null;
  var markersLayer = null;
  var isochroneLayer = null;
  var districtLayer = null;
  var districtsVisible = true; // default: visible (D-10)

  /* ================================================================
     window.initMap — initialise the main Leaflet map once (idempotent)
     ================================================================ */
  window.initMap = function () {
    if (map) return; // already initialised

    // Leaflet [lat, lng] order — Veerenni 28 / Bolt HQ hard-coded (config.BOLT_HQ_LAT=59.4203, LNG=24.7205)
    // scrollWheelZoom disabled so the page can be scrolled normally; user zooms via +/- or pinch
    map = L.map("map-container", {scrollWheelZoom: false}).setView([59.4203, 24.7205], 12); // Leaflet [lat, lng] order

    // OpenStreetMap tile layer
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19
    }).addTo(map);

    // Markers layer group for easy clear/re-add on filter changes
    markersLayer = L.layerGroup().addTo(map);

    // Draw initial pins from current state
    window.refreshMapPins();

    // Load overlays asynchronously — never block map render
    _loadIsochrone();
    _loadDistrictLayer();

    // Wire filter pill clicks
    document.querySelectorAll(".filter-pills [data-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.mapFilter = btn.dataset.filter;
        document.querySelectorAll(".filter-pills [data-filter]").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        window.refreshMapPins();
      });
    });

    // Wire Districts toggle button
    var districtToggleBtn = document.getElementById("district-toggle");
    if (districtToggleBtn) {
      districtToggleBtn.addEventListener("click", function () {
        districtsVisible = !districtsVisible;
        districtToggleBtn.classList.toggle("active", districtsVisible);
        if (districtLayer) {
          if (districtsVisible) {
            districtLayer.addTo(map);
            districtLayer.bringToBack();
          } else {
            map.removeLayer(districtLayer);
          }
        }
      });
    }
  };

  /* ================================================================
     window.refreshMapPins — clear and re-draw all pins
     ================================================================ */
  window.refreshMapPins = function () {
    if (!markersLayer) return;
    markersLayer.clearLayers();

    // Collect entries based on current filter
    var entries;
    var filter = window.mapFilter || "all";
    if (filter === "approved") {
      entries = window.state.properties.map(function (e) { return {entry: e, isApproved: true}; });
    } else if (filter === "pending") {
      entries = window.state.pending.map(function (e) { return {entry: e, isApproved: false}; });
    } else {
      // "all"
      entries = window.state.properties.map(function (e) { return {entry: e, isApproved: true}; })
        .concat(window.state.pending.map(function (e) { return {entry: e, isApproved: false}; }));
    }

    // Apply the shared Detail-tab filter state too so map + list stay in sync
    if (window.filterListing) {
      entries = entries.filter(function (item) {
        return window.filterListing(item.entry, !item.isApproved, false);
      });
    }

    entries.forEach(function (item) {
      var entry = item.entry;
      var isApproved = item.isApproved;

      // Skip entries without coordinates
      if (entry.lat == null || entry.lng == null) return;

      // Estonia bounding box guard: silently skip pins outside [57.5,59.7] × [21.7,28.2]
      if (entry.lat < 57.5 || entry.lat > 59.7 || entry.lng < 21.7 || entry.lng > 28.2) return;

      // Pin style per D-02: approved = radius 12, solid; pending = radius 8, dashed
      var markerOpts;
      if (isApproved) {
        markerOpts = {
          radius: 12,
          fillColor: window.scoreColor(entry.score || 0),
          color: "#ffffff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85,
          dashArray: null
        };
      } else {
        markerOpts = {
          radius: 8,
          fillColor: window.scoreColor(entry.score || 0),
          color: "#ffffff",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.85,
          dashArray: "4,4"
        };
      }

      // Leaflet [lat, lng] order
      var marker = L.circleMarker([entry.lat, entry.lng], markerOpts); // Leaflet [lat, lng] order

      // Tooltip — all listing strings sanitised via escapeHtml (T-05-31)
      var titleStr = window.escapeHtml(entry.title || entry.name || entry.id || "");
      var priceStr = window.escapeHtml(window.fmtEur(entry.price_eur || entry.price || 0));
      var scoreStr = window.escapeHtml(entry.score != null ? entry.score + "/100" : "—");
      marker.bindTooltip(titleStr + " · " + priceStr + " · " + scoreStr);

      // Click: dispatch a real click on the Detail nav button (fires the whole
      // tab-switch handler including renderApp() + section visibility toggle),
      // then open the detail panel for this listing. Same pattern the BEST
      // hero card uses in ui.js so both entry points route the user identically.
      marker.on("click", function () {
        var detailBtn = document.querySelector('.tab-nav button[data-tab="detail"]');
        if (detailBtn) detailBtn.click();
        if (window.openDetailPanel) window.openDetailPanel(entry.id);
      });

      markersLayer.addLayer(marker);
    });
  };

  /* ================================================================
     Private: _loadIsochrone — fetch and render isochrone GeoJSON layer
     ================================================================ */
  function _loadIsochrone() {
    fetch("/api/isochrone")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.features || !data.features.length) return; // silent skip
        window.state.isochroneGeoJson = data;
        isochroneLayer = L.geoJSON(data, {
          style: {
            fillColor: "#3b82f6",
            fillOpacity: 0.12,
            color: "#3b82f6",
            weight: 2
          }
        }).addTo(map);
      })
      .catch(function () { /* silent skip on any error */ });
  }

  /* ================================================================
     Private: _loadDistrictLayer — fetch /api/districts + tallinn-districts.geojson,
     join on name, render quartile-coloured polygon layer
     ================================================================ */
  function _loadDistrictLayer() {
    Promise.all([
      fetch("/api/districts").then(function (r) { return r.ok ? r.json() : null; }),
      fetch("/tallinn-districts.geojson").then(function (r) { return r.ok ? r.json() : null; })
    ]).then(function (results) {
      var districtsApiData = results[0];
      var districtsGeoJson = results[1];
      if (!districtsApiData || !districtsGeoJson) return; // silent skip if either failed
      _renderDistrictLayer(districtsApiData, districtsGeoJson);
    }).catch(function () { /* silent skip */ });
  }

  /* ================================================================
     Private: _renderDistrictLayer — draw quartile-coloured district polygons
     ================================================================ */
  function _renderDistrictLayer(districtsApiData, districtsGeoJson) {
    // Cache inputs on state
    window.state.districtsData = districtsApiData.districts || [];
    window.state.districtsGeoJson = districtsGeoJson;

    // Build name → avg_price_per_sqm lookup
    var byName = {};
    window.state.districtsData.forEach(function (d) {
      byName[d.name] = d.avg_price_per_sqm;
    });

    // Compute quartile thresholds from non-null avg values
    var avgs = window.state.districtsData
      .map(function (d) { return d.avg_price_per_sqm; })
      .filter(function (v) { return v != null; })
      .sort(function (a, b) { return a - b; });

    var q1 = null, q2 = null, q3 = null;
    if (avgs.length >= 4) {
      q1 = avgs[Math.floor(avgs.length / 4)];
      q2 = avgs[Math.floor(avgs.length / 2)];
      q3 = avgs[Math.floor(3 * avgs.length / 4)];
    } else if (avgs.length >= 2) {
      q2 = avgs[Math.floor(avgs.length / 2)]; // single mid-tone fallback
    }

    // Colour function: cheapest = dark-green, most expensive = dark-red
    function colorFor(avg) {
      if (avg == null) return "#374151"; // no data: mid-grey
      if (q1 == null && q2 == null) return "#065f46"; // single tier fallback
      if (q2 != null && avg <= q2) return "#065f46"; // dark-green (cheapest half)
      if (q1 != null && avg <= q1) return "#065f46"; // dark-green (Q1)
      if (q2 != null && q3 != null) {
        if (avg <= q2) return "#065f46";
        if (avg <= q3) return "#f59e0b"; // amber
        return "#991b1b"; // dark-red (most expensive)
      }
      return "#ef4444"; // red fallback
    }

    // Re-compute with proper quartile logic
    function colorForQuartile(avg) {
      if (avg == null) return "#374151";
      if (avgs.length < 2) return "#065f46";
      // Determine which quartile avg falls into
      var n = avgs.length;
      var q1v = avgs[Math.floor(n / 4)];
      var q2v = avgs[Math.floor(n / 2)];
      var q3v = avgs[Math.floor(3 * n / 4)];
      if (avg <= q1v) return "#065f46"; // dark-green cheapest
      if (avg <= q2v) return "#f59e0b"; // amber
      if (avg <= q3v) return "#ef4444"; // red
      return "#991b1b";                 // dark-red most expensive
    }

    districtLayer = L.geoJSON(districtsGeoJson, {
      style: function (feature) {
        var name = feature.properties && feature.properties.name;
        var avg = name ? byName[name] : null;
        return {
          fillColor: colorForQuartile(avg),
          fillOpacity: 0.35,
          color: "#0a0a0f",
          weight: 1
        };
      },
      onEachFeature: function (feature, layer) {
        var name = (feature.properties && feature.properties.name) || "Unknown";
        var avg = byName[name];
        // All strings sanitised via escapeHtml for Leaflet tooltip (T-05-31)
        var label = window.escapeHtml(name + (avg != null ? (" · avg " + Math.round(avg) + " €/m²") : " · no data"));
        layer.bindTooltip(label);
      }
    });

    if (districtsVisible) {
      districtLayer.addTo(map);
      districtLayer.bringToBack(); // pins must render above district polygons
    }
  }

})();
