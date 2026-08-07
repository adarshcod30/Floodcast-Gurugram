/**
 * API types, mirroring backend/app/models/schemas.py.
 *
 * `data_confidence` is present on every hotspot type here and is never
 * optional. It travels from the CSV through the API into the UI, because
 * a user must always be able to tell a sourced hotspot from a
 * structural placeholder.
 */

export type RiskLevel = 'critical' | 'high' | 'moderate' | 'low';

export type Confidence =
  | 'confirmed_named_mcg_zone1'
  | 'confirmed_named_multi_source'
  | 'plausible_real_unconfirmed_flood_status'
  | 'reconstructed_estimate';

export type SeverityTier = 'hypercritical' | 'moderate' | 'minor';

export interface TimeWindow {
  starts_at: string;
  clears_by: string;
  duration_hours: number;
}

export interface Hotspot {
  hotspot_id: string;
  name: string;
  locality_area: string;
  zone: string;
  severity_tier: SeverityTier;
  latitude: number;
  longitude: number;
  road_type: string;
  commute_relevance: string;
  data_confidence: Confidence;
  source_note: string;
  coordinates_verified: string;
  risk_score: number;
  risk_level: RiskLevel;
  time_window: TimeWindow | null;
  intensity_ratio: number;
  forecast_intensity_mm_hr: number;
  threshold_mm_hr: number;
}

export interface HotspotsResponse {
  hotspots: Hotspot[];
  total: number;
  forecast_source: string;
  computed_at: string;
}

/** Landmarks. Deliberately carries no risk fields — never scored. */
export interface Attraction {
  poi_id: string;
  name: string;
  category: string;
  locality: string;
  lat: number;
  lon: number;
  source: string;
}

export interface AttractionsResponse {
  attractions: Attraction[];
  total: number;
}

export interface ForecastWindow {
  start_time: string;
  end_time: string;
  intensity_mm_per_hr: number;
  description: string;
}

export interface ForecastResponse {
  windows: ForecastWindow[];
  fetched_at: string;
  city: string;
  source: 'live' | 'cached' | 'fallback' | 'unavailable';
  provider: string;
  resolution_hours: number;
  attribution: string;
  notes: string[];
}

/** Per-hour risk, computed server-side so the client never re-derives it. */
export interface TimelineRisk {
  hotspot_id: string;
  risk_score: number;
  risk_level: RiskLevel;
  time_window: TimeWindow | null;
}

export interface TimelineFrame {
  hour_offset: number;
  start_time: string;
  intensity_mm_per_hr: number;
  description: string;
  episode_duration_hr: number;
  critical_count: number;
  at_risk_count: number;
  risks: TimelineRisk[];
}

export interface TimelineResponse {
  frames: TimelineFrame[];
  total_hours: number;
  forecast_source: string;
  computed_at: string;
}

export interface AirQualityResponse {
  available: boolean;
  aqi: number | null;
  category: string | null;
  advisory: string | null;
  dominant_pollutant: string | null;
  sub_indices: Record<string, number>;
  concentrations: Record<string, number>;
  basis: string;
  scale: string;
  fetched_at: string;
  attribution: string;
  source: string;
}

export interface HotspotReference {
  hotspot_id?: string;
  name: string;
  risk_score: number;
  risk_level: RiskLevel;
  data_confidence: Confidence;
  time_window?: TimeWindow | null;
}

export interface RouteAnalysis {
  origin: { name: string; lat?: number; lon?: number };
  destination: { name: string; lat?: number; lon?: number };
  corridor_buffer_km: number;
  total_distance_km: number;
  routing_method: string;
  disclaimer: string;
  hotspot_count: number;
  overall_risk_level: RiskLevel;
}

export interface ChatResponse {
  query: string;
  query_type: 'point' | 'route';
  verdict: string;
  method: string;
  forecast_summary?: string | null;
  forecast_used?: Record<string, unknown> | null;
  hotspots_referenced: HotspotReference[];
  route_analysis?: RouteAnalysis | null;
}

export interface CitizenReport {
  id: string;
  title: string;
  description: string;
  category: string;
  location_name: string;
  lat: number;
  lon: number;
  created_at: string;
  confirmations: number;
  age_hours: number;
}

export interface ReportsResponse {
  reports: CitizenReport[];
  total: number;
  active_window_hours: number;
  source: string;
}

export interface NewReport {
  title: string;
  description: string;
  category: string;
  location_name: string;
  lat: number;
  lon: number;
}

export interface DependencyStatus {
  healthy: boolean;
  error?: string | null;
  details?: Record<string, unknown> | null;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  dependencies: Record<string, DependencyStatus>;
  version: string;
}
