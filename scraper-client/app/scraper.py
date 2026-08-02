"""
kv.ee scraper client for the mini PC.

Runs two things in one process:
  1. A background loop that scrapes on schedule (INTERVAL_HOURS) and
     POSTs parsed listing JSON to the VPS at /api/ingest.
  2. A tiny FastAPI app at http://0.0.0.0:SCRAPER_UI_PORT with a single
     "Scrape now" button. Bound to 0.0.0.0 so any device on the home LAN
     can hit it (phone, laptop) but never exposed to the internet — the
     mini PC has no port forward.

The VPS handles filtering, AI evaluation, Telegram notifications, and
dossier storage. This client only scrapes, parses, and delivers raw data.
"""

import dataclasses
import json
import logging
import os
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import requests as http
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

import kv_scraper
from kv_scraper import fetch_listing_urls, get_session, close_browser
from kv_listing_parser import fetch_listing

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("scraper")

# Mandatory env vars — KeyError at boot if missing so misconfiguration is loud
# Set-once security/infra config — stays in env, not editable from UI.
VPS_INGEST_URL = os.environ["VPS_INGEST_URL"]
INGEST_TOKEN = os.environ["INGEST_TOKEN"]
UI_PORT = int(os.environ.get("SCRAPER_UI_PORT", "8002"))

# Runtime-editable settings. env values are the initial defaults; overrides
# persist to SETTINGS_FILE in the /app/data volume so they survive restarts.
SETTINGS_FILE = os.environ.get("SETTINGS_FILE", "/app/data/settings.json")

_SETTINGS_SCHEMA = {
    "kv_search_url":        {"type": str,   "env": "KV_SEARCH_URL",         "default": ""},
    "interval_hours":       {"type": float, "env": "CHECK_INTERVAL_HOURS",  "default": 2.0},
    "max_listings_default": {"type": int,   "env": "SCRAPER_MAX_LISTINGS",  "default": 0},
    "auto_scrape_enabled":  {"type": bool,  "env": "SCRAPER_AUTO_ENABLED",  "default": True},
    # Hard filters — injected into the kv.ee search URL as query params BEFORE
    # fetching, so kv.ee itself returns pre-filtered results. Zero = disabled
    # (URL's own filters, if any, still apply). Non-zero = force this value.
    # The backend keeps the same filters as a belt-and-suspenders safety net.
    "max_price_eur":        {"type": int,   "env": "MAX_PRICE_EUR",         "default": 0},
    "min_rooms":            {"type": int,   "env": "MIN_ROOMS",             "default": 0},
    "min_images":           {"type": int,   "env": "MIN_IMAGES",            "default": 0},
    "min_area_sqm":         {"type": int,   "env": "MIN_AREA_SQM",          "default": 0},
}


def _coerce(value, kind):
    if kind is bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        return str(value).strip().lower() in ("1", "true", "yes", "on")
    return kind(value)


def _load_settings() -> dict:
    """Env defaults, then overlay any on-disk overrides."""
    settings = {}
    for k, spec in _SETTINGS_SCHEMA.items():
        env_val = os.environ.get(spec["env"])
        if env_val is not None and env_val != "":
            try:
                settings[k] = _coerce(env_val, spec["type"])
            except (ValueError, TypeError):
                settings[k] = spec["default"]
        else:
            settings[k] = spec["default"]

    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                disk = json.load(f)
            for k, spec in _SETTINGS_SCHEMA.items():
                if k in disk:
                    try:
                        settings[k] = _coerce(disk[k], spec["type"])
                    except (ValueError, TypeError):
                        pass
        except Exception:
            logging.getLogger("scraper").exception("Could not load %s — using env defaults", SETTINGS_FILE)
    return settings


def _persist_settings() -> None:
    try:
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        tmp = SETTINGS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_settings, f, indent=2)
        os.replace(tmp, SETTINGS_FILE)
    except Exception:
        logging.getLogger("scraper").exception("Failed to persist settings")


_settings = _load_settings()


# kv.ee query-param names for the four hard filters we push into the URL.
# Verified against a live kv.ee search URL on 2026-08-02. If kv.ee ever
# renames these, override in the URL string itself instead of hoping this
# stays in sync — the settings-hint UI text points users at kv.ee's own
# search form to grab a fresh URL.
_KV_QUERY_PARAMS = {
    "max_price_eur":  "price_max",
    "min_rooms":      "rooms_min",
    "min_images":     "nr_of_photos_from",
    "min_area_sqm":   "size_from",
}


def _build_effective_search_url() -> str:
    """Return the kv.ee search URL with the scraper's hard filters injected.

    Zero-valued settings are treated as "don't touch this param" so the base
    URL's own query stays intact. Non-zero settings OVERRIDE whatever the
    base URL has — that lets the user tune limits from the UI without
    hand-editing the URL every time.

    Returns the raw kv_search_url if nothing to inject or the URL is empty.
    """
    base = _settings.get("kv_search_url") or ""
    if not base:
        return ""
    active = {
        _KV_QUERY_PARAMS[key]: str(int(_settings[key]))
        for key in _KV_QUERY_PARAMS
        if int(_settings.get(key, 0) or 0) > 0
    }
    if not active:
        return base
    try:
        parsed = urlparse(base)
        params = parse_qs(parsed.query, keep_blank_values=True)
        for name, value in active.items():
            params[name] = [value]
        new_query = urlencode(params, doseq=True)
        return urlunparse(parsed._replace(query=new_query))
    except Exception:
        logging.getLogger("scraper").exception(
            "Failed to inject filters into %s — falling back to raw URL", base
        )
        return base


# Push the effective URL (base + filter overrides) into kv_scraper module state
# so first-run uses the current values.
kv_scraper.KV_SEARCH_URL = _build_effective_search_url()


# ---------------------------------------------------------------------------
# Shared state guarded by _state_lock — mutated by both the background loop
# and the /scrape endpoint. Read by /status without locking (fine for single
# monotonic reads on primitive types).
# ---------------------------------------------------------------------------
_state_lock = threading.Lock()
_scrape_in_progress: bool = False
_last_scrape_at: Optional[str] = None
_last_scrape_result: Optional[str] = None
_next_scheduled_at: Optional[float] = None  # epoch seconds

# Playwright's sync API is thread-affine — a browser opened in thread T can only
# be driven from thread T. We run every scrape from a single dedicated worker
# thread so the browser session can survive across scrape runs (no warm-up
# on every /scrape → dramatically less bot-detection heat from kv.ee).
_scrape_queue: "queue.Queue[int]" = queue.Queue()


def _post(path: str, payload) -> None:
    """POST JSON payload to a VPS endpoint. Never raises — logs and returns."""
    try:
        resp = http.post(
            f"{VPS_INGEST_URL}{path}",
            headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
    except http.RequestException as exc:
        log.error("POST %s failed: %s", path, exc)


def run_once(max_listings: int = 0) -> int:
    """Scrape kv.ee → parse → POST to VPS. Returns processed URL count.

    max_listings: if >0, only fetch/parse the first N URLs from the search.
                  Defaults to _settings["max_listings_default"].
    Reads _settings["kv_search_url"] via kv_scraper.KV_SEARCH_URL each call so a
    UI edit takes effect on the next scrape without a restart.
    """
    # Push the live setting into kv_scraper before every run so settings edits
    # take effect immediately (kv_scraper reads its module-level KV_SEARCH_URL).
    # Effective URL = base kv_search_url with our hard-filter query params injected.
    kv_scraper.KV_SEARCH_URL = _build_effective_search_url()
    log.info("Scrape URL for this run: %s", kv_scraper.KV_SEARCH_URL)

    urls = fetch_listing_urls()
    total = len(urls)
    log.info("Found %d listing URLs", total)
    # Empty result almost always means the browser warm-up failed. Force a
    # clean teardown so the next attempt starts with a fresh Playwright rather
    # than reusing a half-broken one.
    if total == 0:
        log.info("No URLs found — closing browser to reset state for next run")
        close_browser()
        return 0

    cap = max_listings if max_listings > 0 else _settings["max_listings_default"]
    if cap > 0 and len(urls) > cap:
        log.info("Capping listings to %d (of %d)", cap, total)
        urls = urls[:cap]

    listings = []
    parsed_ok = 0
    parsed_fail = 0
    scrape_failed = False
    try:
        session = get_session()  # browser-backed adapter, or None
        for url in urls:
            listing = fetch_listing(url, session=session)
            if listing.raw_ok:
                listings.append(dataclasses.asdict(listing))
                parsed_ok += 1
            else:
                parsed_fail += 1
                log.warning("Parse failed for %s", url)
    except Exception:
        log.exception("run_once inner loop failed")
        scrape_failed = True
    finally:
        # Only close the browser if this scrape had a genuine failure.
        # Otherwise KEEP IT ALIVE across runs — the next fetch_listing_urls()
        # reuses the same context, skips the warm-up, and doesn't ring kv.ee's
        # bot-detection bell. Every successful warm-up burns some trust; reusing
        # a working session avoids that entirely.
        if scrape_failed or parsed_fail > parsed_ok:
            log.info("Scrape had failures — closing browser to retry fresh next time")
            close_browser()

    log.info("Parsed OK: %d, failed: %d, sending to backend...", parsed_ok, parsed_fail)

    if listings:
        _post("/api/ingest", listings)

    _post("/api/heartbeat", {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "listing_count": len(urls),
        "source": "kv.ee",
    })

    return parsed_ok


def _run_scrape_guarded(max_listings: int = 0) -> None:
    """Run a single scrape cycle with global state bookkeeping.

    max_listings: pass-through cap for run_once. 0 = no override (use env default).
    Idempotent for rapid button clicks — skips if another scrape is running.
    """
    global _scrape_in_progress, _last_scrape_at, _last_scrape_result, _next_scheduled_at

    with _state_lock:
        if _scrape_in_progress:
            log.info("Scrape already in progress — skipping duplicate trigger")
            return
        _scrape_in_progress = True
        _last_scrape_at = datetime.now(timezone.utc).isoformat()

    try:
        n = run_once(max_listings=max_listings)
        result = f"OK — {n} listings"
    except Exception as exc:
        log.exception("scrape run failed")
        result = f"FAILED — {exc}"

    with _state_lock:
        _scrape_in_progress = False
        _last_scrape_result = result
        _next_scheduled_at = time.time() + _settings["interval_hours"] * 3600


def _scrape_worker() -> None:
    """Dedicated thread that owns Playwright. Consumes scrape requests from
    _scrape_queue so every browser call happens in this single thread.

    Requests are integers (max_listings). Sentinel -1 shuts the worker down.
    """
    global _next_scheduled_at
    log.info("Scrape worker thread started")
    while True:
        try:
            max_listings = _scrape_queue.get(timeout=60)  # wake to check schedule
        except queue.Empty:
            # No manual request queued; check whether auto-scrape is due AND enabled.
            with _state_lock:
                due = _next_scheduled_at is not None and time.time() >= _next_scheduled_at
            if due and _settings.get("auto_scrape_enabled", True):
                _run_scrape_guarded(0)
            elif due:
                # Auto-scrape disabled — reset the timer so we don't spin.
                with _state_lock:
                    _next_scheduled_at = time.time() + _settings["interval_hours"] * 3600
            continue
        if max_listings < 0:
            log.info("Scrape worker received shutdown signal")
            return
        _run_scrape_guarded(max_listings)
        _scrape_queue.task_done()


# ---------------------------------------------------------------------------
# FastAPI app — tiny UI + status/scrape endpoints
# ---------------------------------------------------------------------------
app = FastAPI(title="Aparts Scraper")

INDEX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Aparts Scraper</title>
  <style>
    :root { --bg: #0a0a0f; --card: #14141c; --text: #e5e5e5; --muted: #888;
            --blue: #3b82f6; --green: #10b981; --red: #ef4444; --border: #2d2d44; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, system-ui, sans-serif;
           background: var(--bg); color: var(--text); min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: var(--card); border: 1px solid var(--border);
            border-radius: 12px; padding: 40px 32px; max-width: 400px; width: 100%;
            text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; }
    .sub { color: var(--muted); font-size: 13px; margin-bottom: 32px; }
    button { background: var(--blue); color: white; border: none;
             padding: 18px 40px; font-size: 17px; font-weight: 600;
             border-radius: 8px; cursor: pointer; width: 100%;
             transition: opacity 0.15s, background 0.15s; }
    button:hover:not(:disabled) { opacity: 0.9; }
    button:disabled { background: #444; cursor: not-allowed; }
    button.danger { background: transparent; color: var(--red);
                    border: 1px solid var(--red); padding: 10px 20px;
                    font-size: 13px; font-weight: 500; margin-top: 10px; }
    button.danger:hover:not(:disabled) { background: rgba(239,68,68,0.1); opacity: 1; }
    .max-input { display: flex; align-items: center; gap: 8px;
                 margin-bottom: 16px; font-size: 12px; color: var(--muted); }
    .max-input input { flex: 1; background: var(--bg); color: var(--text);
                       border: 1px solid var(--border); border-radius: 6px;
                       padding: 8px 10px; font-family: ui-monospace, monospace;
                       font-size: 13px; text-align: center; }
    .max-input input:focus { outline: none; border-color: var(--blue); }
    .settings-panel {
      margin-top: 24px; padding-top: 16px;
      border-top: 1px dashed var(--border); text-align: left;
    }
    .settings-header {
      display: flex; justify-content: space-between; align-items: center;
      cursor: pointer; user-select: none;
      font-size: 12px; font-family: ui-monospace, monospace;
      color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .settings-body { display: none; margin-top: 12px; }
    .settings-body.open { display: block; }
    .settings-row { margin-bottom: 12px; }
    .settings-label {
      display: block; font-size: 11px; font-family: ui-monospace, monospace;
      color: var(--muted); margin-bottom: 4px; text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .settings-row input[type="text"], .settings-row input[type="number"] {
      width: 100%; background: var(--bg); color: var(--text);
      border: 1px solid var(--border); border-radius: 4px;
      padding: 8px 10px; font-family: ui-monospace, monospace; font-size: 12px;
    }
    .settings-row input:focus { outline: none; border-color: var(--blue); }
    .settings-row-checkbox { display: flex; align-items: center; gap: 8px; }
    .settings-row-checkbox input { width: auto; }
    .settings-row-checkbox label {
      font-size: 12px; color: var(--text); cursor: pointer;
      text-transform: none; letter-spacing: 0; margin: 0;
    }
    .settings-save {
      background: var(--green); color: white; border: none;
      padding: 10px 20px; font-size: 12px; font-weight: 600;
      border-radius: 6px; cursor: pointer; width: 100%; margin-top: 4px;
    }
    .settings-save:hover:not(:disabled) { opacity: 0.9; }
    .settings-save:disabled { background: #444; cursor: not-allowed; }
    .settings-hint { font-size: 10px; color: var(--muted); margin-top: 3px; line-height: 1.4; }
    .settings-err { font-size: 11px; color: var(--red); margin-top: 6px; }
    .status { margin-top: 24px; font-size: 12px; font-family: ui-monospace, monospace;
              color: var(--muted); line-height: 1.6; min-height: 60px; }
    .status .row { display: flex; justify-content: space-between; gap: 8px;
                    padding: 4px 0; border-bottom: 1px dashed var(--border); }
    .status .row:last-child { border-bottom: none; }
    .status .label { color: var(--muted); }
    .status .value { color: var(--text); text-align: right; word-break: break-all; }
    .ok { color: var(--green) !important; }
    .err { color: var(--red) !important; }
    .footer { margin-top: 24px; font-size: 10px; color: var(--muted); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Aparts Scraper</h1>
    <div class="sub">Home mini PC · residential IP · CF bypass</div>
    <div class="max-input">
      <label for="max">Max listings (0 = all)</label>
      <input id="max" type="number" min="0" step="1" value="0">
    </div>
    <button id="scrape">🔄 Scrape now</button>
    <button id="clear" class="danger">🗑 Clear backend data</button>
    <div class="status" id="status">Loading…</div>

    <div class="settings-panel">
      <div class="settings-header" id="settings-header">
        <span>⚙ Settings</span>
        <span id="settings-chevron">▾</span>
      </div>
      <div class="settings-body" id="settings-body">
        <div class="settings-row">
          <label class="settings-label" for="set-url">kv.ee search URL</label>
          <input id="set-url" type="text" placeholder="https://www.kv.ee/ru/search?...">
          <div class="settings-hint">Paste the URL from your kv.ee filtered search. Applies on next scrape.</div>
        </div>
        <div class="settings-row">
          <label class="settings-label" for="set-interval">Auto-scrape interval (hours)</label>
          <input id="set-interval" type="number" min="0.1" step="0.1" max="168">
          <div class="settings-hint">How often the timer runs. Save resets the countdown.</div>
        </div>
        <div class="settings-row">
          <label class="settings-label" for="set-default-max">Default max listings per run (0 = all)</label>
          <input id="set-default-max" type="number" min="0" step="1" max="500">
          <div class="settings-hint">Applies when the Max input above is 0 or when auto-scrape fires.</div>
        </div>
        <div class="settings-row settings-row-checkbox">
          <input id="set-auto" type="checkbox">
          <label for="set-auto">Auto-scrape enabled</label>
        </div>

        <div class="settings-row">
          <label class="settings-label" for="set-max-price">Max price (EUR)</label>
          <input id="set-max-price" type="number" min="0" step="1000" max="10000000">
          <div class="settings-hint">Injected as <code>price_max</code> into the kv.ee URL. 0 = keep whatever the URL has.</div>
        </div>
        <div class="settings-row">
          <label class="settings-label" for="set-min-rooms">Min rooms</label>
          <input id="set-min-rooms" type="number" min="0" step="1" max="20">
          <div class="settings-hint">Injected as <code>rooms_min</code>. 0 = keep URL default.</div>
        </div>
        <div class="settings-row">
          <label class="settings-label" for="set-min-images">Min images</label>
          <input id="set-min-images" type="number" min="0" step="1" max="50">
          <div class="settings-hint">Injected as <code>nr_of_photos_from</code>. 0 = keep URL default.</div>
        </div>
        <div class="settings-row">
          <label class="settings-label" for="set-min-area">Min area (m²)</label>
          <input id="set-min-area" type="number" min="0" step="1" max="1000">
          <div class="settings-hint">Injected as <code>size_from</code>. 0 = keep URL default.</div>
        </div>

        <button id="settings-save" class="settings-save">Save settings</button>
        <div class="settings-err" id="settings-err"></div>
      </div>
    </div>

    <div class="footer">Scrapes kv.ee → POSTs to backend</div>
  </div>
  <script>
    const btn = document.getElementById('scrape');
    const status = document.getElementById('status');

    function fmt(ts) {
      if (!ts) return '—';
      try { return new Date(ts).toLocaleTimeString(); } catch (e) { return ts; }
    }
    function fmtIn(sec) {
      if (sec == null || sec < 0) return '—';
      if (sec < 60) return sec + 's';
      if (sec < 3600) return Math.round(sec / 60) + 'm';
      return (Math.round(sec / 360) / 10) + 'h';
    }
    function row(label, value, cls) {
      const v = document.createElement('span');
      v.className = 'value ' + (cls || '');
      v.textContent = value;
      const l = document.createElement('span');
      l.className = 'label';
      l.textContent = label;
      const r = document.createElement('div');
      r.className = 'row';
      r.appendChild(l);
      r.appendChild(v);
      return r;
    }

    async function refresh() {
      try {
        const r = await fetch('/status');
        const d = await r.json();
        if (d.in_progress) {
          btn.disabled = true;
          btn.textContent = '⏳ Scraping…';
        } else {
          btn.disabled = false;
          btn.textContent = '🔄 Scrape now';
        }
        while (status.firstChild) status.removeChild(status.firstChild);
        status.appendChild(row('Last run', fmt(d.last_at)));
        const resultCls = (d.last_result || '').startsWith('OK') ? 'ok' :
                          (d.last_result || '').startsWith('FAILED') ? 'err' : '';
        status.appendChild(row('Result', d.last_result || '—', resultCls));
        status.appendChild(row('Next auto', fmtIn(d.next_in_seconds)));
      } catch (e) {
        while (status.firstChild) status.removeChild(status.firstChild);
        status.appendChild(row('Error', 'Cannot reach scraper', 'err'));
      }
    }

    const maxInput = document.getElementById('max');
    const clearBtn = document.getElementById('clear');

    /* Persist max value in localStorage */
    const savedMax = localStorage.getItem('scraper_max');
    if (savedMax !== null) maxInput.value = savedMax;
    maxInput.addEventListener('change', () => {
      localStorage.setItem('scraper_max', maxInput.value);
    });

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '⏳ Starting…';
      const max = parseInt(maxInput.value || '0', 10) || 0;
      try {
        const r = await fetch('/scrape?max=' + max, {method: 'POST'});
        const d = await r.json();
        if (!d.ok) {
          while (status.firstChild) status.removeChild(status.firstChild);
          status.appendChild(row('Error', d.error || 'unknown', 'err'));
          btn.disabled = false;
          btn.textContent = '🔄 Scrape now';
        }
      } catch (e) {
        while (status.firstChild) status.removeChild(status.firstChild);
        status.appendChild(row('Error', 'Network', 'err'));
        btn.disabled = false;
        btn.textContent = '🔄 Scrape now';
      }
      setTimeout(refresh, 300);
    });

    clearBtn.addEventListener('click', async () => {
      if (!confirm('Delete ALL listings from the backend? This cannot be undone.')) return;
      clearBtn.disabled = true;
      const originalText = clearBtn.textContent;
      clearBtn.textContent = '⏳ Clearing…';
      try {
        const r = await fetch('/clear-backend', {method: 'DELETE'});
        const d = await r.json();
        if (d.ok) {
          const b = (d.body && d.body.removed) || {};
          const msg = 'Cleared ' + (b.properties || 0) + '/' + (b.pending || 0) + '/' + (b.rejected || 0);
          while (status.firstChild) status.removeChild(status.firstChild);
          status.appendChild(row('Cleared', msg, 'ok'));
        } else {
          while (status.firstChild) status.removeChild(status.firstChild);
          status.appendChild(row('Clear failed', d.error || 'unknown', 'err'));
        }
      } catch (e) {
        while (status.firstChild) status.removeChild(status.firstChild);
        status.appendChild(row('Error', 'Network', 'err'));
      }
      clearBtn.disabled = false;
      clearBtn.textContent = originalText;
    });

    /* ---- Settings panel ---- */
    const settingsHeader = document.getElementById('settings-header');
    const settingsBody = document.getElementById('settings-body');
    const settingsChevron = document.getElementById('settings-chevron');
    const setUrl = document.getElementById('set-url');
    const setInterval_ = document.getElementById('set-interval');
    const setDefaultMax = document.getElementById('set-default-max');
    const setAuto = document.getElementById('set-auto');
    const setMaxPrice = document.getElementById('set-max-price');
    const setMinRooms = document.getElementById('set-min-rooms');
    const setMinImages = document.getElementById('set-min-images');
    const setMinArea = document.getElementById('set-min-area');
    const settingsSave = document.getElementById('settings-save');
    const settingsErr = document.getElementById('settings-err');

    settingsHeader.addEventListener('click', () => {
      const open = settingsBody.classList.toggle('open');
      settingsChevron.textContent = open ? '▴' : '▾';
    });

    async function loadSettings() {
      try {
        const r = await fetch('/settings');
        const d = await r.json();
        setUrl.value = d.kv_search_url || '';
        setInterval_.value = d.interval_hours;
        setDefaultMax.value = d.max_listings_default;
        setAuto.checked = !!d.auto_scrape_enabled;
        setMaxPrice.value = d.max_price_eur || 0;
        setMinRooms.value = d.min_rooms || 0;
        setMinImages.value = d.min_images || 0;
        setMinArea.value = d.min_area_sqm || 0;
      } catch (e) {}
    }

    settingsSave.addEventListener('click', async () => {
      settingsSave.disabled = true;
      settingsErr.textContent = '';
      const payload = {
        kv_search_url: setUrl.value.trim(),
        interval_hours: parseFloat(setInterval_.value),
        max_listings_default: parseInt(setDefaultMax.value || '0', 10),
        auto_scrape_enabled: !!setAuto.checked,
        max_price_eur: parseInt(setMaxPrice.value || '0', 10),
        min_rooms: parseInt(setMinRooms.value || '0', 10),
        min_images: parseInt(setMinImages.value || '0', 10),
        min_area_sqm: parseInt(setMinArea.value || '0', 10),
      };
      try {
        const r = await fetch('/settings', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload),
        });
        const d = await r.json();
        if (!d.ok) {
          settingsErr.textContent = (d.errors || ['Failed']).join(' · ');
        } else {
          settingsErr.style.color = 'var(--green)';
          settingsErr.textContent = '✓ Saved';
          setTimeout(() => { settingsErr.textContent = ''; settingsErr.style.color = ''; }, 3000);
          refresh();
        }
      } catch (e) {
        settingsErr.textContent = 'Network error';
      }
      settingsSave.disabled = false;
    });

    loadSettings();
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return INDEX_HTML


@app.get("/status")
def status() -> dict:
    with _state_lock:
        next_in = None
        if _next_scheduled_at is not None:
            next_in = max(0, int(_next_scheduled_at - time.time()))
        return {
            "in_progress": _scrape_in_progress,
            "last_at": _last_scrape_at,
            "last_result": _last_scrape_result,
            "next_in_seconds": next_in,
            "interval_hours": _settings["interval_hours"],
            "auto_scrape_enabled": _settings["auto_scrape_enabled"],
        }


@app.post("/scrape")
def scrape(max: int = 0):
    """Enqueue a manual scrape for the dedicated worker thread.

    Query param ?max=N caps the batch size for testing. 0 = use env default.
    """
    with _state_lock:
        if _scrape_in_progress:
            return JSONResponse(
                {"ok": False, "error": "Scrape already in progress"},
                status_code=409,
            )
    _scrape_queue.put(max)
    return {"ok": True, "message": "Scrape queued", "max_listings": max}


@app.get("/settings")
def get_settings() -> dict:
    """Return the current editable settings dict."""
    return dict(_settings)


@app.post("/settings")
async def post_settings(request: Request):
    """Apply a partial or full settings update. Validates types, persists to disk,
    hot-applies to kv_scraper. Reschedules the auto-scrape timer if the interval changed.
    """
    global _next_scheduled_at
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Body must be JSON"}, status_code=400)

    prev_interval = _settings["interval_hours"]
    errors = []
    applied = {}
    for k, v in (body or {}).items():
        spec = _SETTINGS_SCHEMA.get(k)
        if not spec:
            errors.append(f"unknown key: {k}")
            continue
        try:
            new_val = _coerce(v, spec["type"])
        except (ValueError, TypeError):
            errors.append(f"bad value for {k}: {v!r}")
            continue
        # Basic bounds
        if k == "interval_hours" and (new_val <= 0 or new_val > 168):
            errors.append("interval_hours must be in (0, 168]")
            continue
        if k == "max_listings_default" and (new_val < 0 or new_val > 500):
            errors.append("max_listings_default must be in [0, 500]")
            continue
        if k == "kv_search_url" and new_val and not new_val.startswith(("http://", "https://")):
            errors.append("kv_search_url must start with http:// or https://")
            continue
        if k == "max_price_eur" and (new_val < 0 or new_val > 10_000_000):
            errors.append("max_price_eur must be in [0, 10000000]")
            continue
        if k == "min_rooms" and (new_val < 0 or new_val > 20):
            errors.append("min_rooms must be in [0, 20]")
            continue
        if k == "min_images" and (new_val < 0 or new_val > 50):
            errors.append("min_images must be in [0, 50]")
            continue
        if k == "min_area_sqm" and (new_val < 0 or new_val > 1000):
            errors.append("min_area_sqm must be in [0, 1000]")
            continue
        _settings[k] = new_val
        applied[k] = new_val

    if errors:
        return JSONResponse({"ok": False, "errors": errors, "applied": applied}, status_code=422)

    _persist_settings()

    # Hot-apply URL to kv_scraper. Rebuild the effective URL whenever the base
    # URL or any of the four hard filters changed — kv_scraper reads
    # module-level KV_SEARCH_URL on the next fetch, so the change lands
    # immediately without waiting for the scheduler tick.
    if applied.keys() & ({"kv_search_url", *_KV_QUERY_PARAMS.keys()}):
        kv_scraper.KV_SEARCH_URL = _build_effective_search_url()
        log.info("Effective search URL updated: %s", kv_scraper.KV_SEARCH_URL)

    # If interval changed, reschedule the next auto-scrape from now.
    if "interval_hours" in applied and applied["interval_hours"] != prev_interval:
        with _state_lock:
            _next_scheduled_at = time.time() + _settings["interval_hours"] * 3600

    log.info("Settings updated: %s", applied)
    return {"ok": True, "settings": dict(_settings)}


@app.delete("/clear-backend")
def clear_backend() -> dict:
    """Proxy DELETE to the backend's /api/listings/all endpoint.

    Uses the container's outbound path to the backend so the browser doesn't
    have to worry about cross-origin. Same INGEST_TOKEN auth flow as ingest.
    """
    try:
        resp = http.delete(
            f"{VPS_INGEST_URL}/api/listings/all",
            headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
            timeout=15,
        )
        return {"ok": resp.ok, "backend_status": resp.status_code, "body": resp.json()}
    except http.RequestException as exc:
        log.error("clear-backend failed: %s", exc)
        return {"ok": False, "error": str(exc)}


def main() -> None:
    global _next_scheduled_at
    log.info(
        "Scraper starting. Interval: %.1fh. Auto: %s. VPS: %s. UI port: %d",
        _settings["interval_hours"], _settings["auto_scrape_enabled"], VPS_INGEST_URL, UI_PORT,
    )
    with _state_lock:
        _next_scheduled_at = time.time() + _settings["interval_hours"] * 3600
    # Single worker thread owns Playwright for its lifetime — scheduled and
    # manual scrapes both flow through _scrape_queue so browser state persists.
    threading.Thread(target=_scrape_worker, daemon=True).start()
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=UI_PORT, log_level="info")


if __name__ == "__main__":
    main()
