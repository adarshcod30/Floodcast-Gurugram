"""
FloodCast Gurugram — Route Engine Tests
=========================================
Tests for the straight-line corridor matching and route aggregation logic.
"""

import pytest
from datetime import datetime

from app.core.route_engine import (
    haversine_distance,
    point_to_segment_distance_km,
    find_corridor_hotspots,
    analyze_route,
    corridor_summary_text,
)
from app.core.risk_engine import HotspotRisk, TimeWindow


@pytest.fixture
def reference_time():
    return datetime(2026, 7, 15, 14, 0, 0)


@pytest.fixture
def sample_risks(reference_time):
    """Sample scored risks for testing corridor matching."""
    return [
        HotspotRisk(
            hotspot_id="FCG-014",
            name="IFFCO Chowk",
            latitude=28.4595,
            longitude=77.0724,
            severity_tier="hypercritical",
            data_confidence="confirmed_named_multi_source",
            risk_score=0.8,
            risk_level="critical",
            time_window=TimeWindow(
                starts_at=reference_time,
                clears_by=datetime(2026, 7, 15, 18, 0, 0),
            ),
        ),
        HotspotRisk(
            hotspot_id="FCG-029",
            name="Cyber City",
            latitude=28.495,
            longitude=77.089,
            severity_tier="moderate",
            data_confidence="confirmed_named_multi_source",
            risk_score=0.4,
            risk_level="moderate",
            time_window=TimeWindow(
                starts_at=reference_time,
                clears_by=datetime(2026, 7, 15, 17, 0, 0),
            ),
        ),
        HotspotRisk(
            hotspot_id="FCG-018",
            name="Hero Honda Chowk",
            latitude=28.363,
            longitude=76.952,
            severity_tier="hypercritical",
            data_confidence="confirmed_named_multi_source",
            risk_score=0.9,
            risk_level="critical",
            time_window=TimeWindow(
                starts_at=reference_time,
                clears_by=datetime(2026, 7, 15, 20, 0, 0),
            ),
        ),
    ]


class TestHaversine:
    def test_same_point(self):
        """Distance from a point to itself is 0."""
        assert haversine_distance(28.46, 77.07, 28.46, 77.07) == pytest.approx(0.0)

    def test_known_distance(self):
        """IFFCO Chowk to Cyber City ~4-5 km."""
        dist = haversine_distance(28.4595, 77.0724, 28.495, 77.089)
        assert 3.0 < dist < 6.0  # Approximate

    def test_symmetry(self):
        """Distance A→B == B→A."""
        d1 = haversine_distance(28.4595, 77.0724, 28.495, 77.089)
        d2 = haversine_distance(28.495, 77.089, 28.4595, 77.0724)
        assert d1 == pytest.approx(d2, abs=0.001)


class TestPointToSegment:
    def test_point_on_segment(self):
        """A point on the line segment should have ~0 distance."""
        # Midpoint of a segment
        dist = point_to_segment_distance_km(
            28.46, 77.07,  # Point (approximate midpoint)
            28.45, 77.06,  # Segment start
            28.47, 77.08,  # Segment end
        )
        assert dist < 0.5  # Should be very close

    def test_point_far_from_segment(self):
        """A point far from the segment should have large distance."""
        dist = point_to_segment_distance_km(
            28.363, 76.952,  # Hero Honda Chowk (far south-west)
            28.4595, 77.0724,  # IFFCO Chowk
            28.495, 77.089,  # Cyber City
        )
        assert dist > 10.0  # Should be far away

    def test_same_start_end(self):
        """When segment is a single point, distance is to that point."""
        dist = point_to_segment_distance_km(
            28.495, 77.089,
            28.4595, 77.0724,
            28.4595, 77.0724,
        )
        assert dist > 0


class TestCorridorMatching:
    def test_finds_hotspots_on_corridor(self, sample_risks):
        """Should find hotspots within buffer of the corridor."""
        # IFFCO Chowk to Cyber City — IFFCO Chowk should be on corridor
        corridor = find_corridor_hotspots(
            28.4595, 77.0724,  # IFFCO Chowk (origin)
            28.495, 77.089,   # Cyber City (dest)
            sample_risks,
            buffer_km=2.0,
        )
        names = [h.name for h in corridor]
        assert "IFFCO Chowk" in names

    def test_excludes_far_hotspots(self, sample_risks):
        """Hero Honda Chowk should not be on IFFCO→Cyber City corridor."""
        corridor = find_corridor_hotspots(
            28.4595, 77.0724,
            28.495, 77.089,
            sample_risks,
            buffer_km=1.5,
        )
        names = [h.name for h in corridor]
        assert "Hero Honda Chowk" not in names

    def test_sorted_by_risk_descending(self, sample_risks):
        """Results should be sorted by risk score, worst first."""
        corridor = find_corridor_hotspots(
            28.4595, 77.0724,
            28.495, 77.089,
            sample_risks,
            buffer_km=5.0,  # Wide buffer to include more
        )
        for i in range(len(corridor) - 1):
            assert corridor[i].risk_score >= corridor[i + 1].risk_score


class TestAnalyzeRoute:
    def test_returns_corridor_result(self, sample_risks):
        result = analyze_route(
            "IFFCO Chowk", 28.4595, 77.0724,
            "Cyber City", 28.495, 77.089,
            sample_risks, buffer_km=2.0,
        )
        assert result.origin_name == "IFFCO Chowk"
        assert result.destination_name == "Cyber City"
        assert result.routing_method == "straight_line_corridor"
        assert result.disclaimer  # Non-empty disclaimer

    def test_worst_risk_identified(self, sample_risks):
        result = analyze_route(
            "IFFCO Chowk", 28.4595, 77.0724,
            "Cyber City", 28.495, 77.089,
            sample_risks, buffer_km=5.0,
        )
        if result.worst_risk:
            assert result.worst_risk.risk_score == max(
                h.risk_score for h in result.hotspots_on_corridor
            )

    def test_to_dict_has_disclaimer(self, sample_risks):
        result = analyze_route(
            "IFFCO Chowk", 28.4595, 77.0724,
            "Cyber City", 28.495, 77.089,
            sample_risks, buffer_km=2.0,
        )
        d = result.to_dict()
        assert "routing_method" in d
        assert d["routing_method"] == "straight_line_corridor"
        assert "disclaimer" in d


class TestCorridorSummary:
    def test_summary_includes_names(self, sample_risks):
        result = analyze_route(
            "IFFCO Chowk", 28.4595, 77.0724,
            "Cyber City", 28.495, 77.089,
            sample_risks, buffer_km=5.0,
        )
        text = corridor_summary_text(result)
        assert "IFFCO Chowk" in text
        assert "Cyber City" in text

    def test_empty_corridor_low_risk(self):
        """No hotspots = low risk message."""
        result = analyze_route(
            "Place A", 28.0, 77.0,
            "Place B", 28.0, 77.0,
            [], buffer_km=1.0,
        )
        text = corridor_summary_text(result)
        assert "No flood hotspots" in text or "Low risk" in text
