/**
 * App shell.
 *
 * Reading order is the product's argument, top to bottom:
 *   verdict → timeline → detail
 * Answer first, the time axis that produced it second, supporting
 * evidence last. A user who reads only the first band has what they
 * came for.
 *
 * State note: this component holds NO scoring logic. The selected hour
 * indexes into server-computed timeline frames; risk values are read,
 * never derived.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import AboutPanel from './components/AboutPanel';
import AskPanel from './components/AskPanel';
import MapPanel from './components/MapPanel';
import RainTimeline from './components/RainTimeline';
import RegisterPanel from './components/RegisterPanel';
import ReportsPanel from './components/ReportsPanel';
import Verdict from './components/Verdict';
import { ApiError, api } from './lib/api';
import { clock } from './lib/display';
import type {
  AirQualityResponse,
  Attraction,
  CitizenReport,
  ForecastResponse,
  Hotspot,
  RiskLevel,
  TimelineFrame,
} from './types';

type Tab = 'map' | 'register' | 'ask' | 'reports' | 'about';

/** Forecast refresh interval. The backend caches hourly, so polling
 *  faster than this only moves bytes without moving numbers. */
const REFRESH_MS = 5 * 60 * 1000;

export default function App() {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [frames, setFrames] = useState<TimelineFrame[]>([]);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [aqi, setAqi] = useState<AirQualityResponse | null>(null);
  const [reports, setReports] = useState<CitizenReport[]>([]);

  const [hour, setHour] = useState(0);
  const [tab, setTab] = useState<Tab>('map');
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [showWatchlist, setShowWatchlist] = useState(true);

  const [phase, setPhase] = useState<'boot' | 'waking' | 'ready' | 'failed'>('boot');
  const [failure, setFailure] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    try {
      setReports((await api.reports()).reports);
    } catch {
      /* Reports are supplementary; their absence must not break the app. */
    }
  }, []);

  const load = useCallback(async (first: boolean) => {
    try {
      if (first) {
        setPhase('boot');
        // A slow /health means Render's free tier is waking a sleeping
        // service. Saying so beats a spinner that looks like a hang.
        await api.health(() => setPhase('waking'));
      }

      const [h, a, t, f, q] = await Promise.all([
        api.hotspots(),
        api.attractions(),
        api.timeline(),
        api.forecast(),
        api.airQuality(),
      ]);

      setHotspots(h.hotspots);
      setAttractions(a.attractions);
      setFrames(t.frames);
      setForecast(f);
      setAqi(q);
      setPhase('ready');
      setFailure(null);
      void loadReports();
    } catch (err) {
      // A failed refresh must not blank a working screen — only a failed
      // first load is fatal.
      if (first) {
        setFailure(err instanceof ApiError ? err.message : 'Could not reach the server.');
        setPhase('failed');
      }
    }
  }, [loadReports]);

  useEffect(() => {
    void load(true);
    const id = setInterval(() => void load(false), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Keep the selected hour valid when a refresh shortens the timeline.
  useEffect(() => {
    if (frames.length > 0 && hour >= frames.length) setHour(0);
  }, [frames, hour]);

  const frame = frames[hour] ?? frames[0] ?? null;

  /** Risk at the selected hour, keyed for O(1) lookup by map and list. */
  const riskAt = useMemo(() => {
    const m = new Map<
      string,
      { risk_level: RiskLevel; risk_score: number; time_window: { starts_at: string; clears_by: string } | null }
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

  const worst = frame?.risks.find((r) => r.risk_score > 0) ?? null;
  const worstName = worst ? hotspots.find((h) => h.hotspot_id === worst.hotspot_id)?.name ?? null : null;

  if (phase === 'boot' || phase === 'waking') {
    return (
      <div className="boot">
        <div className="boot-mark">FloodCast Gurugram</div>
        <div className="boot-gauge"><i /></div>
        <p className="boot-msg">
          {phase === 'waking'
            ? 'Waking the server. It sleeps when idle on the free tier, so the first request takes up to a minute.'
            : 'Reading the forecast and scoring 64 flood points…'}
        </p>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className="boot">
        <div className="boot-mark">FloodCast Gurugram</div>
        <p className="boot-msg">
          {failure} The risk engine runs on the server, so there is nothing to show until
          it responds.
        </p>
        <button className="btn" onClick={() => void load(true)}>
          Try again
        </button>
      </div>
    );
  }

  const stale =
    forecast?.source === 'unavailable' ? 'offline' : forecast?.source === 'fallback' ? 'true' : 'false';

  return (
    <div className="app">
      <header className="rail">
        <div className="rail-mark">
          FloodCast <span>Gurugram</span>
        </div>
        <div className="rail-spacer" />
        <div className="rail-stat">
          <span className="pulse" data-stale={stale} />
          {forecast?.source === 'unavailable'
            ? 'forecast unavailable'
            : `${forecast?.provider ?? 'forecast'} · ${forecast ? clock(forecast.fetched_at) : ''}`}
        </div>
      </header>

      <Verdict
        frame={frame}
        total={hotspots.length}
        worstName={worstName}
        worstWindow={worst?.time_window ?? null}
        aqi={{ value: aqi?.aqi ?? null, category: aqi?.category ?? null }}
      />

      <RainTimeline frames={frames} selected={hour} onSelect={setHour} />

      <nav className="tabs" role="tablist" aria-label="Views">
        {([
          ['map', 'Map', null],
          ['register', 'Register', hotspots.length],
          ['ask', 'Ask', null],
          ['reports', 'Reports', reports.length || null],
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
            attractions={attractions}
            riskAt={riskAt}
            showLandmarks={showLandmarks}
            showWatchlist={showWatchlist}
            onToggleLandmarks={() => setShowLandmarks((v) => !v)}
            onToggleWatchlist={() => setShowWatchlist((v) => !v)}
          />
        )}
        {tab === 'register' && <RegisterPanel hotspots={hotspots} riskAt={riskAt} />}
        {tab === 'ask' && <AskPanel />}
        {tab === 'reports' && <ReportsPanel reports={reports} onChanged={loadReports} />}
        {tab === 'about' && (
          <AboutPanel hotspots={hotspots} forecast={forecast} aqiBasis={aqi?.basis ?? null} />
        )}
      </main>
    </div>
  );
}
