"""CPCB National AQI computation.

Pure functions with published, checkable breakpoints — so these tests
assert against the CPCB scheme itself rather than against whatever the
implementation happens to return.
"""

from app.core.aqi import categorise, compute_aqi, mean_ignoring_none, sub_index


class TestSubIndex:
    def test_band_boundaries_map_to_index_boundaries(self):
        # PM2.5: 0-30 -> 0-50, 31-60 -> 51-100, 61-90 -> 101-200
        assert sub_index("pm2_5", 0) == 0
        assert sub_index("pm2_5", 30) == 50
        assert sub_index("pm2_5", 60) == 100
        assert sub_index("pm2_5", 90) == 200

    def test_interpolates_linearly_within_a_band(self):
        # Halfway through 0-30 should be halfway through 0-50.
        assert sub_index("pm2_5", 15) == 25

    def test_pm10_uses_its_own_breakpoints(self):
        # PM10's first band is twice as wide as PM2.5's, so the same
        # concentration must not produce the same sub-index.
        assert sub_index("pm10", 50) == 50
        assert sub_index("pm10", 30) != sub_index("pm2_5", 30)

    def test_co_is_read_in_milligrams(self):
        # CPCB specifies CO in mg/m3, unlike the others in ug/m3.
        assert sub_index("co", 1.0) == 50
        assert sub_index("co", 2.0) == 100

    def test_concentration_above_the_scale_clamps_to_500(self):
        assert sub_index("pm2_5", 10_000) == 500

    def test_unknown_pollutant_and_negative_reading_return_none(self):
        assert sub_index("lead", 10) is None
        assert sub_index("pm2_5", -5) is None


class TestCategories:
    def test_band_names_match_the_cpcb_scheme(self):
        assert categorise(25)[0] == "Good"
        assert categorise(75)[0] == "Satisfactory"
        assert categorise(150)[0] == "Moderate"
        assert categorise(250)[0] == "Poor"
        assert categorise(350)[0] == "Very Poor"
        assert categorise(450)[0] == "Severe"

    def test_every_band_carries_a_health_advisory(self):
        for value in (25, 75, 150, 250, 350, 450):
            assert categorise(value)[1]


class TestOverallAqi:
    def test_overall_is_the_worst_sub_index_not_the_average(self):
        """CPCB takes the maximum, deliberately.

        Averaging would let clean air on five pollutants hide a
        dangerous reading on the sixth.
        """
        result = compute_aqi({"pm2_5": 15, "pm10": 50, "no2": 300, "o3": 20})
        assert result is not None
        assert result.dominant_pollutant == "no2"
        assert result.aqi == max(result.sub_indices.values())

    def test_returns_none_without_a_particulate_reading(self):
        """CPCB requires PM2.5 or PM10. Refusing beats guessing."""
        assert compute_aqi({"no2": 50, "so2": 50, "o3": 50}) is None

    def test_returns_none_below_three_pollutants(self):
        assert compute_aqi({"pm2_5": 40, "no2": 50}) is None

    def test_reports_every_sub_index_for_auditability(self):
        result = compute_aqi({"pm2_5": 40, "pm10": 80, "no2": 50, "o3": 60})
        assert result is not None
        assert set(result.sub_indices) == {"pm2_5", "pm10", "no2", "o3"}

    def test_carries_its_basis_through_to_the_result(self):
        result = compute_aqi({"pm2_5": 40, "pm10": 80, "no2": 50}, basis="test basis")
        assert result is not None
        assert result.basis == "test basis"

    def test_serialises_with_readable_pollutant_labels(self):
        result = compute_aqi({"pm2_5": 40, "pm10": 80, "no2": 50})
        assert result is not None
        payload = result.to_dict()
        assert "PM2.5" in payload["sub_indices"]
        assert payload["scale"] == "CPCB National AQI (0-500)"


class TestMean:
    def test_ignores_gaps_in_the_series(self):
        assert mean_ignoring_none([10, None, 20]) == 15

    def test_all_missing_returns_none(self):
        assert mean_ignoring_none([None, None]) is None
        assert mean_ignoring_none([]) is None
