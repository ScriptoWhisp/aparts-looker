/*
 * cost.js — client-side all-in cost maths for Wave 6C.
 *
 * Exposes: window.computeAllIn(entry, settings)
 *
 * The AI never invents euro figures — it only classifies which renovation
 * items apply and with what confidence. This helper multiplies those
 * classifications by user-editable rates from Settings → Renovation rates.
 *
 * All amounts are integers (rounded). The caller is responsible for display.
 *
 * XSS: no DOM manipulation here — pure maths only.
 */
(function () {
  "use strict";

  /* Keys that use area_sqm as their default qty (when qty is null). */
  var PER_SQM_KEYS = new Set(["floors", "rewire", "cosmetic"]);

  /**
   * computeAllIn(entry, settings) → {work, allIn, band, hasLowConfidence}
   *
   * @param {object} entry    - listing entry from window.state.properties or .pending
   * @param {object} settings - flat settings object from /api/settings values
   *                            (reno_kitchen_full, reno_bathroom_full, etc.)
   * @returns {{ work: number, allIn: number, band: number, hasLowConfidence: boolean }}
   *          work            - estimated renovation cost incl. contingency (€)
   *          allIn           - price_eur + work (€)
   *          band            - ± uncertainty band (€)
   *          hasLowConfidence - true if any item has confidence === 1 (widens band)
   *
   * When renovation_override_work_eur is set on cost_of_ownership, that value
   * overrides the computed work figure (user-pinned override).
   */
  window.computeAllIn = function (entry, settings) {
    /* Resolve renovation_items from checklists (stored separately from entry). */
    var checklists = (window.state && window.state.checklists) || {};
    var cl = checklists[entry.id] || (entry.checklist || {});
    var items = cl.renovation_items || [];

    /* Rate table keyed by renovation item key. */
    var rates = {
      kitchen_full:  Number(settings.reno_kitchen_full  || 12000),
      bathroom_full: Number(settings.reno_bathroom_full || 7000),
      windows:       Number(settings.reno_windows_per_unit || 420),
      floors:        Number(settings.reno_floors_per_sqm   || 100),
      rewire:        Number(settings.reno_rewire_per_sqm   || 58),
      heating:       Number(settings.reno_heating          || 2600),
      cosmetic:      Number(settings.reno_cosmetic_per_sqm || 35),
    };

    var area = Number(entry.area_sqm || entry.area || 0);
    var price = Number(entry.price_eur || entry.price || 0);

    var subtotal = 0;
    var hasLowConfidence = false;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      /* applies === false means confirmed not needed — skip */
      if (item.applies === false) continue;

      var rate = rates[item.key] || 0;
      /* qty: use AI-provided value, else fall back to area for per-sqm keys, else 1 */
      var qty;
      if (item.qty != null && !isNaN(item.qty)) {
        qty = Number(item.qty);
      } else if (PER_SQM_KEYS.has(item.key)) {
        qty = area;
      } else {
        qty = 1;
      }

      subtotal += rate * qty;
      if (item.confidence === 1) hasLowConfidence = true;
    }

    var contingencyPct = Number(settings.reno_contingency_pct != null ? settings.reno_contingency_pct : 15);
    var work = Math.round(subtotal * (1 + contingencyPct / 100));

    /* User-pinned override takes precedence over computed work */
    var coo = entry.cost_of_ownership || {};
    if (coo.renovation_override_work_eur != null) {
      work = Math.round(Number(coo.renovation_override_work_eur));
    }

    var allIn = price + work;
    /* Uncertainty band: widen to 40% if any confidence-1 item, else 25% */
    var bandPct = hasLowConfidence ? 0.4 : 0.25;
    var band = Math.round(work * bandPct);

    return {
      work: work,
      allIn: allIn,
      band: band,
      hasLowConfidence: hasLowConfidence,
    };
  };

})();
