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
import { BAND, BAND_HEX, CONFIDENCE, clock, isSourced, relativeAge } from '../lib/display';
import { photoUrl, type ObservedPlace, type RemoteReport } from '../lib/reports';

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

/** Observed depth mapped to the same IMD bands the model uses.
 *
 *  Colour still means severity, exactly as everywhere else. What separates an
 *  observation from a prediction here is the SHAPE: a report is a square, a
 *  modelled hotspot is a circle, a landmark is a diamond. Someone can tell at
 *  a glance whether a red mark is something a model computed or something a
 *  person photographed, which is the distinction that matters most. */
const DEPTH_BAND: Record<string, RiskLevel> = {
  ankle: 'moderate',
  knee: 'high',
  waist: 'critical',
  impassable: 'critical',
};

const DEPTH_LABEL: Record<string, string> = {
  ankle: 'Ankle deep',
  knee: 'Knee deep',
  waist: 'Waist deep',
  impassable: 'Impassable',
};

function reportIcon(depth: string): L.DivIcon {
  const colour = BAND_HEX[DEPTH_BAND[depth] ?? 'moderate'];
  return L.divIcon({
    className: '',
    html:
      `<div style="width:13px;height:13px;background:${colour};` +
      `border:2px solid #0E1417;box-shadow:0 0 0 1.5px ${colour}"></div>`,
    iconSize: [13, 13],
    iconAnchor: [6.5, 6.5],
  });
}

interface Props {
  hotspots: Hotspot[];
  attractions: Attraction[];
  /** Approved citizen reports. Observations, never scored. */
  reports: RemoteReport[];
  /** Places the reports themselves identified, promoted or still gathering. */
  places: ObservedPlace[];
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
  reports,
  places,
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
                  <span className="num">
                    {h.threshold_mm_hr} mm/hr
                    {h.threshold_observed && <span className="tag-measured">measured</span>}
                  </span>
                </div>
                {h.threshold_observed && (
                  <div className="pop-note pop-measured">
                    <strong>This threshold was measured, not estimated.</strong>{' '}
                    {h.threshold_observed.pairs} reports across{' '}
                    {h.threshold_observed.days} separate days, from{' '}
                    {h.threshold_observed.metres_away} m away, put water here at rain this
                    light. It is the lightest rain anyone has actually seen flood this
                    place, so it is a floor rather than an exact figure, and it drops
                    further if a lighter storm ever floods it again.
                  </div>
                )}
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

        {/* Places the reports themselves identified. A promoted one has
            cleared corroboration on separate days and is a flood point in
            its own right, so it is drawn as a circle like the register.
            The dashed ring is its provenance: found by people, not by a
            newspaper, and never merged into the 73 sourced rows. */}
        {places.filter((p) => p.promoted).map((p) => {
          const colour = BAND_HEX[DEPTH_BAND[p.worst_depth ?? 'ankle'] ?? 'moderate'];
          return (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lon]}
              radius={7}
              pathOptions={{
                color: colour,
                weight: 2,
                dashArray: '3,2',
                fillColor: colour,
                fillOpacity: 0.45,
              }}
            >
              <Popup>
                <div className="pop-name">Reported flood point</div>
                <div className="pop-sub">
                  Found by {p.report_count} reports across {p.distinct_days} separate days
                </div>
                <div className="pop-kv">
                  <span>Worst seen</span>
                  <span style={{ color: colour, fontWeight: 600 }}>
                    {DEPTH_LABEL[p.worst_depth ?? ''] ?? p.worst_depth}
                  </span>
                </div>
                <div className="pop-kv">
                  <span>Last reported</span>
                  <span className="num">
                    {p.last_seen ? relativeAge((Date.now() - new Date(p.last_seen).getTime()) / 3_600_000) : 'unknown'}
                  </span>
                </div>
                <div className="pop-note">
                  <strong>Learned, not researched.</strong> This place is not one of the 73
                  sourced points. It is here because people repeatedly photographed water
                  here on different days. It carries its own provenance and is never merged
                  into the researched register.
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* Observations, drawn last so they sit above the modelled points.
            A photograph of the road outranks a forecast about it. */}
        {reports.map((r) => (
          <Marker
            key={r.id}
            position={[r.lat, r.lon]}
            icon={reportIcon(r.depth)}
            zIndexOffset={1000}
          >
            <Popup>
              {r.photo_path && (
                <img className="pop-photo" src={photoUrl(r.photo_path)} alt="" loading="lazy" />
              )}
              <div className="pop-name">{DEPTH_LABEL[r.depth] ?? r.depth}</div>
              <div className="pop-sub">
                Reported {relativeAge((Date.now() - new Date(r.created_at).getTime()) / 3_600_000)}
                {r.accuracy_m !== null && ` · ±${Math.round(r.accuracy_m)} m`}
              </div>
              {r.note && <p className="pop-note" style={{ marginTop: 6 }}>{r.note}</p>}
              <div className="pop-note">
                <strong>Someone was there.</strong> This is an observation with a photo,
                reviewed before publication. It is shown next to the model and is not used
                to compute any risk score.
              </div>
            </Popup>
          </Marker>
        ))}

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
        <div className="legend-row">
          <span style={{ width: 9, height: 9, background: 'var(--ink-dim)', flex: 'none' }} />
          Reported, with a photo
        </div>
        <div className="legend-row">
          <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px dashed var(--ink-dim)', background: 'rgba(147,166,174,0.45)', flex: 'none' }} />
          Learned from reports
        </div>
      </div>
    </div>
  );
}
