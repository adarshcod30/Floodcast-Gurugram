import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, LayersControl, Polyline, useMap, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Hotspot, Attraction } from '../../types';
import { getRiskColor } from '../../utils/riskColors';
import { getConfidenceStyle } from '../../utils/confidenceBadge';
import indiaBoundary from '../../assets/india-boundary.json';

// Fix default marker icon
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Custom blue marker for attractions
const attractionIcon = new L.DivIcon({
  className: '',
  html: `<div style="
    width: 28px; height: 28px; border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
    font-size: 14px;
  ">📍</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -16],
});

const GURUGRAM_CENTER: [number, number] = [28.4595, 77.0266];

interface MapViewProps {
  hotspots: Hotspot[];
  attractions: Attraction[];
  utilities: import('../../types').UtilityStatus[];
  roadworks: import('../../types').RoadworkZone[];
  reports: import('../../types').CitizenReport[];
  activeRoute: import('../../types').RouteAnalysis | null;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function UtilityPopup({ utility }: { utility: any }) {
  const isPower = utility.utility_type === 'power';
  const isWater = utility.utility_type === 'water';
  const isCut = utility.status === 'active_cut';
  const statusColor = isCut ? '#ef4444' : utility.status === 'scheduled_cut' ? '#eab308' : '#22c55e';
  
  return (
    <div style={{ minWidth: 200, fontFamily: 'Outfit, sans-serif' }}>
      <strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
        {isPower ? '⚡' : isWater ? '🚰' : '🔥'} {utility.sector_name}
      </strong>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
        Type: {utility.utility_type.toUpperCase()} · Impact: {utility.impact_level}
      </div>
      <div style={{
        padding: '4px 8px', borderRadius: 6, fontSize: 11, marginBottom: 6,
        background: `${statusColor}15`, border: `1px solid ${statusColor}30`,
        fontWeight: 600, color: statusColor
      }}>
        {utility.status.replace('_', ' ').toUpperCase()} 
        {utility.duration_hours && ` (~${utility.duration_hours}h)`}
      </div>
      <p style={{ fontSize: 11, color: '#cbd5e1', margin: 0, lineHeight: 1.3 }}>
        {utility.notes}
      </p>
    </div>
  );
}

function RoadworkPopup({ work }: { work: any }) {
  const isHigh = work.severity === 'High';
  const statusColor = isHigh ? '#ef4444' : work.severity === 'Medium' ? '#f97316' : '#22c55e';
  
  return (
    <div style={{ minWidth: 200, fontFamily: 'Outfit, sans-serif' }}>
      <strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
        🚧 {work.location_name}
      </strong>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
        Road: {work.road_type} · Work: {work.work_type.replace('_', ' ')}
      </div>
      <div style={{
        padding: '4px 8px', borderRadius: 6, fontSize: 11, marginBottom: 6,
        background: `${statusColor}15`, border: `1px solid ${statusColor}30`,
        fontWeight: 600, color: statusColor
      }}>
        {work.severity.toUpperCase()} SEVERITY (+{work.delay_minutes}m Delay)
      </div>
      <p style={{ fontSize: 11, color: '#cbd5e1', margin: 0, lineHeight: 1.3 }}>
        {work.notes}
      </p>
    </div>
  );
}

function ReportPopup({ report }: { report: any }) {
  return (
    <div style={{ minWidth: 220, fontFamily: 'Outfit, sans-serif' }}>
      <strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
        📣 {report.title}
      </strong>
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>
        Category: {report.category.toUpperCase()} · {report.location_name}
      </div>
      <p style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 8, lineHeight: 1.3 }}>
        {report.description}
      </p>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)',
        fontSize: 10, color: '#64748b'
      }}>
        <span>👍 {report.upvotes} Upvotes</span>
        <span>{new Date(report.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}

function HotspotPopup({ hotspot }: { hotspot: Hotspot }) {
  const conf = getConfidenceStyle(hotspot.data_confidence);
  const riskColor = getRiskColor(hotspot.risk_level);

  return (
    <div style={{ minWidth: 240, fontFamily: 'Outfit, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          background: riskColor, display: 'inline-block',
        }} />
        <strong style={{ fontSize: 14 }}>{hotspot.name}</strong>
      </div>

      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
        {hotspot.locality_area} · {hotspot.zone}
      </div>

      <div style={{
        padding: '6px 10px', borderRadius: 8, marginBottom: 8,
        background: `${riskColor}22`, border: `1px solid ${riskColor}44`,
      }}>
        <div style={{ fontWeight: 600, color: riskColor, fontSize: 13 }}>
          {hotspot.risk_level.toUpperCase()} RISK
          <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 400, marginLeft: 8 }}>
            {(hotspot.risk_score * 100).toFixed(0)}%
          </span>
        </div>
        {hotspot.time_window && (
          <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>
            ⏰ {formatTime(hotspot.time_window.starts_at)} – {formatTime(hotspot.time_window.clears_by)}
            <span style={{ color: '#94a3b8', marginLeft: 4 }}>
              (~{hotspot.time_window.duration_hours}h)
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <span className={`confidence-badge ${conf.className}`}>
          {conf.icon} {conf.shortLabel}
        </span>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 12,
          background: 'rgba(148, 163, 184, 0.1)',
          color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.2)',
        }}>
          {hotspot.severity_tier}
        </span>
      </div>

      <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>
        {conf.description}
      </div>
    </div>
  );
}

function AttractionPopup({ attraction }: { attraction: Attraction }) {
  return (
    <div style={{ minWidth: 200, fontFamily: 'Outfit, sans-serif' }}>
      <strong style={{ fontSize: 14, display: 'block', marginBottom: 4 }}>
        📍 {attraction.name}
      </strong>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>
        {attraction.category} · {attraction.locality}
      </div>
      <div style={{
        fontSize: 11, padding: '4px 8px', borderRadius: 8,
        background: 'rgba(59, 130, 246, 0.1)',
        color: '#93c5fd', border: '1px solid rgba(59, 130, 246, 0.2)',
      }}>
        Landmark — not a flood risk classification
      </div>
    </div>
  );
}

function RouteBoundFitter({ activeRoute }: { activeRoute: import('../../types').RouteAnalysis | null }) {
  const map = useMap();
  useEffect(() => {
    if (activeRoute) {
      map.fitBounds([
        [activeRoute.origin.lat, activeRoute.origin.lon],
        [activeRoute.destination.lat, activeRoute.destination.lon]
      ], { padding: [50, 50] });
    }
  }, [activeRoute, map]);
  return null;
}

export default function MapView({ hotspots, attractions, utilities, roadworks, reports, activeRoute }: MapViewProps) {
  const getMarkerRadius = (hotspot: Hotspot): number => {
    const base = hotspot.severity_tier === 'hypercritical' ? 10 :
                 hotspot.severity_tier === 'moderate' ? 7 : 5;
    if (hotspot.risk_score > 0.5) return base + 3;
    return base;
  };

  const getMarkerOpacity = (hotspot: Hotspot): number => {
    if (hotspot.risk_score >= 0.7) return 0.95;
    if (hotspot.risk_score >= 0.3) return 0.8;
    return 0.6;
  };

  const getBorderWeight = (confidence: string): number => {
    switch (confidence) {
      case 'confirmed_named_mcg_zone1': return 3;
      case 'confirmed_named_multi_source': return 2;
      default: return 1;
    }
  };

  const getDashArray = (confidence: string): string | undefined => {
    switch (confidence) {
      case 'plausible_real_unconfirmed_flood_status': return '4 4';
      case 'reconstructed_estimate': return '2 4';
      default: return undefined;
    }
  };

  return (
    <MapContainer
      center={GURUGRAM_CENTER}
      zoom={12}
      className="w-full h-full"
      zoomControl={true}
    >
      <GeoJSON
        data={indiaBoundary as any}
        style={{
          color: '#3b82f6',
          weight: 2.5,
          opacity: 0.85,
          fill: false,
          interactive: false
        }}
      />
      <RouteBoundFitter activeRoute={activeRoute} />

      {activeRoute && (
        <Polyline
          positions={[
            [activeRoute.origin.lat, activeRoute.origin.lon],
            [activeRoute.destination.lat, activeRoute.destination.lon],
          ]}
          pathOptions={{
            color: getRiskColor(activeRoute.overall_risk_level),
            weight: 5,
            opacity: 0.8,
            dashArray: '5, 10',
          }}
        />
      )}

      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Dark Map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </LayersControl.BaseLayer>

        <LayersControl.Overlay checked name="🔴 Flood Hotspots">
          <>
            {hotspots.map((hotspot) => (
              <CircleMarker
                key={hotspot.hotspot_id}
                center={[hotspot.latitude, hotspot.longitude]}
                radius={getMarkerRadius(hotspot)}
                pathOptions={{
                  color: getRiskColor(hotspot.risk_level),
                  fillColor: getRiskColor(hotspot.risk_level),
                  fillOpacity: getMarkerOpacity(hotspot),
                  weight: getBorderWeight(hotspot.data_confidence),
                  dashArray: getDashArray(hotspot.data_confidence),
                }}
              >
                <Popup>
                  <HotspotPopup hotspot={hotspot} />
                </Popup>
              </CircleMarker>
            ))}
          </>
        </LayersControl.Overlay>

        <LayersControl.Overlay checked name="📍 Landmarks">
          <>
            {attractions.map((attraction) => (
              <Marker
                key={attraction.poi_id}
                position={[attraction.lat, attraction.lon]}
                icon={attractionIcon}
              >
                <Popup>
                  <AttractionPopup attraction={attraction} />
                </Popup>
              </Marker>
            ))}
          </>
        </LayersControl.Overlay>

        <LayersControl.Overlay checked name="⚡ Utility Outages">
          <>
            {utilities.map((util) => (
              <CircleMarker
                key={util.id}
                center={[util.lat, util.lon]}
                radius={8}
                pathOptions={{
                  color: util.utility_type === 'power' ? '#eab308' : util.utility_type === 'water' ? '#06b6d4' : '#8b5cf6',
                  fillColor: util.utility_type === 'power' ? '#eab308' : util.utility_type === 'water' ? '#06b6d4' : '#8b5cf6',
                  fillOpacity: 0.8,
                  weight: 2,
                  dashArray: util.status === 'scheduled_cut' ? '4 4' : undefined
                }}
              >
                <Popup>
                  <UtilityPopup utility={util} />
                </Popup>
              </CircleMarker>
            ))}
          </>
        </LayersControl.Overlay>

        <LayersControl.Overlay checked name="🚧 Roadworks">
          <>
            {roadworks.map((work) => (
              <CircleMarker
                key={work.id}
                center={[work.lat, work.lon]}
                radius={7}
                pathOptions={{
                  color: '#f97316',
                  fillColor: '#f97316',
                  fillOpacity: 0.8,
                  weight: 2
                }}
              >
                <Popup>
                  <RoadworkPopup work={work} />
                </Popup>
              </CircleMarker>
            ))}
          </>
        </LayersControl.Overlay>

        <LayersControl.Overlay checked name="👥 Citizen Reports">
          <>
            {reports.map((rep) => (
              <CircleMarker
                key={rep.id}
                center={[rep.lat, rep.lon]}
                radius={8}
                pathOptions={{
                  color: '#a855f7',
                  fillColor: '#a855f7',
                  fillOpacity: 0.8,
                  weight: 2
                }}
              >
                <Popup>
                  <ReportPopup report={rep} />
                </Popup>
              </CircleMarker>
            ))}
          </>
        </LayersControl.Overlay>
      </LayersControl>
    </MapContainer>
  );
}
