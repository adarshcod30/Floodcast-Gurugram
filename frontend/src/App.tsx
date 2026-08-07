import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CloudRain, AlertTriangle, Zap, Construction, Users, MessageSquare,
  Search, SlidersHorizontal, ChevronDown, ChevronUp, MapPin,
  Train, ArrowUpDown, PanelLeftClose, PanelLeftOpen, Activity, Clock,
  Droplets, Send
} from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, XAxis, Tooltip as RTooltip } from 'recharts';
import { api } from './hooks/useApi';
import type {
  Hotspot, Attraction, ForecastWindow, AqiResponse, RouteAnalysis, TransitStatusResponse,
  UtilityStatus, RoadworkZone, CitizenReport
} from './types';
import MapView from './components/Map/MapView';
import ChatPanel from './components/Chat/ChatPanel';
import LoadingOverlay from './components/Layout/LoadingOverlay';
import { getRiskColor } from './utils/riskColors';
import { getConfidenceStyle } from './utils/confidenceBadge';

// ── Sidebar animation ──
const sidebarAnim = {
  initial: { width: 0, opacity: 0 },
  animate: { width: 340, opacity: 1, transition: { type: 'spring' as const, damping: 28, stiffness: 300 } },
  exit: { width: 0, opacity: 0, transition: { duration: 0.2 } },
};

// ── Small helper components ──
function AqiRing({ value, color }: { value: number; color: string }) {
  const r = 18, circ = 2 * Math.PI * r, offset = circ - (value / 5) * circ;
  return (
    <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
      <svg width="48" height="48" className="transform -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3.5" />
        <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="3.5"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} className="progress-ring" />
      </svg>
      <span className="absolute mono text-xs font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

function RiskDot({ color }: { color: string }) {
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}50` }} />;
}

export default function App() {
  // ── State ──
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [forecast, setForecast] = useState<ForecastWindow[]>([]);
  const [forecastSource, setForecastSource] = useState<string>('unknown');
  const [aqi, setAqi] = useState<AqiResponse | null>(null);
  const [activeRoute, setActiveRoute] = useState<RouteAnalysis | null>(null);
  const [transit, setTransit] = useState<TransitStatusResponse | null>(null);
  const [isTransitOpen, setIsTransitOpen] = useState(false);

  const [utilities, setUtilities] = useState<UtilityStatus[]>([]);
  const [roadworks, setRoadworks] = useState<RoadworkZone[]>([]);
  const [reports, setReports] = useState<CitizenReport[]>([]);
  const [activeTab, setActiveTab] = useState<'risks' | 'outages' | 'community'>('risks');

  const [repTitle, setRepTitle] = useState('');
  const [repDesc, setRepDesc] = useState('');
  const [repCategory, setRepCategory] = useState<'hazard' | 'roadblock' | 'info'>('hazard');
  const [repLoc, setRepLoc] = useState('');
  const [repLat, setRepLat] = useState(28.459);
  const [repLon, setRepLon] = useState(77.072);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);

  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState('Connecting…');
  const [isColdStart, setIsColdStart] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [confFilter, setConfFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'risk' | 'name'>('risk');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [simHour, setSimHour] = useState(0);

  // ── Data fetching ──
  const fetchData = async () => {
    try {
      setServerError(null);
      const timer = setTimeout(() => { setIsColdStart(true); setStatusText('Waking up the server…'); }, 3000);
      const health = await api.getHealth();
      clearTimeout(timer);
      setIsColdStart(false);
      if (health.status === 'unhealthy') throw new Error('Backend unhealthy');

      setStatusText('Loading intelligence data…');
      const [h, a, f, aq, t, u, rw, rp] = await Promise.all([
        api.getHotspots(), api.getAttractions(), api.getForecast(), api.getAqi(),
        api.getTransit(), api.getUtilities(), api.getRoadworks(), api.getReports()
      ]);

      setHotspots(h.hotspots); setAttractions(a.attractions);
      setForecast(f.windows); setForecastSource(f.source);
      setAqi(aq); setTransit(t);
      setUtilities(u.utilities); setRoadworks(rw.roadworks); setReports(rp.reports);

      if (t.lines.some((l: any) => l.delay_minutes > 0 || l.status.toLowerCase().includes('delay'))) setIsTransitOpen(true);
      setLoading(false);
    } catch (err: any) {
      console.error(err);
      setServerError(err.message || 'Connection failed');
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); const iv = setInterval(fetchData, 120000); return () => clearInterval(iv); }, []);

  // ── Report handlers ──
  const submitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repTitle.trim() || !repDesc.trim() || !repLoc.trim()) return;
    setIsSubmitting(true);
    try {
      const nr = await api.postReport({ title: repTitle, description: repDesc, category: repCategory, location_name: repLoc, lat: repLat, lon: repLon });
      setReports(p => [nr, ...p]);
      setRepTitle(''); setRepDesc(''); setRepLoc(''); setShowReportForm(false);
    } catch { alert('Submit failed'); }
    finally { setIsSubmitting(false); }
  };

  const verifyReport = async (id: string) => {
    try { const u = await api.verifyReport(id); setReports(p => p.map(r => r.id === id ? u : r)); } catch {}
  };

  // ── Simulation ──
  const getSimHotspots = (): Hotspot[] => {
    if (simHour === 0 || !forecast.length) return hotspots;
    const fw = forecast[simHour] || forecast[0];
    const intensity = fw.intensity_mm_per_hr;
    return hotspots.map(h => {
      const ratio = intensity / (h.threshold_mm_hr || 2);
      const score = Math.min(1, ratio);
      const level: Hotspot['risk_level'] = score >= 0.75 ? 'critical' : score >= 0.5 ? 'high' : score >= 0.25 ? 'moderate' : 'low';
      return { ...h, risk_score: score, risk_level: level, forecast_intensity_mm_hr: intensity };
    });
  };

  const active = getSimHotspots();
  const filtered = active
    .filter(h => {
      const q = search.toLowerCase();
      return (h.name.toLowerCase().includes(q) || h.locality_area.toLowerCase().includes(q))
        && (tierFilter === 'all' || h.severity_tier === tierFilter)
        && (confFilter === 'all' || h.data_confidence === confFilter);
    })
    .sort((a, b) => sortBy === 'risk' ? b.risk_score - a.risk_score : a.name.localeCompare(b.name));

  const currentRain = forecast.find(w => { const n = Date.now(); return n >= new Date(w.start_time).getTime() && n <= new Date(w.end_time).getTime(); });
  const chartData = forecast.slice(0, 8).map(w => ({
    t: new Date(w.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', hour12: false }),
    v: parseFloat(w.intensity_mm_per_hr.toFixed(1)),
  }));

  const critCount = active.filter(h => h.risk_level === 'critical').length;
  const aqiVal = aqi?.aqi || 1;
  const aqiColor = aqiVal <= 2 ? '#22c55e' : aqiVal <= 3 ? '#eab308' : '#f43f5e';

  // ── Loading / Error ──
  if (loading) return <LoadingOverlay statusText={statusText} isColdStart={isColdStart} />;
  if (serverError) return (
    <div className="fixed inset-0 flex flex-col items-center justify-center p-6 text-center" style={{ background: 'var(--bg-base)' }}>
      <AlertTriangle className="w-10 h-10 text-rose-500 mb-4" />
      <h1 className="text-base font-bold text-white mb-1">Connection Failed</h1>
      <p className="text-sm text-zinc-400 max-w-sm mb-6">{serverError}</p>
      <button onClick={() => { setLoading(true); fetchData(); }}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition-colors cursor-pointer">
        Retry
      </button>
    </div>
  );

  // ═══════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════
  return (
    <div className="w-full h-full flex" style={{ background: 'var(--bg-base)' }}>

      {/* ─── LEFT SIDEBAR ─── */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside key="sb" {...sidebarAnim} className="h-full sidebar flex flex-col shrink-0 z-20 overflow-hidden">

            {/* Header */}
            <div className="px-4 py-3.5 flex items-center justify-between border-b" style={{ borderColor: 'var(--border-default)' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                  <Activity className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <h1 className="text-[13px] font-extrabold tracking-tight text-white leading-none">
                    Gurugram<span className="text-blue-400">Pulse</span>
                  </h1>
                  <p className="text-[10px] text-zinc-500 font-medium mt-0.5">Hyperlocal Risk Intelligence</p>
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Collapse sidebar">
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            {/* Stats strip */}
            <div className="px-4 py-2.5 flex gap-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
              {[
                { label: 'Zones', value: active.length, color: 'text-white' },
                { label: 'Critical', value: critCount, color: 'text-rose-400' },
                { label: 'Reports', value: reports.length, color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className="flex-1 card px-2.5 py-1.5 text-center">
                  <div className={`text-sm font-bold mono ${s.color}`}>{s.value}</div>
                  <div className="text-[10px] text-zinc-500 font-medium">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Weather row */}
            <div className="px-4 py-3 border-b space-y-2.5" style={{ borderColor: 'var(--border-default)' }}>
              <div className="flex gap-2.5">
                {/* Precipitation */}
                <div className="card flex-1 p-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <CloudRain className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wide">Rain</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold mono text-white leading-none">
                      {currentRain ? currentRain.intensity_mm_per_hr.toFixed(1) : '0.0'}
                    </span>
                    <span className="text-[10px] text-zinc-500 mono">mm/h</span>
                  </div>
                  <span className="text-[9px] text-zinc-600 mono mt-0.5 block" title={`Source: ${forecastSource}`}>
                    {currentRain ? currentRain.description : 'Clear skies'}
                  </span>
                </div>

                {/* AQI */}
                <div className="card flex-1 p-2.5 flex items-center gap-2.5">
                  <AqiRing value={aqiVal} color={aqiColor} />
                  <div>
                    <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wide block">AQI</span>
                    <span className="text-xs font-bold block" style={{ color: aqiColor }}>
                      {aqi?.label || 'Good'}
                    </span>
                    {aqi && (
                      <div className="flex gap-2 mt-1">
                        <span className="text-[9px] text-zinc-500 mono">PM2.5 <b className="text-zinc-300">{aqi.components.pm2_5}</b></span>
                        <span className="text-[9px] text-zinc-500 mono">PM10 <b className="text-zinc-300">{aqi.components.pm10}</b></span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sparkline */}
              {chartData.length > 0 && (
                <div className="h-14 -mx-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="t" tick={{ fill: '#52525b', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <RTooltip
                        contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, fontSize: 11, color: '#a1a1aa' }}
                        formatter={(v: any) => [`${v} mm/h`, 'Rain']}
                      />
                      <Area type="monotone" dataKey="v" stroke="#3b82f6" strokeWidth={1.5} fill="url(#rg)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="px-3 py-2 flex gap-1 border-b" style={{ borderColor: 'var(--border-default)', background: 'var(--bg-surface)' }}>
              {[
                { key: 'risks' as const, icon: MapPin, label: 'Flood Risks' },
                { key: 'outages' as const, icon: Zap, label: 'Outages' },
                { key: 'community' as const, icon: Users, label: 'Community' },
              ].map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.key} onClick={() => setActiveTab(t.key)}
                    className={`tab-pill flex-1 justify-center ${activeTab === t.key ? 'active' : ''}`}>
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-[11px]">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* ── Tab: Risks ── */}
            {activeTab === 'risks' && (
              <div className="flex-1 overflow-y-auto">
                {/* Search & Filters */}
                <div className="px-4 py-3 space-y-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                    <input type="text" placeholder="Search zones…" value={search} onChange={e => setSearch(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-600" />
                  </div>
                  <div className="flex items-center justify-between">
                    <button onClick={() => setFiltersOpen(!filtersOpen)}
                      className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors">
                      <SlidersHorizontal className="w-3 h-3" /> Filters {filtersOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    <button onClick={() => setSortBy(sortBy === 'risk' ? 'name' : 'risk')}
                      className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors">
                      <ArrowUpDown className="w-3 h-3" /> {sortBy === 'risk' ? 'Risk ↓' : 'A→Z'}
                    </button>
                  </div>
                  <AnimatePresence>
                    {filtersOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden">
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <select value={tierFilter} onChange={e => setTierFilter(e.target.value)}
                            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-zinc-300 cursor-pointer">
                            <option value="all">All severity</option>
                            <option value="hypercritical">Hypercritical</option>
                            <option value="moderate">Moderate</option>
                            <option value="minor">Minor</option>
                          </select>
                          <select value={confFilter} onChange={e => setConfFilter(e.target.value)}
                            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-zinc-300 cursor-pointer">
                            <option value="all">All sources</option>
                            <option value="confirmed_named_mcg_zone1">MCG Verified</option>
                            <option value="confirmed_named_multi_source">Multi-source</option>
                            <option value="plausible_real_unconfirmed_flood_status">Watchlist</option>
                            <option value="reconstructed_estimate">Estimate</option>
                          </select>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Transit alerts */}
                {transit && (
                  <div className="mx-4 mt-3">
                    <button onClick={() => setIsTransitOpen(!isTransitOpen)}
                      className="w-full flex items-center justify-between px-3 py-2 card text-xs font-semibold text-zinc-300 hover:text-white cursor-pointer">
                      <span className="flex items-center gap-2"><Train className="w-3.5 h-3.5 text-blue-400" /> Metro & Bus</span>
                      {isTransitOpen ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                    </button>
                    <AnimatePresence>
                      {isTransitOpen && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden">
                          <div className="card mt-1 p-3 space-y-2 text-[11px]">
                            <p className="text-amber-400 font-semibold flex gap-1.5 items-start text-[11px]">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {transit.summary}
                            </p>
                            {transit.lines.map((l, i) => (
                              <div key={i} className="flex items-center justify-between">
                                <span className="font-medium text-zinc-300">{l.name}</span>
                                <span className={`text-[10px] font-semibold mono px-1.5 py-0.5 rounded ${
                                  l.status.toLowerCase().includes('good') || l.status.toLowerCase().includes('normal')
                                    ? 'text-emerald-400 bg-emerald-500/10' : 'text-amber-400 bg-amber-500/10'
                                }`}>{l.status.split(' ')[0]}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}

                {/* Hotspot list */}
                <div className="px-4 py-3 space-y-2">
                  {filtered.length === 0 ? (
                    <p className="text-center py-8 text-sm text-zinc-600">No matching zones</p>
                  ) : filtered.map(h => {
                    const conf = getConfidenceStyle(h.data_confidence);
                    const color = getRiskColor(h.risk_level);
                    return (
                      <div key={h.hotspot_id} className="card card-interactive p-3 cursor-pointer">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-[12px] font-semibold text-zinc-200 leading-snug truncate">{h.name}</h3>
                            <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{h.locality_area}</p>
                          </div>
                          <span className="mono text-xs font-bold shrink-0" style={{ color }}>{(h.risk_score * 100).toFixed(0)}%</span>
                        </div>

                        <div className="flex items-center justify-between mt-2.5 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
                          <span className={`badge ${conf.className}`}>{conf.shortLabel}</span>
                          <span className="text-[10px] text-zinc-600 font-medium mono">{h.severity_tier}</span>
                        </div>

                        {h.time_window && (
                          <div className="flex items-center gap-1.5 mt-2 text-[10px] mono text-blue-400 bg-blue-500/8 px-2 py-1 rounded-md border border-blue-500/15">
                            <Clock className="w-3 h-3" />
                            {new Date(h.time_window.starts_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                            {' – '}
                            {new Date(h.time_window.clears_by).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Tab: Outages ── */}
            {activeTab === 'outages' && (
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {/* Utilities */}
                <div>
                  <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-400" /> Power & Water
                  </h3>
                  {utilities.length === 0 ? <p className="text-sm text-zinc-600 py-4 text-center">No active outages</p> : (
                    <div className="space-y-2">
                      {utilities.map(u => (
                        <div key={u.id} className="card p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                              {u.utility_type === 'power' ? <Zap className="w-3 h-3 text-amber-400" /> : <Droplets className="w-3 h-3 text-cyan-400" />}
                              {u.utility_type === 'power' ? 'Power' : 'Water'} — {u.sector_name}
                            </span>
                            <span className={`badge ${u.status === 'active_cut' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                              {u.status.replace('_', ' ')}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-500 leading-relaxed">{u.notes}</p>
                          {u.duration_hours && <p className="text-[10px] mono text-zinc-600 mt-1.5">Est. restore: ~{u.duration_hours}h</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Roadworks */}
                <div>
                  <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Construction className="w-3.5 h-3.5 text-orange-400" /> Roadworks
                  </h3>
                  {roadworks.length === 0 ? <p className="text-sm text-zinc-600 py-4 text-center">No construction delays</p> : (
                    <div className="space-y-2">
                      {roadworks.map(w => (
                        <div key={w.id} className="card p-3">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="text-xs font-semibold text-zinc-200">{w.location_name}</span>
                            <span className="badge bg-orange-500/10 text-orange-400 border border-orange-500/20 shrink-0">+{w.delay_minutes}m</span>
                          </div>
                          <p className="text-[10px] text-zinc-500 mono mb-1">{w.road_type} · {w.work_type.replace('_', ' ')}</p>
                          <p className="text-[11px] text-zinc-500">{w.notes}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab: Community ── */}
            {activeTab === 'community' && (
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-violet-400" /> Citizen Alerts
                  </h3>
                  <button onClick={() => setShowReportForm(!showReportForm)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg cursor-pointer transition-colors ${
                      showReportForm ? 'text-rose-400 bg-rose-500/10' : 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
                    }`}>
                    {showReportForm ? '✕ Cancel' : '+ Report'}
                  </button>
                </div>

                <AnimatePresence>
                  {showReportForm && (
                    <motion.form initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      onSubmit={submitReport} className="overflow-hidden">
                      <div className="card p-3 space-y-2.5">
                        <input required placeholder="Issue title" value={repTitle} onChange={e => setRepTitle(e.target.value)}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600" />
                        <div className="grid grid-cols-2 gap-2">
                          <select value={repCategory} onChange={e => setRepCategory(e.target.value as any)}
                            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-300 cursor-pointer">
                            <option value="hazard">Hazard</option><option value="roadblock">Roadblock</option><option value="info">Info</option>
                          </select>
                          <input required placeholder="Location" value={repLoc} onChange={e => setRepLoc(e.target.value)}
                            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-white placeholder-zinc-600" />
                        </div>
                        <textarea required rows={2} placeholder="Describe…" value={repDesc} onChange={e => setRepDesc(e.target.value)}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 resize-none" />
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" step="0.0001" required value={repLat} onChange={e => setRepLat(+e.target.value)}
                            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-white" placeholder="Lat" />
                          <input type="number" step="0.0001" required value={repLon} onChange={e => setRepLon(+e.target.value)}
                            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-white" placeholder="Lon" />
                        </div>
                        <button type="submit" disabled={isSubmitting}
                          className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors flex items-center justify-center gap-1.5">
                          <Send className="w-3 h-3" /> {isSubmitting ? 'Submitting…' : 'Submit'}
                        </button>
                      </div>
                    </motion.form>
                  )}
                </AnimatePresence>

                {reports.length === 0 ? <p className="text-sm text-zinc-600 py-4 text-center">No alerts yet</p> : (
                  <div className="space-y-2">
                    {reports.map(r => (
                      <div key={r.id} className="card p-3">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                            {r.category === 'hazard' ? <AlertTriangle className="w-3 h-3 text-amber-400" />
                              : r.category === 'roadblock' ? <Construction className="w-3 h-3 text-rose-400" />
                              : <MapPin className="w-3 h-3 text-blue-400" />}
                            {r.title}
                          </span>
                        </div>
                        <p className="text-[10px] text-zinc-600 mono">{r.location_name}</p>
                        <p className="text-[11px] text-zinc-400 mt-1">{r.description}</p>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
                          <span className="text-[10px] mono text-zinc-600">
                            {new Date(r.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                          </span>
                          <button onClick={() => verifyReport(r.id)}
                            className="text-[10px] font-semibold text-zinc-400 hover:text-white px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 cursor-pointer transition-colors">
                            👍 {r.upvotes} Verify
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ─── MAP + OVERLAYS ─── */}
      <div className="flex-1 h-full relative">
        {/* Map */}
        <div className="absolute inset-0 z-0">
          <MapView hotspots={active} attractions={attractions} utilities={utilities} roadworks={roadworks} reports={reports} activeRoute={activeRoute} />
        </div>

        {/* Sidebar toggle */}
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)}
            className="absolute z-10 top-3 left-3 glass w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer transition-colors"
            title="Open sidebar">
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        {/* Legend — top-left when sidebar closed, hidden when sidebar open */}
        {!sidebarOpen && (
          <div className="absolute z-10 top-14 left-3 glass p-3 text-[10px] space-y-1.5">
            <div className="text-[9px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Threat Levels</div>
            {[
              { label: 'Critical', color: 'var(--risk-critical)' },
              { label: 'High', color: 'var(--risk-high)' },
              { label: 'Moderate', color: 'var(--risk-moderate)' },
              { label: 'Low', color: 'var(--risk-low)' },
            ].map(r => (
              <div key={r.label} className="flex items-center gap-2 text-zinc-400 font-medium">
                <RiskDot color={r.color} /> {r.label}
              </div>
            ))}
          </div>
        )}

        {/* Timeline Scrubber — bottom center */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-full max-w-lg px-4">
          <div className="glass p-2.5">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-blue-400 animate-pulse-dot" /> Forecast Timeline
              </span>
              <span className="text-[10px] font-bold mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                {simHour === 0 ? 'LIVE' : `+${simHour}h`}
              </span>
            </div>
            <div className="flex gap-0.5 bg-zinc-950/50 p-0.5 rounded-lg">
              {forecast.slice(0, 8).map((w, i) => (
                <button key={i} onClick={() => setSimHour(i)}
                  className={`flex-1 py-1.5 text-center rounded-md transition-all cursor-pointer ${
                    i === simHour
                      ? 'bg-blue-600 text-white font-semibold shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                  }`}>
                  <div className="text-[10px] leading-none">{i === 0 ? 'Now' : new Date(w.start_time).toLocaleTimeString('en-IN', { hour: '2-digit', hour12: false }) + 'h'}</div>
                  <div className="text-[8px] mono mt-0.5 leading-none opacity-70">
                    {w.intensity_mm_per_hr > 0 ? `${w.intensity_mm_per_hr.toFixed(1)}` : '—'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chat FAB — top right */}
        {!chatOpen && (
          <button onClick={() => setChatOpen(true)}
            className="absolute top-3 right-3 z-20 glass w-10 h-10 flex items-center justify-center text-blue-400 hover:text-white cursor-pointer transition-all hover:scale-105 active:scale-95"
            title="Route AI Assistant">
            <MessageSquare className="w-4.5 h-4.5" />
          </button>
        )}
      </div>

      {/* ─── CHAT PANEL ─── */}
      <ChatPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} onRouteSelect={setActiveRoute} />
    </div>
  );
}
