/**
 * ListingsMap — Leaflet map via react-leaflet for the Overview tab.
 *
 * Features:
 * - OSM tile layer, center Bolt HQ [59.4203, 24.7205], zoom 12
 * - DivIcon pins: circle filled with scoreColor, dark numeral inside
 *   Approved: solid border. Pending: dashed border.
 * - Filter pills: All / Approved / Pending
 * - Layer toggles: Districts €/m² + 30-min commute isochrone
 * - Legend: score-ramp quartile bars
 * - District polygon layer from /api/districts (color by avg_price_per_sqm)
 * - Isochrone: dashed polygon from /api/isochrone
 * - Pin click → setSelectedListingId + navigate to shortlist
 *
 * Bounds guard: only pins with lat/lng in [57.5,59.7]×[21.7,28.2] are rendered.
 */

import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Entry } from '../../types/api'
import { scoreColor } from '../../lib/score'
import { useAppStore } from '../../lib/state'
import { useIsochrone, useDistricts, type DistrictStat } from '../../lib/queries'

// ── Constants ───────────────────────────────────────────────────────────────

const BOLT_HQ: [number, number] = [59.4203, 24.7205]
const TALLINN_BOUNDS = {
  latMin: 57.5, latMax: 59.7,
  lngMin: 21.7, lngMax: 28.2,
}

// Accent purple matches Nocturne accent color
const ACCENT = '#9184d9'

// ── Helpers ──────────────────────────────────────────────────────────────────

function inBounds(lat: number, lng: number): boolean {
  return (
    lat >= TALLINN_BOUNDS.latMin && lat <= TALLINN_BOUNDS.latMax &&
    lng >= TALLINN_BOUNDS.lngMin && lng <= TALLINN_BOUNDS.lngMax
  )
}

function makePinIcon(score: number | null, status: string): L.DivIcon {
  const color = scoreColor(score)
  const label = score != null ? String(score) : '?'
  const isApproved = status === 'approved' || status === 'viewing_scheduled' ||
    status === 'viewed' || status === 'thinking' || status === 'offer_drafted'
  const isPending = status === 'pending'

  const border = isPending
    ? `2px dashed ${color}`
    : `2px solid ${color}`
  const bg = isApproved ? color : 'rgba(22,24,38,0.85)'
  const textColor = isApproved ? '#0f111c' : color

  const html = `<div style="
    width:28px;height:28px;
    border-radius:50%;
    background:${bg};
    border:${border};
    display:flex;align-items:center;justify-content:center;
    font-family:'JetBrains Mono',monospace;
    font-size:10px;font-weight:600;
    color:${textColor};
    box-shadow:0 2px 6px rgba(0,0,0,0.5);
  ">${label}</div>`

  return L.divIcon({
    html,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

// Price per sqm → color for district polygons (cheap = green, expensive = red)
function districtColor(avgPrice: number | null, allPrices: number[]): string {
  if (avgPrice == null || allPrices.length === 0) return 'rgba(145,132,217,0.15)'
  const min = Math.min(...allPrices)
  const max = Math.max(...allPrices)
  if (max === min) return 'rgba(79,185,141,0.2)'
  const t = (avgPrice - min) / (max - min) // 0=cheap, 1=expensive
  // cheap → green (#4fb98d), expensive → red (#c4635f)
  // Interpolate in RGB
  const r = Math.round(79 + (196 - 79) * t)
  const g = Math.round(185 + (99 - 185) * t)
  const b = Math.round(141 + (95 - 141) * t)
  return `rgba(${r},${g},${b},0.22)`
}

// ── Sub-components ────────────────────────────────────────────────────────────

type FilterMode = 'all' | 'approved' | 'pending'

interface FilterPillsProps {
  mode: FilterMode
  setMode: (m: FilterMode) => void
  counts: { all: number; approved: number; pending: number }
}

function FilterPills({ mode, setMode, counts }: FilterPillsProps) {
  const pills: { id: FilterMode; label: string; count: number }[] = [
    { id: 'all',      label: 'All',      count: counts.all },
    { id: 'approved', label: 'Approved', count: counts.approved },
    { id: 'pending',  label: 'Pending',  count: counts.pending },
  ]

  return (
    <div className="flex gap-1">
      {pills.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setMode(p.id)}
          className={[
            'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-sans transition-colors duration-fast',
            mode === p.id
              ? 'bg-surface ring-1 ring-border-strong text-text'
              : 'bg-surface/70 text-text-3 hover:bg-surface/90',
          ].join(' ')}
        >
          {p.label}
          <span className="font-mono text-[10px] text-muted">{p.count}</span>
        </button>
      ))}
    </div>
  )
}

interface LayerTogglesProps {
  showDistricts: boolean
  setShowDistricts: (v: boolean) => void
  showIsochrone: boolean
  setShowIsochrone: (v: boolean) => void
}

function LayerToggles({ showDistricts, setShowDistricts, showIsochrone, setShowIsochrone }: LayerTogglesProps) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setShowDistricts(!showDistricts)}
        className={[
          'px-2.5 py-1 rounded-md text-[11px] font-sans transition-colors duration-fast whitespace-nowrap',
          showDistricts
            ? 'bg-accent/20 text-accent-lt ring-1 ring-accent/40'
            : 'bg-surface/70 text-text-3 hover:bg-surface/90',
        ].join(' ')}
      >
        Districts €/m²
      </button>
      <button
        type="button"
        onClick={() => setShowIsochrone(!showIsochrone)}
        className={[
          'px-2.5 py-1 rounded-md text-[11px] font-sans transition-colors duration-fast whitespace-nowrap',
          showIsochrone
            ? 'bg-accent/20 text-accent-lt ring-1 ring-accent/40'
            : 'bg-surface/70 text-text-3 hover:bg-surface/90',
        ].join(' ')}
      >
        30-min commute
      </button>
    </div>
  )
}

function MapLegend() {
  const buckets: { label: string; color: string }[] = [
    { label: '85+', color: '#4fb98d' },
    { label: '75',  color: '#7fbf7a' },
    { label: '60',  color: '#c9b455' },
    { label: '40',  color: '#c98b52' },
    { label: '<40', color: '#c4635f' },
  ]
  return (
    <div className="flex items-center gap-1.5">
      {buckets.map((b) => (
        <div key={b.label} className="flex flex-col items-center gap-0.5">
          <div
            className="w-4 h-2.5 rounded-[2px]"
            style={{ background: b.color }}
          />
          <span className="font-mono text-[9px] text-muted">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Pins layer — uses imperative Leaflet API for performance ─────────────────

interface PinsLayerProps {
  entries: Entry[]
  filterMode: FilterMode
  onPinClick: (id: string) => void
}

function PinsLayer({ entries, filterMode, onPinClick }: PinsLayerProps) {
  const map = useMap()
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.clearLayers()
    } else {
      layerRef.current = L.layerGroup().addTo(map)
    }

    const visible = entries.filter((e) => {
      if (e.lat == null || e.lng == null) return false
      if (!inBounds(e.lat, e.lng)) return false
      if (filterMode === 'approved') {
        return e.status !== 'pending' && e.status !== 'rejected' && e.status !== 'withdrawn'
      }
      if (filterMode === 'pending') {
        return e.status === 'pending'
      }
      return true
    })

    for (const entry of visible) {
      const icon = makePinIcon(entry.score, entry.status)
      const marker = L.marker([entry.lat!, entry.lng!], { icon })
      marker.on('click', () => onPinClick(entry.id))
      marker.addTo(layerRef.current!)
    }

    return () => {
      layerRef.current?.clearLayers()
    }
  }, [map, entries, filterMode, onPinClick])

  return null
}

// ── District polygons layer ──────────────────────────────────────────────────

interface DistrictLayerProps {
  geojson: object | null
  districtStats: DistrictStat[]
  visible: boolean
}

function DistrictLayer({ geojson, districtStats, visible }: DistrictLayerProps) {
  if (!visible || !geojson) return null

  const allPrices = districtStats
    .map((d) => d.avg_price_per_sqm)
    .filter((p): p is number => p != null)

  const statsMap = new Map(districtStats.map((d) => [d.name, d]))

  return (
    <GeoJSON
      key={JSON.stringify(geojson)}
      data={geojson as GeoJSON.FeatureCollection}
      style={(feature) => {
        const name = feature?.properties?.nimi || feature?.properties?.name || ''
        const stat = statsMap.get(name)
        const color = districtColor(stat?.avg_price_per_sqm ?? null, allPrices)
        return {
          fillColor: color,
          fillOpacity: 1,
          color: 'rgba(255,255,255,0.12)',
          weight: 1,
        }
      }}
      onEachFeature={(feature, layer) => {
        const name = feature?.properties?.nimi || feature?.properties?.name || ''
        const stat = statsMap.get(name)
        if (stat?.avg_price_per_sqm) {
          layer.bindTooltip(
            `${name}<br/>${Math.round(stat.avg_price_per_sqm).toLocaleString()} €/m²`,
            { className: 'leaflet-district-tooltip', sticky: true },
          )
        }
      }}
    />
  )
}

// ── Isochrone layer ──────────────────────────────────────────────────────────

interface IsochroneLayerProps {
  geojson: object | null
  visible: boolean
}

function IsochroneLayer({ geojson, visible }: IsochroneLayerProps) {
  if (!visible || !geojson) return null
  return (
    <GeoJSON
      key={`iso-${visible}`}
      data={geojson as GeoJSON.FeatureCollection}
      pathOptions={{
        color: ACCENT,
        weight: 1.5,
        dashArray: '4 5',
        fillOpacity: 0,
      }}
    />
  )
}

// ── Main map component ────────────────────────────────────────────────────────

interface ListingsMapProps {
  entries: Entry[]       // both pending + shortlisted
  pendingEntries: Entry[]
}

export function ListingsMap({ entries, pendingEntries }: ListingsMapProps) {
  const setTab       = useAppStore((s) => s.setTab)
  const setSelected  = useAppStore((s) => s.setSelectedListingId)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [showDistricts, setShowDistricts] = useState(false)
  const [showIsochrone, setShowIsochrone] = useState(false)
  // Tallinn districts GeoJSON is served statically from the backend
  const [districtsGeoJSON, setDistrictsGeoJSON] = useState<object | null>(null)

  const { data: isochroneData } = useIsochrone()
  const { data: districtStatsData } = useDistricts()

  useEffect(() => {
    if (!showDistricts) return
    if (districtsGeoJSON) return
    fetch('/tallinn-districts.geojson')
      .then((r) => r.json())
      .then((d) => setDistrictsGeoJSON(d))
      .catch(() => null)
  }, [showDistricts, districtsGeoJSON])

  const allEntries = [...entries, ...pendingEntries]

  const approvedCount = allEntries.filter(
    (e) => e.status !== 'pending' && e.status !== 'rejected' && e.status !== 'withdrawn',
  ).length
  const pendingCount = pendingEntries.length

  function handlePinClick(id: string) {
    setSelected(id)
    setTab('shortlist')
  }

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden bg-bg">
      {/* Leaflet map */}
      <MapContainer
        center={BOLT_HQ}
        zoom={12}
        scrollWheelZoom={false}
        className="w-full h-full"
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* District polygons layer */}
        <DistrictLayer
          geojson={districtsGeoJSON}
          districtStats={districtStatsData?.districts ?? []}
          visible={showDistricts}
        />

        {/* Isochrone layer */}
        <IsochroneLayer
          geojson={isochroneData ?? null}
          visible={showIsochrone}
        />

        {/* Listing pins */}
        <PinsLayer
          entries={allEntries}
          filterMode={filterMode}
          onPinClick={handlePinClick}
        />
      </MapContainer>

      {/* UI overlays — positioned over the map */}

      {/* Filter pills — top-left */}
      <div className="absolute top-2 left-2 z-[1000] flex gap-1">
        <FilterPills
          mode={filterMode}
          setMode={setFilterMode}
          counts={{
            all: allEntries.filter((e) => e.lat != null).length,
            approved: approvedCount,
            pending: pendingCount,
          }}
        />
      </div>

      {/* Layer toggles — top-right */}
      <div className="absolute top-2 right-2 z-[1000]">
        <LayerToggles
          showDistricts={showDistricts}
          setShowDistricts={setShowDistricts}
          showIsochrone={showIsochrone}
          setShowIsochrone={setShowIsochrone}
        />
      </div>

      {/* Legend — bottom-left */}
      <div className="absolute bottom-2 left-2 z-[1000] bg-surface/85 backdrop-blur-sm rounded-md px-2.5 py-1.5 shadow-md">
        <MapLegend />
      </div>
    </div>
  )
}
