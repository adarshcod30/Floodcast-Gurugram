"""
FloodCast Gurugram — Risk Engine Tests
========================================
★ HIGHEST PRIORITY in the entire test suite. ★

These test the pure-function risk scoring logic with deterministic inputs
and expected outputs. No external dependencies, no network calls.
"""

import pytest
from datetime import datetime, timedelta

from app.core.risk_engine import (
    HotspotData,
    ForecastWindow,
    compute_hotspot_risk,
    compute_all_risks,
    compute_risks_multi_window,
    classify_risk_level,
    risk_summary_text,
    TIER_WEIGHTS,
)


# ---------------------------------------------------------------------------
# Test fixtures — representative hotspots from the real dataset
# ---------------------------------------------------------------------------

@pytest.fixture
def hypercritical_hotspot():
    """IFFCO Chowk — hypercritical tier, low drainage."""
    return HotspotData(
        hotspot_id="FCG-014",
        name="IFFCO Chowk",
        locality_area="NH-48 corridor",
        zone="Zone 2",
        severity_tier="hypercritical",
        latitude=28.4595,
        longitude=77.0724,
        road_type="NH-48 major junction",
        commute_relevance="High",
        data_confidence="confirmed_named_multi_source",
        source_note="Business Standard (2025), NewsX (2024)",
        coordinates_verified="No",
        rainfall_threshold_mm_per_hr=20.5,
        time_to_flood_after_threshold_min=33,
        typical_drain_time_hr=5.1,
        drainage_capacity_score=0.26,
    )


@pytest.fixture
def moderate_hotspot():
    """Cyber City — moderate tier, medium drainage."""
    return HotspotData(
        hotspot_id="FCG-029",
        name="Cyber City",
        locality_area="DLF, North Gurugram",
        zone="Zone 2",
        severity_tier="moderate",
        latitude=28.495,
        longitude=77.089,
        road_type="commercial arterial",
        commute_relevance="High",
        data_confidence="confirmed_named_multi_source",
        source_note="NewsX (2024)",
        coordinates_verified="No",
        rainfall_threshold_mm_per_hr=28.1,
        time_to_flood_after_threshold_min=68,
        typical_drain_time_hr=1.8,
        drainage_capacity_score=0.56,
    )


@pytest.fixture
def minor_hotspot():
    """Sector 49 Internal Road — minor tier, good drainage."""
    return HotspotData(
        hotspot_id="FCG-035",
        name="Sector 49 Internal Road",
        locality_area="South Gurugram",
        zone="Zone 2",
        severity_tier="minor",
        latitude=28.408,
        longitude=77.062,
        road_type="internal road",
        commute_relevance="Low",
        data_confidence="reconstructed_estimate",
        source_note="Placeholder",
        coordinates_verified="No",
        rainfall_threshold_mm_per_hr=54.4,
        time_to_flood_after_threshold_min=118,
        typical_drain_time_hr=1.3,
        drainage_capacity_score=0.67,
    )


@pytest.fixture
def reference_time():
    """Fixed reference time for deterministic tests."""
    return datetime(2026, 7, 15, 14, 0, 0)  # 2:00 PM


# ---------------------------------------------------------------------------
# Test: Below-threshold = no risk
# ---------------------------------------------------------------------------

class TestBelowThreshold:
    def test_zero_rainfall(self, hypercritical_hotspot, reference_time):
        """Zero rainfall = zero risk for any hotspot."""
        risk = compute_hotspot_risk(hypercritical_hotspot, 0.0, 0.0, reference_time)
        assert risk.risk_score == 0.0
        assert risk.risk_level == "low"
        assert risk.time_window is None

    def test_below_threshold_rainfall(self, hypercritical_hotspot, reference_time):
        """Rainfall below threshold = zero risk."""
        risk = compute_hotspot_risk(
            hypercritical_hotspot,
            forecast_intensity_mm_hr=10.0,  # Below 20.5 threshold
            forecast_duration_hr=3.0,
            reference_time=reference_time,
        )
        assert risk.risk_score == 0.0
        assert risk.risk_level == "low"
        assert risk.time_window is None

    def test_just_below_threshold(self, hypercritical_hotspot, reference_time):
        """Rainfall just barely below threshold = still zero risk."""
        risk = compute_hotspot_risk(
            hypercritical_hotspot,
            forecast_intensity_mm_hr=20.4,  # Just below 20.5
            forecast_duration_hr=2.0,
            reference_time=reference_time,
        )
        assert risk.risk_score == 0.0
        assert risk.risk_level == "low"


# ---------------------------------------------------------------------------
# Test: At/above threshold = positive risk with time window
# ---------------------------------------------------------------------------

class TestAboveThreshold:
    def test_at_threshold(self, hypercritical_hotspot, reference_time):
        """Rainfall exactly at threshold = nonzero risk with time window."""
        risk = compute_hotspot_risk(
            hypercritical_hotspot,
            forecast_intensity_mm_hr=20.5,  # Exactly at threshold
            forecast_duration_hr=2.0,
            reference_time=reference_time,
        )
        assert risk.risk_score > 0.0
        assert risk.risk_level != "low"
        assert risk.time_window is not None
        assert risk.time_window.starts_at > reference_time
        assert risk.time_window.clears_by > risk.time_window.starts_at

    def test_above_threshold_has_time_window(self, hypercritical_hotspot, reference_time):
        """Above-threshold risk MUST include a time window."""
        risk = compute_hotspot_risk(
            hypercritical_hotspot,
            forecast_intensity_mm_hr=40.0,
            forecast_duration_hr=3.0,
            reference_time=reference_time,
        )
        assert risk.risk_score > 0.0
        assert risk.time_window is not None
        assert risk.time_window.starts_at is not None
        assert risk.time_window.clears_by is not None

    def test_data_confidence_preserved(self, hypercritical_hotspot, reference_time):
        """data_confidence must be preserved in the risk output."""
        risk = compute_hotspot_risk(
            hypercritical_hotspot, 30.0, 2.0, reference_time
        )
        assert risk.data_confidence == "confirmed_named_multi_source"

    def test_minor_hotspot_data_confidence(self, minor_hotspot, reference_time):
        """Reconstructed estimate data_confidence preserved."""
        risk = compute_hotspot_risk(minor_hotspot, 60.0, 2.0, reference_time)
        assert risk.data_confidence == "reconstructed_estimate"


# ---------------------------------------------------------------------------
# Test: Intensity ratio scaling
# ---------------------------------------------------------------------------

class TestIntensityScaling:
    def test_higher_intensity_higher_risk(self, hypercritical_hotspot, reference_time):
        """2× threshold should produce higher risk than 1.1× threshold."""
        risk_low = compute_hotspot_risk(
            hypercritical_hotspot,
            forecast_intensity_mm_hr=20.5 * 1.1,
            forecast_duration_hr=2.0,
            reference_time=reference_time,
        )
        risk_high = compute_hotspot_risk(
            hypercritical_hotspot,
            forecast_intensity_mm_hr=20.5 * 2.0,
            forecast_duration_hr=2.0,
            reference_time=reference_time,
        )
        assert risk_high.risk_score > risk_low.risk_score

    def test_extreme_intensity_capped_at_one(self, hypercritical_hotspot, reference_time):
        """Risk score must never exceed 1.0, even with extreme rainfall."""
        risk = compute_hotspot_risk(
            hypercritical_hotspot,
            forecast_intensity_mm_hr=100.0,  # 5× threshold
            forecast_duration_hr=6.0,
            reference_time=reference_time,
        )
        assert risk.risk_score <= 1.0

    def test_intensity_ratio_stored(self, hypercritical_hotspot, reference_time):
        """Intensity ratio should be stored in the result."""
        risk = compute_hotspot_risk(
            hypercritical_hotspot,
            forecast_intensity_mm_hr=41.0,  # 2× threshold
            forecast_duration_hr=2.0,
            reference_time=reference_time,
        )
        assert risk.intensity_ratio == pytest.approx(2.0, abs=0.05)


# ---------------------------------------------------------------------------
# Test: Tier weight differences
# ---------------------------------------------------------------------------

class TestTierWeights:
    def test_hypercritical_higher_than_moderate(
        self, hypercritical_hotspot, moderate_hotspot, reference_time
    ):
        """At the same intensity ratio, hypercritical should score higher than moderate."""
        # Give both 1.5× their respective thresholds
        risk_hyper = compute_hotspot_risk(
            hypercritical_hotspot,
            hypercritical_hotspot.rainfall_threshold_mm_per_hr * 1.5,
            2.0, reference_time,
        )
        risk_mod = compute_hotspot_risk(
            moderate_hotspot,
            moderate_hotspot.rainfall_threshold_mm_per_hr * 1.5,
            2.0, reference_time,
        )
        assert risk_hyper.risk_score > risk_mod.risk_score

    def test_moderate_higher_than_minor(
        self, moderate_hotspot, minor_hotspot, reference_time
    ):
        """At the same intensity ratio, moderate should score higher than minor."""
        risk_mod = compute_hotspot_risk(
            moderate_hotspot,
            moderate_hotspot.rainfall_threshold_mm_per_hr * 1.5,
            2.0, reference_time,
        )
        risk_min = compute_hotspot_risk(
            minor_hotspot,
            minor_hotspot.rainfall_threshold_mm_per_hr * 1.5,
            2.0, reference_time,
        )
        assert risk_mod.risk_score > risk_min.risk_score


# ---------------------------------------------------------------------------
# Test: Drainage capacity modulation
# ---------------------------------------------------------------------------

class TestDrainageCapacity:
    def test_poor_drainage_higher_risk(self, reference_time):
        """Hotspot with worse drainage should score higher."""
        good_drainage = HotspotData(
            hotspot_id="T-001", name="Good Drainage", locality_area="Test",
            zone="Zone 1", severity_tier="moderate", latitude=28.45, longitude=77.0,
            road_type="test", commute_relevance="Medium",
            data_confidence="confirmed_named_multi_source", source_note="test",
            coordinates_verified="No",
            rainfall_threshold_mm_per_hr=25.0,
            time_to_flood_after_threshold_min=60,
            typical_drain_time_hr=2.0,
            drainage_capacity_score=0.8,  # Good drainage
        )
        poor_drainage = HotspotData(
            hotspot_id="T-002", name="Poor Drainage", locality_area="Test",
            zone="Zone 1", severity_tier="moderate", latitude=28.45, longitude=77.0,
            road_type="test", commute_relevance="Medium",
            data_confidence="confirmed_named_multi_source", source_note="test",
            coordinates_verified="No",
            rainfall_threshold_mm_per_hr=25.0,
            time_to_flood_after_threshold_min=60,
            typical_drain_time_hr=2.0,
            drainage_capacity_score=0.2,  # Poor drainage
        )

        risk_good = compute_hotspot_risk(good_drainage, 40.0, 2.0, reference_time)
        risk_poor = compute_hotspot_risk(poor_drainage, 40.0, 2.0, reference_time)

        assert risk_poor.risk_score > risk_good.risk_score


# ---------------------------------------------------------------------------
# Test: Time window computation
# ---------------------------------------------------------------------------

class TestTimeWindow:
    def test_flood_start_after_reference(self, hypercritical_hotspot, reference_time):
        """Flood should start after the reference time."""
        risk = compute_hotspot_risk(
            hypercritical_hotspot, 30.0, 2.0, reference_time
        )
        assert risk.time_window.starts_at > reference_time

    def test_flood_end_after_start(self, hypercritical_hotspot, reference_time):
        """Flood end must be after flood start."""
        risk = compute_hotspot_risk(
            hypercritical_hotspot, 30.0, 2.0, reference_time
        )
        assert risk.time_window.clears_by > risk.time_window.starts_at

    def test_heavier_rain_floods_faster(self, hypercritical_hotspot, reference_time):
        """Heavier rain should cause faster flooding (earlier start)."""
        risk_light = compute_hotspot_risk(
            hypercritical_hotspot, 22.0, 2.0, reference_time
        )
        risk_heavy = compute_hotspot_risk(
            hypercritical_hotspot, 60.0, 2.0, reference_time
        )
        assert risk_heavy.time_window.starts_at < risk_light.time_window.starts_at

    def test_duration_hours_positive(self, hypercritical_hotspot, reference_time):
        """Time window duration must be positive."""
        risk = compute_hotspot_risk(
            hypercritical_hotspot, 30.0, 2.0, reference_time
        )
        assert risk.time_window.duration_hours > 0


# ---------------------------------------------------------------------------
# Test: Batch scoring
# ---------------------------------------------------------------------------

class TestBatchScoring:
    def test_all_risks_sorted_descending(
        self, hypercritical_hotspot, moderate_hotspot, minor_hotspot, reference_time
    ):
        """compute_all_risks should return results sorted by risk_score descending."""
        hotspots = [minor_hotspot, hypercritical_hotspot, moderate_hotspot]
        risks = compute_all_risks(hotspots, 60.0, 3.0, reference_time)

        for i in range(len(risks) - 1):
            assert risks[i].risk_score >= risks[i + 1].risk_score

    def test_all_risks_preserves_count(
        self, hypercritical_hotspot, moderate_hotspot, minor_hotspot, reference_time
    ):
        """Should return one risk per hotspot."""
        hotspots = [hypercritical_hotspot, moderate_hotspot, minor_hotspot]
        risks = compute_all_risks(hotspots, 30.0, 2.0, reference_time)
        assert len(risks) == 3


# ---------------------------------------------------------------------------
# Test: Risk level classification
# ---------------------------------------------------------------------------

class TestRiskLevels:
    def test_critical_threshold(self):
        assert classify_risk_level(0.7) == "critical"
        assert classify_risk_level(1.0) == "critical"

    def test_high_threshold(self):
        assert classify_risk_level(0.5) == "high"
        assert classify_risk_level(0.69) == "high"

    def test_moderate_threshold(self):
        assert classify_risk_level(0.3) == "moderate"
        assert classify_risk_level(0.49) == "moderate"

    def test_low_threshold(self):
        assert classify_risk_level(0.0) == "low"
        assert classify_risk_level(0.29) == "low"


# ---------------------------------------------------------------------------
# Test: Summary text
# ---------------------------------------------------------------------------

class TestSummaryText:
    def test_low_risk_summary(self, hypercritical_hotspot, reference_time):
        risk = compute_hotspot_risk(hypercritical_hotspot, 5.0, 1.0, reference_time)
        text = risk_summary_text(risk)
        assert "Low risk" in text
        assert "IFFCO Chowk" in text

    def test_high_risk_includes_time(self, hypercritical_hotspot, reference_time):
        risk = compute_hotspot_risk(hypercritical_hotspot, 40.0, 3.0, reference_time)
        text = risk_summary_text(risk)
        assert "PM" in text or "AM" in text  # Time window present
        assert "IFFCO Chowk" in text

    def test_unconfirmed_includes_warning(self, minor_hotspot, reference_time):
        # Use high intensity to push past the minor tier's threshold and produce
        # a non-low risk so the summary includes the confidence warning
        risk = compute_hotspot_risk(minor_hotspot, 120.0, 5.0, reference_time)
        text = risk_summary_text(risk)
        assert "reconstructed" in text.lower()


# ---------------------------------------------------------------------------
# Test: to_dict serialization
# ---------------------------------------------------------------------------

class TestSerialization:
    def test_to_dict_keys(self, hypercritical_hotspot, reference_time):
        risk = compute_hotspot_risk(hypercritical_hotspot, 30.0, 2.0, reference_time)
        d = risk.to_dict()
        assert "hotspot_id" in d
        assert "risk_score" in d
        assert "risk_level" in d
        assert "time_window" in d
        assert "data_confidence" in d

    def test_to_dict_time_window_shape(self, hypercritical_hotspot, reference_time):
        risk = compute_hotspot_risk(hypercritical_hotspot, 30.0, 2.0, reference_time)
        d = risk.to_dict()
        tw = d["time_window"]
        assert tw is not None
        assert "starts_at" in tw
        assert "clears_by" in tw
        assert "duration_hours" in tw
