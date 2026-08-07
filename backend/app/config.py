"""
FloodCast Gurugram — Application Configuration
================================================
All secrets and tunables read from environment variables via Pydantic Settings.
Never hardcode credentials. See .env.example for the full list.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # --- OpenWeatherMap ---
    openweathermap_api_key: str = Field(
        default="",
        description="OpenWeatherMap API key for forecast data",
    )

    # --- AWS Bedrock ---
    aws_access_key_id: str = Field(default="", description="AWS access key")
    aws_secret_access_key: str = Field(default="", description="AWS secret key")
    aws_region: str = Field(default="us-east-1", description="AWS region for Bedrock")

    # Cost-tiered model selection — configurable without code changes
    bedrock_haiku_model_id: str = Field(
        default="anthropic.claude-3-5-haiku-20241022-v1:0",
        description="Fast/cheap model for routing, parsing, place-name resolution",
    )
    bedrock_sonnet_model_id: str = Field(
        default="anthropic.claude-sonnet-4-20250514-v1:0",
        description="Stronger model for final verdict synthesis",
    )

    # --- CORS ---
    allowed_origins: str = Field(
        default="http://localhost:5173",
        description="Comma-separated allowed CORS origins",
    )

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    # --- Rate limiting ---
    chat_rate_limit: str = Field(
        default="10/minute",
        description="Rate limit for /api/v1/chat endpoint",
    )

    # --- Gurugram coordinates for weather API ---
    gurugram_lat: float = Field(default=28.4595, description="Gurugram latitude")
    gurugram_lon: float = Field(default=77.0266, description="Gurugram longitude")

    # --- Weather cache ---
    weather_cache_ttl_seconds: int = Field(
        default=3600,
        description="TTL for weather forecast cache in seconds (default: 1 hour)",
    )

    # --- Route engine ---
    corridor_buffer_km: float = Field(
        default=1.5,
        description="Buffer distance in km for corridor matching",
    )

    # --- Data paths ---
    hotspots_parquet_path: str = Field(
        default="data/hotspots_extended.parquet",
        description="Path to the 64-row hotspots parquet file",
    )
    attractions_parquet_path: str = Field(
        default="data/attractions.parquet",
        description="Path to the 8-row attractions parquet file",
    )

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


# Singleton instance
settings = Settings()
