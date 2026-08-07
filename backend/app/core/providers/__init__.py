"""Weather data providers.

Each provider converts a third-party API response into the same internal
shape (a list of ForecastWindow). The orchestration layer in
`app.core.weather` decides which provider to call and owns the cache, so
adding or swapping a provider never touches caching or risk-scoring code.
"""

from app.core.providers.base import ProviderResult, WeatherProviderError

__all__ = ["ProviderResult", "WeatherProviderError"]
