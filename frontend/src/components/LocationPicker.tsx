/**
 * Pick a spot on the map.
 *
 * This exists because requiring GPS was the wrong call. It shut out anyone
 * contributing from outside the city, and it assumed people only report
 * roads they are standing on, when in practice they want to flag one they
 * drove through an hour ago.
 *
 * Bounded to Gurugram, so a report cannot be dropped somewhere the tool
 * does not cover and then rejected by the database after the photo was
 * already taken.
 */

import { useEffect, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { inGurugram } from '../lib/reports';

const CENTRE: [number, number] = [28.4595, 77.0266];
/** Tighter than the map view's NCR bounds: a report must land in Gurugram. */
const BOUNDS: [[number, number], [number, number]] = [
  [28.30, 76.80],
  [28.60, 77.25],
];

const pinIcon = L.divIcon({
  className: '',
  html:
    '<div style="width:15px;height:15px;border-radius:50%;background:#E3B12C;' +
    'border:2.5px solid #0E1417;box-shadow:0 0 0 2px rgba(227,177,44,0.35)"></div>',
  iconSize: [15, 15],
  iconAnchor: [7.5, 7.5],
});

function ClickToPlace({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      if (inGurugram(lat, lng)) onPick(lat, lng);
    },
  });
  return null;
}

/** Leaflet caches container size at mount, and this map mounts inside a
 *  form that was hidden a moment earlier. */
function Resize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const fix = () => {
      if (el.clientWidth && el.clientHeight) map.invalidateSize({ animate: false });
    };
    fix();
    const ro = new ResizeObserver(fix);
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

interface Props {
  value: { lat: number; lon: number } | null;
  onChange: (lat: number, lon: number) => void;
}

export default function LocationPicker({ value, onChange }: Props) {
  const [pos, setPos] = useState<[number, number]>(
    value ? [value.lat, value.lon] : CENTRE,
  );

  useEffect(() => {
    if (value) setPos([value.lat, value.lon]);
  }, [value]);

  function place(lat: number, lon: number) {
    setPos([lat, lon]);
    onChange(lat, lon);
  }

  return (
    <div className="picker">
      <MapContainer
        center={pos}
        zoom={13}
        minZoom={11}
        maxZoom={18}
        maxBounds={BOUNDS}
        maxBoundsViscosity={1}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <Resize />
        <ClickToPlace onPick={place} />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          minZoom={11}
          maxZoom={18}
        />
        <Marker
          position={pos}
          icon={pinIcon}
          draggable
          eventHandlers={{
            dragend(e) {
              const { lat, lng } = (e.target as L.Marker).getLatLng();
              if (inGurugram(lat, lng)) place(lat, lng);
              else setPos(pos); // Snap back rather than accept an invalid spot.
            },
          }}
        />
      </MapContainer>
      <p className="picker-hint">Tap the map, or drag the pin, to mark where the water is.</p>
    </div>
  );
}
