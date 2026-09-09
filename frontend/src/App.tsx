/**
 * App shell.
 *
 * Reading order is the product's argument, top to bottom:
 *   verdict -> timeline -> detail
 * Answer first, the time axis that produced it second, supporting evidence
 * last. Someone who reads only the first band has what they came for.
 *
 * There is no loading gate on the register any more. The 73 hotspots and the
 * 8 landmarks are compiled into the bundle, so the map and the list are on
 * screen before any network request is made. Only the rainfall numbers wait
 * on the network, and if that fails the locations still render, clearly
 * marked as having no forecast behind them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import AboutPanel from './components/AboutPanel';
import AskPanel from './components/AskPanel';
import MapPanel from './components/MapPanel';
import RainTimeline from './components/RainTimeline';
import ModeratePanel from './components/ModeratePanel';
import RegisterPanel from './components/RegisterPanel';
import ReportPanel from './components/ReportPanel';
import Simulate from './components/Simulate';
import Verdict from './components/Verdict';
import { clock } from './lib/display';
import {
  ATTRACTIONS, HOTSPOTS, loadAirQuality, loadSnapshot, simulate, type Snapshot,
} from './lib/store';
import type { AqiResult } from './lib/engine/aqi';
import type { Hotspot, RiskLevel, TimeWindow } from './types';

type Tab = 'map' | 'register' | 'ask' | 'report' | 'about';

/** Open-Meteo publishes hourly, so polling faster only moves bytes. */
const REFRESH_MS = 10 * 60 * 1000;

/** The register, rendered before any forecast exists. Risk fields read zero
 *  and the UI says why, rather than implying a computed all-clear. */
const UNSCORED: Hotspot[] = HOTSPOTS.map((h) => ({
  ...h,
  risk_score: 0,
  risk_level: 'low' as RiskLevel,
  time_window: null,
  intensity_ratio: 0,
  forecast_intensity_mm_hr: 0,
  threshold_mm_hr: h.rainfall_threshold_mm_per_hr,
}));

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [aqi, setAqi] = useState<AqiResult | null>(null);
  const [hour, setHour] = useState(0);
  const [tab, setTab] = useState<Tab>('map');
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showWatchlist, setShowWatchlist] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  /** Simulated rainfall in mm/hr, or null when showing the live forecast. */
  const [simulated, setSimulated] = useState<number | null>(null);

  // Moderation lives at #moderate rather than in the tab bar: it is for one
  // person, and a review queue in the main navigation would imply visitors
  // can see what is waiting. They cannot.
  const [moderating, setModerating] = useState(
    () => typeof window !== 'undefined' && window.location.hash === '#moderate',
  );
  useEffect(() => {
    const onHash = () => setModerating(window.location.hash === '#moderate');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setSnapshot(await loadSnapshot());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Air quality is secondary, so it never blocks the flood answer.
  useEffect(() => {
    void loadAirQuality().then(setAqi).catch(() => setAqi(null));
  }, []);

  // A simulation replaces the frames outright rather than merging into
  // them, so there is never a view that is half hypothetical and half real.
  const frames = useMemo(
    () => (simulated !== null ? simulate(simulated) : snapshot?.frames ?? []),
    [simulated, snapshot],
  );

  // Keep the selected hour valid when a refresh shortens the timeline.
  useEffect(() => {
    if (frames.length > 0 && hour >= frames.length) setHour(0);
  }, [frames, hour]);

  const frame = frames[hour] ?? frames[0] ?? null;

  /** Risk at the selected hour, keyed for O(1) lookup by map and list. */
  const riskAt = useMemo(() => {
    const m = new Map<
      string,
      { risk_level: RiskLevel; risk_score: number; time_window: TimeWindow | null }
    >();
    for (const r of frame?.risks ?? []) {
      m.set(r.hotspot_id, {
        risk_level: r.risk_level,
        risk_score: r.risk_score,
        time_window: r.time_window,
      });
    }
    return m;
  }, [frame]);

  /** Hotspots carrying the selected hour's risk, so scrubbing the timeline
   *  moves the map and the register together. */
  const hotspots = useMemo(() => {
    const base = snapshot?.hotspots ?? UNSCORED;
    if (!frame) return base;
    return base.map((h) => {
      const r = riskAt.get(h.hotspot_id);
      return r
        ? { ...h, risk_score: r.risk_score, risk_level: r.risk_level, time_window: r.time_window }
        : h;
    });
  }, [snapshot, frame, riskAt]);

  const worst = frame?.risks.find((r) => r.risk_score > 0) ?? null;
  const worstName = worst
    ? hotspots.find((h) => h.hotspot_id === worst.hotspot_id)?.name ?? null
    : null;

  const forecast = snapshot?.forecast ?? null;
  const stale =
    !forecast || forecast.source === 'unavailable'
      ? 'offline'
      : forecast.source === 'cached'
        ? 'true'
        : 'false';

  if (moderating) {
    return (
      <ModeratePanel
        onClose={() => {
          window.location.hash = '';
          setModerating(false);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="rail">
        <div className="rail-mark">
          FloodCast <span>Gurugram</span>
        </div>
        <div className="rail-spacer" />
        <button
          className="rail-stat"
          onClick={() => void load()}
          disabled={refreshing}
          title="Refresh the rainfall forecast"
        >
          <span className="pulse" data-stale={stale} />
          {refreshing
            ? 'refreshing'
            : !forecast
              ? 'reading forecast'
              : forecast.source === 'unavailable'
                ? 'forecast unavailable'
                : `${forecast.provider} · ${clock(forecast.fetched_at)}`}
        </button>
      </header>

      <Verdict
        frame={frame}
        total={hotspots.length}
        worstName={worstName}
        worstWindow={worst?.time_window ?? null}
        aqi={{ value: aqi?.aqi ?? null, category: aqi?.category ?? null }}
      />

      <RainTimeline frames={frames} selected={hour} onSelect={setHour} />

      <Simulate value={simulated} onChange={setSimulated} />

      <nav className="tabs" role="tablist" aria-label="Views">
        {([
          ['map', 'Map', null],
          ['register', 'Register', hotspots.length],
          ['ask', 'Ask', null],
          ['report', 'Report', null],
          ['about', 'What’s real', null],
        ] as const).map(([key, label, count]) => (
          <button
            key={key}
            role="tab"
            className="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key as Tab)}
          >
            {label}
            {count !== null && <span className="tab-count num">{count}</span>}
          </button>
        ))}
      </nav>

      <main className="view">
        {tab === 'map' && (
          <MapPanel
            hotspots={hotspots}
            attractions={ATTRACTIONS}
            riskAt={riskAt}
            showLandmarks={showLandmarks}
            showWatchlist={showWatchlist}
            onToggleLandmarks={() => setShowLandmarks((v) => !v)}
            onToggleWatchlist={() => setShowWatchlist((v) => !v)}
          />
        )}
        {tab === 'register' && <RegisterPanel hotspots={hotspots} riskAt={riskAt} />}
        {tab === 'ask' && <AskPanel snapshot={snapshot} />}
        {tab === 'report' && <ReportPanel />}
        {tab === 'about' && (
          <AboutPanel hotspots={hotspots} forecast={forecast} aqiBasis={aqi?.basis ?? null} />
        )}
      </main>
    </div>
  );
}
