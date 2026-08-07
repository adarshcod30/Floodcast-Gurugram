"""
FloodCast Gurugram — Pydantic Models
======================================
Request/response schemas for all API endpoints. Input validation and
response shape enforcement via Pydantic.

GUARDRAILS:
  - AttractionResponse NEVER includes severity or risk fields
  - HotspotResponse ALWAYS includes data_confidence
  - ChatResponse ALWAYS includes hotspots_referenced for auditability
"""

from __future__ import annotations

from typing import Optional, List, Dict, Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class DependencyStatus(BaseModel):
    """Status of a single dependency."""
    healthy: bool
    error: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class HealthResponse(BaseModel):
    """Response shape for GET /health."""
    status: str = Field(description="Overall status: healthy | degraded | unhealthy")
    timestamp: str = Field(description="ISO timestamp")
    dependencies: Dict[str, DependencyStatus] = Field(
        description="Individual dependency checks"
    )
    version: str = Field(default="1.0.0")


# ---------------------------------------------------------------------------
# Hotspots
# ---------------------------------------------------------------------------

class TimeWindowResponse(BaseModel):
    """A risk time window."""
    starts_at: str = Field(description="ISO timestamp when flooding is estimated to start")
    clears_by: str = Field(description="ISO timestamp when flooding is estimated to clear")
    duration_hours: float = Field(description="Estimated flood duration in hours")


class HotspotResponse(BaseModel):
    """Response for a single hotspot — ALWAYS includes data_confidence."""
    hotspot_id: str
    name: str
    locality_area: str
    zone: str
    severity_tier: str = Field(description="hypercritical | moderate | minor")
    latitude: float
    longitude: float
    road_type: str
    commute_relevance: str = Field(description="High | Medium | Low")
    data_confidence: str = Field(
        description=(
            "Data provenance tier: confirmed_named_mcg_zone1 | "
            "confirmed_named_multi_source | plausible_real_unconfirmed_flood_status | "
            "reconstructed_estimate"
        )
    )
    source_note: str
    coordinates_verified: str

    # Computed risk fields
    risk_score: float = Field(default=0.0, description="0.0–1.0 risk score")
    risk_level: str = Field(default="low", description="critical | high | moderate | low")
    time_window: Optional[TimeWindowResponse] = Field(
        default=None,
        description="When flooding starts and clears — null if low risk",
    )
    intensity_ratio: float = Field(default=0.0, description="forecast / threshold ratio")
    forecast_intensity_mm_hr: float = Field(default=0.0)
    threshold_mm_hr: float = Field(default=0.0)


class HotspotsListResponse(BaseModel):
    """Response for GET /api/v1/hotspots."""
    hotspots: List[HotspotResponse]
    total: int
    forecast_source: str = Field(description="live | cached | fallback | unavailable")
    computed_at: str = Field(description="ISO timestamp when risks were computed")


# ---------------------------------------------------------------------------
# Attractions — NEVER has risk fields
# ---------------------------------------------------------------------------

class AttractionResponse(BaseModel):
    """Response for a single attraction POI — NO risk fields, ever."""
    poi_id: str
    name: str
    category: str
    locality: str
    lat: float
    lon: float
    source: str


class AttractionsListResponse(BaseModel):
    """Response for GET /api/v1/attractions."""
    attractions: List[AttractionResponse]
    total: int


# ---------------------------------------------------------------------------
# Forecast
# ---------------------------------------------------------------------------

class ForecastWindowResponse(BaseModel):
    """A single forecast time window."""
    start_time: str
    end_time: str
    intensity_mm_per_hr: float
    description: str = ""


class ForecastResponse(BaseModel):
    """Response for GET /api/v1/forecast."""
    windows: List[ForecastWindowResponse]
    fetched_at: str
    city: str
    source: str = Field(description="live | cached | fallback | unavailable")
    provider: str = Field(default="", description="Which upstream produced this forecast")
    resolution_hours: float = Field(
        default=1.0,
        description="Native window width. Surfaced so the UI can be honest about granularity.",
    )
    attribution: str = Field(default="", description="Required upstream attribution")
    notes: List[str] = Field(
        default_factory=list,
        description="Provider caveats that affect interpretation, e.g. averaging behaviour",
    )


# ---------------------------------------------------------------------------
# Timeline — server-computed hourly risk projection
# ---------------------------------------------------------------------------

class TimelineRisk(BaseModel):
    """One hotspot's risk at one future hour. Deliberately compact:
    static attributes already came from /hotspots and are not repeated."""
    hotspot_id: str
    risk_score: float
    risk_level: str
    time_window: Optional[TimeWindowResponse] = None


class TimelineFrameResponse(BaseModel):
    """Every hotspot's risk at one forecast hour."""
    hour_offset: int = Field(description="0 is the window covering now")
    start_time: str
    intensity_mm_per_hr: float
    description: str = ""
    episode_duration_hr: float = Field(
        description="Length of the contiguous rain episode beginning at this hour"
    )
    critical_count: int
    at_risk_count: int
    risks: List[TimelineRisk]


class TimelineResponse(BaseModel):
    """Response for GET /api/v1/timeline.

    Exists so the client never re-derives risk locally — a second scoring
    implementation in TypeScript would drift from the engine, and the two
    would disagree about the one number this product exists to state.
    """
    frames: List[TimelineFrameResponse]
    total_hours: int
    forecast_source: str
    computed_at: str


# ---------------------------------------------------------------------------
# Air quality — India CPCB National AQI
# ---------------------------------------------------------------------------

class AqiResponse(BaseModel):
    """Response for GET /api/v1/air-quality.

    Reports the CPCB National AQI (0-500) rather than a provider's own
    index, because that is the number Gurugram residents and officials
    actually use. `available` is false rather than a value being invented
    when upstream data is missing.
    """
    available: bool
    aqi: Optional[int] = Field(default=None, description="CPCB National AQI, 0-500")
    category: Optional[str] = Field(
        default=None, description="Good | Satisfactory | Moderate | Poor | Very Poor | Severe"
    )
    advisory: Optional[str] = Field(default=None, description="CPCB health advisory for the band")
    dominant_pollutant: Optional[str] = Field(
        default=None, description="Pollutant whose sub-index set the overall AQI"
    )
    sub_indices: Dict[str, int] = Field(
        default_factory=dict, description="Per-pollutant sub-index, for auditability"
    )
    concentrations: Dict[str, float] = Field(
        default_factory=dict, description="Concentrations used, in CPCB units"
    )
    basis: str = Field(default="", description="How the figure was derived, including caveats")
    scale: str = Field(default="CPCB National AQI (0-500)")
    fetched_at: str
    attribution: str = ""
    source: str = Field(description="live | cached | fallback | unavailable")



# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    """Request body for POST /api/v1/chat."""
    message: str = Field(
        ...,
        min_length=1,
        max_length=1000,
        description="Natural-language query about flood risk in Gurugram",
    )


class HotspotReference(BaseModel):
    """A hotspot referenced in the chat verdict — includes data_confidence for auditability."""
    hotspot_id: Optional[str] = None
    name: str
    risk_score: float
    risk_level: str
    data_confidence: str
    time_window: Optional[TimeWindowResponse] = None


class RouteAnalysisResponse(BaseModel):
    """Route analysis details included in chat response."""
    origin: Dict[str, Any]
    destination: Dict[str, Any]
    corridor_buffer_km: float
    total_distance_km: float
    routing_method: str = "straight_line_corridor"
    disclaimer: str
    hotspot_count: int
    overall_risk_level: str


class ChatResponse(BaseModel):
    """Response for POST /api/v1/chat — always auditable."""
    query: str
    query_type: str = Field(description="point | route")
    verdict: str = Field(description="Plain-English, time-windowed answer")
    method: str = Field(description="llm_sonnet | llm_raw | rule_based | rule_based_fallback")
    forecast_summary: Optional[str] = None
    forecast_used: Optional[Dict[str, Any]] = None
    hotspots_referenced: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Hotspots considered in this verdict, with data_confidence tiers",
    )
    route_analysis: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Route corridor analysis details (route queries only)",
    )


# ---------------------------------------------------------------------------
# Citizen reports — real submissions only, never seeded
# ---------------------------------------------------------------------------

class CitizenReportRequest(BaseModel):
    """Body for POST /api/v1/reports. Coordinates are bounded to the
    Gurugram district so the map cannot be polluted with junk pins."""
    title: str = Field(..., min_length=3, max_length=120)
    description: str = Field(..., min_length=10, max_length=600)
    category: str = Field(
        ...,
        description="waterlogging | road_blocked | drain_overflow | safe_passage",
    )
    location_name: str = Field(..., min_length=3, max_length=120)
    lat: float = Field(..., ge=28.20, le=28.70, description="Within Gurugram district bounds")
    lon: float = Field(..., ge=76.75, le=77.25, description="Within Gurugram district bounds")


class CitizenReportResponse(BaseModel):
    """A citizen report as returned by the API.

    Note there is no `confirmed_by` field: the internal model tracks
    hashed client identifiers to prevent double-confirmation, and that
    is an implementation detail, not something to publish.
    """
    id: str
    title: str
    description: str
    category: str
    location_name: str
    lat: float
    lon: float
    created_at: str
    confirmations: int = Field(description="Independent corroborations by other users")
    age_hours: float


class CitizenReportsListResponse(BaseModel):
    """Response for GET /api/v1/reports. An empty list is a truthful
    answer for a tool nobody has reported to yet — never seeded."""
    reports: List[CitizenReportResponse]
    total: int
    active_window_hours: int = Field(
        description="Reports older than this are dropped; flood conditions change hourly"
    )
    source: str = Field(default="citizen_submitted")

