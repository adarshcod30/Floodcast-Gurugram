"""Weather provider parsing.

Both parsers are pure functions over a recorded response shape, so these
run without network access — which matters, because a test suite that
needs the internet fails in CI for reasons unrelated to the code.
"""

from datetime import datetime, timezone

import pytest

from app.core.providers import WeatherProviderError
from app.core.providers import open_meteo, open_weather

# A two-hour Open-Meteo response: one dry hour, one thunderstorm.
OPEN_METEO_FIXTURE = {
    "hourly": {
        "time": [1786000000, 1786003600],
        "precipitation": [0.0, 12.4],
        "precipitation_probability": [10, 95],
        "weather_code": [3, 95],
    }
}

# The equivalent from OpenWeatherMap: a single 3-hour bucket.
OPEN_WEATHER_FIXTURE = {
    "city": {"name": "Gurugram"},
    "list": [
        {
            "dt": 1786000000,
            "rain": {"3h": 12.0},
            "weather": [{"description": "heavy intensity rain"}],
        }
    ],
}


class TestOpenMeteo:
    def test_precipitation_is_already_an_hourly_rate(self):
        """Open-Meteo reports mm accumulated per hour.

        Each window is exactly one hour wide, so the value IS the mm/hr
        intensity — no division, and therefore none of the smearing that
        3-hourly sources introduce.
        """
        windows = open_meteo.parse_forecast(OPEN_METEO_FIXTURE)
        assert windows[1].intensity_mm_per_hr == 12.4

    def test_windows_are_one_hour_wide(self):
        windows = open_meteo.parse_forecast(OPEN_METEO_FIXTURE)
        span = windows[0].end_time - windows[0].start_time
        assert span.total_seconds() == 3600

    def test_times_are_timezone_aware_utc(self):
        """unixtime is requested precisely so there is no local-time
        parsing to get wrong."""
        windows = open_meteo.parse_forecast(OPEN_METEO_FIXTURE)
        assert windows[0].start_time.tzinfo is not None
        assert windows[0].start_time == datetime.fromtimestamp(1786000000, tz=timezone.utc)

    def test_translates_wmo_codes_to_readable_text(self):
        windows = open_meteo.parse_forecast(OPEN_METEO_FIXTURE)
        assert "Thunderstorm" in windows[1].description
        assert "95%" in windows[1].description

    def test_empty_response_raises_rather_than_returning_no_rain(self):
        """Missing data must not look like a confident all-clear."""
        with pytest.raises(WeatherProviderError):
            open_meteo.parse_forecast({"hourly": {"time": []}})


class TestOpenWeather:
    def test_three_hour_totals_are_converted_to_an_hourly_rate(self):
        windows = open_weather.parse_forecast(OPEN_WEATHER_FIXTURE)
        assert windows[0].intensity_mm_per_hr == pytest.approx(4.0)

    def test_windows_are_three_hours_wide(self):
        windows = open_weather.parse_forecast(OPEN_WEATHER_FIXTURE)
        span = windows[0].end_time - windows[0].start_time
        assert span.total_seconds() == 3 * 3600

    def test_resolution_difference_is_material(self):
        """The reason Open-Meteo is the default.

        The same 12 mm event reads as 12.4 mm/hr hourly but only 4 mm/hr
        when averaged across a 3-hour bucket — under the flooding
        threshold of every hypercritical hotspot in the register. Short,
        intense cloudbursts are exactly what floods Gurugram, and they
        are exactly what averaging hides.
        """
        hourly = open_meteo.parse_forecast(OPEN_METEO_FIXTURE)[1].intensity_mm_per_hr
        three_hourly = open_weather.parse_forecast(OPEN_WEATHER_FIXTURE)[0].intensity_mm_per_hr
        assert hourly > three_hourly * 3

    def test_missing_key_raises_rather_than_calling_out(self):
        with pytest.raises(WeatherProviderError):
            open_weather.parse_forecast({"list": []})


class TestAirQualityAveraging:
    def test_carbon_monoxide_is_converted_to_cpcb_units(self):
        """Open-Meteo reports CO in ug/m3; CPCB expects mg/m3."""
        raw = {
            "hourly": {
                "time": [1786000000],
                "pm2_5": [40.0],
                "pm10": [80.0],
                "carbon_monoxide": [2000.0],  # ug/m3
            }
        }
        out = open_meteo.average_last_24h(raw)
        assert out["co"] == pytest.approx(2.0)  # mg/m3
        assert out["pm2_5"] == pytest.approx(40.0)

    def test_empty_response_raises(self):
        with pytest.raises(WeatherProviderError):
            open_meteo.average_last_24h({"hourly": {"time": []}})
