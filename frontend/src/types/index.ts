/* TypeScript interfaces matching the API response schemas */

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
  severity_tier: 'hypercritical' | 'moderate' | 'minor';
  latitude: number;
  longitude: number;
  road_type: string;
  commute_relevance: 'High' | 'Medium' | 'Low';
  data_confidence:
    | 'confirmed_named_mcg_zone1'
    | 'confirmed_named_multi_source'
    | 'plausible_real_unconfirmed_flood_status'
    | 'reconstructed_estimate';
  source_note: string;
  coordinates_verified: string;
  risk_score: number;
  risk_level: 'critical' | 'high' | 'moderate' | 'low';
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
  source: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  data?: ChatResponseData;
}

export interface ChatResponseData {
  query: string;
  query_type: 'point' | 'route';
  verdict: string;
  method: string;
  forecast_summary?: string;
  forecast_used?: {
    intensity_mm_hr: number;
    duration_hr: number;
    source: string;
  };
  hotspots_referenced: HotspotReference[];
  route_analysis?: RouteAnalysis;
}

export interface HotspotReference {
  hotspot_id?: string;
  name: string;
  risk_score: number;
  risk_level: string;
  data_confidence: string;
  time_window?: TimeWindow;
}

export interface RouteAnalysis {
  origin: { name: string; lat: number; lon: number };
  destination: { name: string; lat: number; lon: number };
  corridor_buffer_km: number;
  total_distance_km: number;
  routing_method: string;
  disclaimer: string;
  hotspot_count: number;
  overall_risk_level: string;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  dependencies: Record<string, { healthy: boolean; error?: string }>;
  version: string;
}

export interface AqiResponse {
  aqi: number;
  label: string;
  components: Record<string, number>;
  fetched_at: string;
  source: string;
}

export interface TransitLineStatus {
  name: string;
  status: string;
  delay_minutes: number;
  notes: string;
}

export interface TransitStatusResponse {
  lines: TransitLineStatus[];
  summary: string;
  computed_at: string;
}

export interface UtilityStatus {
  id: string;
  sector_name: string;
  utility_type: 'power' | 'water' | 'gas';
  status: 'active_cut' | 'scheduled_cut' | 'normal';
  impact_level: 'High' | 'Medium' | 'Low';
  duration_hours: number | null;
  notes: string;
  lat: number;
  lon: number;
}

export interface UtilitiesListResponse {
  utilities: UtilityStatus[];
  total: number;
}

export interface RoadworkZone {
  id: string;
  location_name: string;
  road_type: string;
  work_type: 'digging' | 'flyover_construction' | 'maintenance';
  severity: 'High' | 'Medium' | 'Low';
  delay_minutes: number;
  notes: string;
  lat: number;
  lon: number;
}

export interface RoadworksListResponse {
  roadworks: RoadworkZone[];
  total: number;
}

export interface CitizenReport {
  id: string;
  title: string;
  description: string;
  category: 'hazard' | 'roadblock' | 'info';
  location_name: string;
  lat: number;
  lon: number;
  upvotes: number;
  created_at: string;
  verified_by_users: string[];
}

export interface CitizenReportsListResponse {
  reports: CitizenReport[];
  total: number;
}



