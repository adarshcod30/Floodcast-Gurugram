"""Shared types for weather providers.

The contract is deliberately narrow: a provider is an async callable that
returns a ProviderResult or raises WeatherProviderError. It does no
caching, no fallback and no risk reasoning — those belong to the layer
above, so that provider code stays trivially testable against a recorded
API fixture.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from app.core.risk_engine import ForecastWindow


class WeatherProviderError(RuntimeError):
    """Raised when a provider cannot produce a usable forecast."""


@dataclass
class ProviderResult:
    """A normalised forecast from any provider."""

    windows: List[ForecastWindow]
    provider: str
    city: str = "Gurugram"
    #: Native resolution of each window, in hours. Open-Meteo gives 1h;
    #: OpenWeatherMap's free forecast gives 3h. Surfaced to the client so
    #: the UI can be honest about how granular the timeline really is.
    resolution_hours: float = 1.0
    attribution: str = ""
    notes: List[str] = field(default_factory=list)
