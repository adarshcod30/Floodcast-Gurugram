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

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { Attraction, Confidence, Hotspot, RiskLevel } from '../types';
import { BAND, BAND_HEX, CONFIDENCE, clock, isSourced } from '../lib/display';

const GURUGRAM: [number, number] = [28.4595, 77.0266];

/**
 * How far out the map may be pulled.
 *
 * Everything this tool knows about is inside Gurugram. Zooming out to
 * Uttar Pradesh, or to the whole subcontinent, shows 73 markers collapsing
 * into one green smudge and answers no question anyone came here with. The
 * bounds cover Delhi NCR, which is far enough to see where Gurugram sits in
 * relation to Delhi and Faridabad and no further.
 *
 * `maxBoundsViscosity: 1` makes the edge solid rather than elastic; at
 * anything less the map rubber-bands past the limit and springs back, which
 * reads as jank rather than as a boundary.
 */
const NCR_BOUNDS: [[number, number], [number, number]] = [
  [27.85, 76.40],
  [29.05, 77.85],
];
const MIN_ZOOM = 10;
const MAX_ZOOM = 18;

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
 * A fixed centre and zoom is wrong on two counts: it shows most of NCR on a
 * wide screen, and Leaflet caches the container size at mount, so a map that
 * mounts before layout settles renders into stale dimensions.
 *
 * That stale size is not a cosmetic problem. Leaflet derives the fitBounds
 * zoom from the container size, so calling it against a zero-height
 * container makes getBoundsZoom conclude that nothing fits and drop to zoom
 * 0: the whole world, with all 73 points in a single pixel. invalidateSize()
 * alone does not recover from it, because resizing does not re-run the fit.
 * So the fit is deferred until the container actually has a size, and re-run
 * whenever that size changes.
 */
function FitToData({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  // Held in a ref so the resize observer can re-fit against current data
  // without being torn down and rebuilt every time the forecast ticks.
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const fit = useCallback(() => {
    const pts = pointsRef.current;
    if (pts.length === 0) return;

    const el = map.getContainer();
    // Fitting into a zero-size container is what produces the zoom-0 bug.
    if (el.clientWidth === 0 || el.clientHeight === 0) return;

    map.invalidateSize({ animate: false });
    map.fitBounds(L.latLngBounds(pts).pad(0.08), { animate: false });
  }, [map]);

  // Re-fit only when the visible set changes, never on a risk update, so
  // scrubbing the timeline does not yank the view back from wherever the
  // user has panned to.
  useEffect(() => {
    fit();
  }, [fit, points]);

  useEffect(() => {
    const observer = new ResizeObserver(() => fit());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, fit]);

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

  // Frame on the register itself, so the view is always "Gurugram's flood
  // points" rather than an arbitrary slice of NCR.
  //
  // Keyed on which points are visible, not on the hotspot objects: those get
  // new identities every time the forecast refreshes or the timeline is
  // scrubbed, and re-fitting on each of those would repeatedly snap the map
  // away from wherever the user had panned.
  const boundsKey = visible.map((h) => h.hotspot_id).join(',');
  const bounds = useMemo(
    () => visible.map((h) => [h.latitude, h.longitude] as [number, number]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boundsKey],
  );

  return (
    <div className="map-wrap">
      <MapContainer
        center={GURUGRAM}
        zoom={12}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={NCR_BOUNDS}
        maxBoundsViscosity={1}
        scrollWheelZoom
        zoomControl
        preferCanvas
        style={{ height: '100%', width: '100%' }}
      >
        <FitToData points={bounds} />

        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
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

                {/* Measured, unlike everything above it. Labelled as GMDA's
                    figure and kept visually separate from the risk numbers,
                    which are computed from estimates. */}
                {h.gmda_drain_area_sq_km != null && (
                  <div className="pop-kv pop-gmda">
                    <span>Catchment draining here</span>
                    <span className="num">
                      {h.gmda_drain_area_sq_km} km²
                      {h.gmda_nearest_stream_m != null &&
                        ` · ${Math.round(h.gmda_nearest_stream_m)} m to channel`}
                    </span>
                  </div>
                )}

                <div className="pop-note">
                  <strong>{conf.short}.</strong> {conf.blurb}
                  {h.coordinates_verified === 'No' && (
                    <> Coordinates are approximate and unverified.</>
                  )}
                  {h.gmda_drain_area_sq_km != null && (
                    <>
                      {' '}The catchment figure is measured, from GMDA's published
                      drainage network. It is shown as evidence and is not used in
                      the risk score.
                    </>
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
