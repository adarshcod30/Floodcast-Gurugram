/**
 * Map view.
 *
 * Two encodings do the work, and both are honest by construction:
 *
 *   COLOUR = risk band (IMD warning colours)
 *   FILL   = provenance certainty
 *
 * A solid marker is a sourced, named hotspot. A hollow one is a real
 * locality that no source confirms floods. A dotted one is a structural
 * placeholder. That distinction is readable at a glance without a
 * legend — which matters, because a placeholder rendered identically to
 * an MCG-named hotspot is exactly the kind of quiet dishonesty this
 * project is built to avoid.
 *
 * Landmarks use a square marker and are never risk-coloured; they exist
 * so the app answers "is this place reachable", not to make any flood
 * claim about them.
 */

import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { Attraction, Confidence, Hotspot, RiskLevel } from '../types';
import { BAND, BAND_HEX, CONFIDENCE, clock, isSourced } from '../lib/display';

const GURUGRAM: [number, number] = [28.4595, 77.0266];

interface Props {
  hotspots: Hotspot[];
  attractions: Attraction[];
  /** Per-hotspot risk at the selected hour, keyed by hotspot_id. */
  riskAt: Map<string, { risk_level: RiskLevel; risk_score: number; time_window: { starts_at: string; clears_by: string } | null }>;
  showLandmarks: boolean;
  showWatchlist: boolean;
  onToggleLandmarks: () => void;
  onToggleWatchlist: () => void;
}

/** Landmarks: a neutral square, deliberately unlike the risk circles. */
const landmarkIcon = L.divIcon({
  className: '',
  html:
    '<div style="width:9px;height:9px;background:#93A6AE;' +
    'border:1px solid #0E1417;transform:rotate(45deg)"></div>',
  iconSize: [9, 9],
  iconAnchor: [4.5, 4.5],
});

/** Marker radius scales with severity tier so the register's own
 *  hierarchy stays visible even when nothing is currently flooding. */
function radius(tier: string, atRisk: boolean): number {
  const base = tier === 'hypercritical' ? 7 : tier === 'moderate' ? 5.5 : 4.5;
  return atRisk ? base + 1.5 : base;
}

/** Fill opacity encodes certainty: sourced points are solid, watchlist
 *  and placeholder points are hollow rings. */
function fillFor(confidence: Confidence): { fillOpacity: number; dashArray?: string } {
  if (isSourced(confidence)) return { fillOpacity: 0.85 };
  if (confidence === 'plausible_real_unconfirmed_flood_status') return { fillOpacity: 0.08 };
  return { fillOpacity: 0.04, dashArray: '2,3' };
}

/**
 * Frame the map on the data, and keep it framed when the pane resizes.
 *
 * A fixed centre and zoom is wrong on two counts: it shows most of NCR
 * on a wide screen, and Leaflet caches the container size at mount, so
 * a map that mounts inside a hidden tab renders into stale dimensions
 * and needs invalidateSize() once it is actually visible.
 */
function FitToData({ points }: { points: Array<[number, number]> }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points).pad(0.08), { animate: false });
  }, [map, points]);

  useEffect(() => {
    const el = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

export default function MapPanel({
  hotspots,
  attractions,
  riskAt,
  showLandmarks,
  showWatchlist,
  onToggleLandmarks,
  onToggleWatchlist,
}: Props) {
  const visible = showWatchlist ? hotspots : hotspots.filter((h) => isSourced(h.data_confidence));

  // Frame on the register itself, so the view is always "Gurugram's
  // flood points" rather than an arbitrary slice of NCR.
  const bounds = useMemo(
    () => visible.map((h) => [h.latitude, h.longitude] as [number, number]),
    [visible],
  );

  return (
    <div className="map-wrap">
      <MapContainer
        center={GURUGRAM}
        zoom={12}
        scrollWheelZoom
        zoomControl
        preferCanvas
        style={{ height: '100%', width: '100%' }}
      >
        <FitToData points={bounds} />

        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />

        {visible.map((h) => {
          const live = riskAt.get(h.hotspot_id);
          const level = live?.risk_level ?? 'low';
          const atRisk = (live?.risk_score ?? 0) > 0;
          const colour = BAND_HEX[level];   // literal hex — Leaflet SVG attrs ignore var()
          const fill = fillFor(h.data_confidence);
          const conf = CONFIDENCE[h.data_confidence];

          return (
            <CircleMarker
              key={h.hotspot_id}
              center={[h.latitude, h.longitude]}
              radius={radius(h.severity_tier, atRisk)}
              pathOptions={{
                color: colour,
                weight: h.data_confidence === 'confirmed_named_mcg_zone1' ? 2.5 : 1.5,
                fillColor: colour,
                ...fill,
              }}
            >
              <Popup>
                <div className="pop-name">{h.name}</div>
                <div className="pop-sub">
                  {h.locality_area} · {h.zone} · {h.road_type}
                </div>

                <div className="pop-kv">
                  <span>Risk now</span>
                  <span style={{ color: colour, fontWeight: 600 }}>{level}</span>
                </div>
                <div className="pop-kv">
                  <span>Severity tier</span>
                  <span>{h.severity_tier}</span>
                </div>
                <div className="pop-kv">
                  <span>Floods above</span>
                  <span className="num">{h.threshold_mm_hr} mm/hr</span>
                </div>
                {live?.time_window && (
                  <div className="pop-kv">
                    <span>Window</span>
                    <span className="num" style={{ color: colour }}>
                      {clock(live.time_window.starts_at)} – {clock(live.time_window.clears_by)}
                    </span>
                  </div>
                )}

                <div className="pop-note">
                  <strong>{conf.short}.</strong> {conf.blurb}
                  {h.coordinates_verified === 'No' && (
                    <> Coordinates are approximate and unverified.</>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {showLandmarks &&
          attractions.map((a) => (
            <Marker key={a.poi_id} position={[a.lat, a.lon]} icon={landmarkIcon}>
              <Popup>
                <div className="pop-name">{a.name}</div>
                <div className="pop-sub">
                  {a.category} · {a.locality}
                </div>
                <div className="pop-note">
                  A landmark, shown for orientation. No flood risk is calculated for
                  landmarks — they are not part of the hotspot register.
                </div>
              </Popup>
            </Marker>
          ))}
      </MapContainer>

      <div className="map-toggle">
        <button aria-pressed={showWatchlist} onClick={onToggleWatchlist}>
          {showWatchlist ? 'All 73 points' : 'Sourced only (39)'}
        </button>
        <button aria-pressed={showLandmarks} onClick={onToggleLandmarks}>
          Landmarks
        </button>
      </div>

      <div className="legend">
        <div className="label" style={{ marginBottom: 6 }}>Risk (IMD bands)</div>
        {(['critical', 'high', 'moderate', 'low'] as RiskLevel[]).map((lvl) => (
          <div key={lvl} className="legend-row">
            <span
              style={{
                width: 9, height: 9, borderRadius: '50%',
                background: BAND[lvl], flex: 'none',
              }}
            />
            {lvl}
          </div>
        ))}

        <div className="legend-sep" />

        <div className="label" style={{ marginBottom: 6 }}>Fill = certainty</div>
        <div className="legend-row">
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--ink-dim)', flex: 'none' }} />
          Sourced &amp; named
        </div>
        <div className="legend-row">
          <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid var(--ink-dim)', flex: 'none' }} />
          Watchlist, unconfirmed
        </div>
        <div className="legend-row">
          <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px dotted var(--ink-dim)', flex: 'none' }} />
          Structural placeholder
        </div>
      </div>
    </div>
  );
}
