"""Application configuration.

Every secret and tunable is read from the environment via Pydantic
Settings. Nothing is hardcoded and nothing is committed — `.env.example`
is the template, `.env` is gitignored.

The design goal is that a fresh clone runs with **zero configuration**:
Open-Meteo needs no key, the risk engine is pure computation, and the
LLM layer degrades to deterministic rules when no AWS credentials are
present. Every setting below is an upgrade, not a prerequisite.
"""

from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Settings loaded from environment variables (see .env.example)."""

    # --- Weather ------------------------------------------------------
    weather_provider: str = Field(
        default="open-meteo",
        description="Preferred forecast provider: open-meteo | openweathermap",
    )
    openweathermap_api_key: str = Field(
        default="",
        description="Optional. Enables OpenWeatherMap as a provider; Open-Meteo needs no key.",
    )

    # --- AWS Bedrock --------------------------------------------------
    # Left blank, the chat endpoint runs its deterministic rule-based
    # pipeline instead of failing. See app/agents/fallback.py.
    aws_access_key_id: str = Field(default="", description="AWS access key ID")
    aws_secret_access_key: str = Field(default="", description="AWS secret access key")
    aws_session_token: str = Field(default="", description="Optional AWS session token")
    aws_region: str = Field(default="us-east-1", description="AWS region for Bedrock")

    # Cost-tiered model selection. Bedrock model IDs are the first-party
    # Claude IDs with an `anthropic.` prefix. Configurable so they can be
    # updated as new versions ship without touching code.
    bedrock_haiku_model_id: str = Field(
        default="anthropic.claude-haiku-4-5",
        description="Fast, cheap model for query routing and place-name resolution",
    )
    bedrock_sonnet_model_id: str = Field(
        default="anthropic.claude-sonnet-5",
        description="Stronger model for final verdict synthesis, where reasoning matters",
    )

    # --- CORS ---------------------------------------------------------
    allowed_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        description="Comma-separated allowed origins. Never a wildcard in production.",
    )

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    # --- Rate limiting ------------------------------------------------
    chat_rate_limit: str = Field(
        default="10/minute",
        description="Rate limit for /api/v1/chat — the only endpoint that costs money",
    )
    report_rate_limit: str = Field(
        default="5/hour",
        description="Rate limit for citizen report submission, to deter spam",
    )

    # --- Location -----------------------------------------------------
    gurugram_lat: float = Field(default=28.4595, description="Gurugram latitude")
    gurugram_lon: float = Field(default=77.0266, description="Gurugram longitude")

    # --- Caching ------------------------------------------------------
    weather_cache_ttl_seconds: int = Field(
        default=3600,
        description="Forecast cache TTL. /health never triggers a refresh.",
    )

    # --- Geocoding fallback -------------------------------------------
    # Only used for place names absent from the 64-hotspot and 8-landmark
    # tables. Nominatim's usage policy requires a real contact address and
    # returns 403 for placeholder domains, so set this before depending on
    # the fallback in production.
    nominatim_contact: str = Field(
        default="contact-unset@floodcast.invalid",
        description="Contact address sent in the Nominatim User-Agent header",
    )

    # --- Route engine -------------------------------------------------
    corridor_buffer_km: float = Field(
        default=1.5,
        description="How far from the straight-line path a hotspot still counts",
    )

    # --- Timeline -----------------------------------------------------
    timeline_hours: int = Field(
        default=8,
        description="How many forecast hours the risk timeline projects forward",
    )

    # --- Data paths ---------------------------------------------------
    hotspots_parquet_path: str = Field(
        default="data/hotspots_extended.parquet",
        description="Path to the 64-row hotspot register",
    )
    attractions_parquet_path: str = Field(
        default="data/attractions.parquet",
        description="Path to the 8-row landmark table (never risk-scored)",
    )
    reports_store_path: str = Field(
        default="var/citizen_reports.json",
        description="Disk location for citizen reports. Runtime state, never committed.",
    )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
