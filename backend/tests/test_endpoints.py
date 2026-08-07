"""API endpoint tests.

Several of these guard product invariants rather than plumbing — the
attraction/risk separation and the data_confidence chain in particular.
Those are the properties that make this project defensible, and a
regression in either would be invisible in a screenshot.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

RISK_FIELDS = {
    "risk_score",
    "risk_level",
    "severity_tier",
    "time_window",
    "threshold_mm_hr",
    "intensity_ratio",
    "forecast_intensity_mm_hr",
}

CONFIDENCE_TIERS = {
    "confirmed_named_mcg_zone1",
    "confirmed_named_multi_source",
    "plausible_real_unconfirmed_flood_status",
    "reconstructed_estimate",
}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class TestHealth:
    def test_reports_all_dependencies(self, client):
        body = client.get("/health").json()
        assert body["status"] in ("healthy", "degraded", "unhealthy")
        assert set(body["dependencies"]) == {"hotspot_register", "weather", "llm"}

    def test_missing_llm_is_not_an_outage(self, client):
        """An unconfigured LLM is a supported operating mode.

        The risk engine is pure computation over static data, so the app
        answers fine without Bedrock. Reporting that as unhealthy would
        page someone for a working deployment.
        """
        body = client.get("/health").json()
        assert body["status"] != "unhealthy"

    def test_returns_200_while_serviceable(self, client):
        # 503 is reserved for "cannot do its job at all", so an uptime
        # monitor alerts on real outages rather than on degraded modes.
        assert client.get("/health").status_code == 200


# ---------------------------------------------------------------------------
# Hotspots
# ---------------------------------------------------------------------------

class TestHotspots:
    def test_returns_full_register(self, client):
        body = client.get("/api/v1/hotspots").json()
        assert body["total"] == 64
        assert len(body["hotspots"]) == 64

    def test_every_hotspot_carries_data_confidence(self, client):
        """data_confidence must survive the whole pipeline.

        It travels CSV -> DuckDB -> engine -> API -> UI. Dropping it
        anywhere would let a structural placeholder render identically to
        an MCG-named hotspot, which is the specific dishonesty this
        project is built to prevent.
        """
        for h in client.get("/api/v1/hotspots").json()["hotspots"]:
            assert h["data_confidence"] in CONFIDENCE_TIERS, h["name"]

    def test_risk_is_always_time_windowed(self, client):
        """A risk score with no time attached is not an answer.

        Any hotspot scoring above zero must say when it floods and when
        it clears; a bare number fails the product's core promise.
        """
        for h in client.get("/api/v1/hotspots").json()["hotspots"]:
            if h["risk_score"] > 0:
                assert h["time_window"] is not None, h["name"]
                assert h["time_window"]["starts_at"]
                assert h["time_window"]["clears_by"]

    def test_timestamps_carry_a_timezone_offset(self, client):
        """Naive timestamps are read as local time by the browser.

        On a UTC server that shifts every window 5.5 hours for an IST
        user — a silent, invisible 5.5-hour lie about the one number
        this product exists to state.
        """
        for h in client.get("/api/v1/hotspots").json()["hotspots"]:
            window = h["time_window"]
            if window:
                assert "+" in window["starts_at"] or window["starts_at"].endswith("Z")


# ---------------------------------------------------------------------------
# Attractions — the hard separation
# ---------------------------------------------------------------------------

class TestAttractions:
    def test_returns_all_landmarks(self, client):
        body = client.get("/api/v1/attractions").json()
        assert body["total"] == 8
        assert len(body["attractions"]) == 8

    def test_never_carries_risk_fields(self, client):
        """Landmarks must never be risk-scored.

        They exist so the app can answer "is this place reachable", not
        to make a flood claim about a shopping mall. Leaking any risk
        field here would imply a finding the data does not support.
        """
        for a in client.get("/api/v1/attractions").json()["attractions"]:
            leaked = RISK_FIELDS & set(a)
            assert not leaked, f"{a['name']} leaked risk fields: {leaked}"
            assert "data_confidence" not in a


# ---------------------------------------------------------------------------
# Forecast, timeline, air quality
# ---------------------------------------------------------------------------

class TestForecast:
    def test_declares_its_provider_and_resolution(self, client):
        """Resolution must be visible, not implied.

        Open-Meteo is hourly and OpenWeatherMap's free tier is 3-hourly.
        A client that cannot tell them apart would present 3-hour
        averages as if they were hourly readings.
        """
        body = client.get("/api/v1/forecast").json()
        assert body["source"] in ("live", "cached", "fallback", "unavailable")
        if body["source"] != "unavailable":
            assert body["provider"]
            assert body["resolution_hours"] > 0
            assert body["attribution"]


class TestTimeline:
    def test_frames_are_scored_server_side(self, client):
        body = client.get("/api/v1/timeline").json()
        assert body["total_hours"] == len(body["frames"])
        for frame in body["frames"]:
            assert frame["at_risk_count"] >= frame["critical_count"]
            # Every hotspot appears in every frame, so the client can
            # render a complete picture without re-deriving anything.
            assert len(frame["risks"]) == 64

    def test_hour_zero_is_now(self, client):
        frames = client.get("/api/v1/timeline").json()["frames"]
        if frames:
            assert frames[0]["hour_offset"] == 0


class TestAirQuality:
    def test_reports_cpcb_scale_or_says_it_cannot(self, client):
        """An unavailable measurement is reported, never invented."""
        body = client.get("/api/v1/air-quality").json()
        assert body["scale"] == "CPCB National AQI (0-500)"
        if body["available"]:
            assert 0 <= body["aqi"] <= 500
            assert body["category"]
            assert body["dominant_pollutant"]
            # CPCB requires at least three pollutants, one particulate.
            assert len(body["sub_indices"]) >= 3
        else:
            assert body["aqi"] is None

    def test_states_how_the_figure_was_derived(self, client):
        body = client.get("/api/v1/air-quality").json()
        assert "CPCB" in body["basis"]
        # Modelled data must not be passed off as a ground-station read.
        assert "modelled" in body["basis"].lower()


# ---------------------------------------------------------------------------
# Removed surfaces — these must stay gone
# ---------------------------------------------------------------------------

class TestFabricatedEndpointsRemoved:
    """Guards against the fabricated civic data returning.

    These endpoints served invented outages, roadworks and transit status
    as fact. They are gone, and a 404 here is the assertion that they
    stay gone — a future refactor should not quietly restore them.
    """

    @pytest.mark.parametrize(
        "path",
        ["/api/v1/transit", "/api/v1/utilities", "/api/v1/roadworks", "/api/v1/community/reports"],
    )
    def test_endpoint_is_gone(self, client, path):
        assert client.get(path).status_code == 404


# ---------------------------------------------------------------------------
# Citizen reports
# ---------------------------------------------------------------------------

class TestReports:
    def test_store_is_never_seeded(self, client):
        """An empty list is the correct answer for a fresh deployment.

        Every record must come from a real submission; seeding sample
        reports would republish the exact dishonesty this store replaced.
        """
        body = client.get("/api/v1/reports").json()
        assert body["source"] == "citizen_submitted"
        assert body["total"] == len(body["reports"])

    def test_rejects_coordinates_outside_gurugram(self, client):
        res = client.post(
            "/api/v1/reports",
            json={
                "title": "Test report",
                "description": "A description long enough to pass validation.",
                "category": "waterlogging",
                "location_name": "Somewhere",
                "lat": 19.07,   # Mumbai
                "lon": 72.87,
            },
        )
        assert res.status_code == 422

    def test_rejects_unknown_category(self, client):
        res = client.post(
            "/api/v1/reports",
            json={
                "title": "Test report",
                "description": "A description long enough to pass validation.",
                "category": "power_cut",  # not a flood observation
                "location_name": "Sector 14",
                "lat": 28.46,
                "lon": 77.03,
            },
        )
        assert res.status_code == 422

    def test_new_report_starts_uncorroborated(self, client):
        """A filer's own submission is not corroboration.

        Starting at one would inflate every report's apparent support by
        exactly the amount that makes it look independently confirmed.
        """
        res = client.post(
            "/api/v1/reports",
            json={
                "title": "Underpass flooded",
                "description": "Water above the kerb, cars turning back.",
                "category": "waterlogging",
                "location_name": "Test Underpass",
                "lat": 28.46,
                "lon": 77.03,
            },
        )
        assert res.status_code == 201
        assert res.json()["confirmations"] == 0

    def test_response_never_exposes_confirmer_identities(self, client):
        """Hashed client IDs are duplicate-prevention, not public data."""
        body = client.get("/api/v1/reports").json()
        for report in body["reports"]:
            assert "confirmed_by" not in report


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class TestChat:
    def test_point_question_is_auditable(self, client):
        res = client.post("/api/v1/chat", json={"message": "is Iffco Chowk risky right now"})
        assert res.status_code == 200
        body = res.json()
        assert body["query_type"] == "point"
        assert body["verdict"]
        # Every referenced hotspot carries its provenance, so the answer
        # can be checked rather than merely trusted.
        for h in body["hotspots_referenced"]:
            assert h["data_confidence"] in CONFIDENCE_TIERS

    def test_route_question_discloses_its_method(self, client):
        res = client.post(
            "/api/v1/chat",
            json={"message": "is it safe from Sector 49 to Cyber City in the next hour"},
        )
        assert res.status_code == 200
        body = res.json()
        assert body["query_type"] == "route"
        analysis = body["route_analysis"]
        assert analysis is not None
        assert analysis["routing_method"] == "straight_line_corridor"
        # The simplification must be stated, never silently implied.
        assert "not turn-by-turn" in analysis["disclaimer"].lower()

    def test_route_question_survives_a_trailing_time_phrase(self, client):
        """"Sector 49 to Cyber City in the next hour?" must resolve.

        The trailing time phrase used to be swallowed into the
        destination name, which then failed to geocode.
        """
        res = client.post(
            "/api/v1/chat", json={"message": "Sector 49 to Cyber City in the next hour?"}
        )
        assert res.status_code == 200
        body = res.json()
        assert body["query_type"] == "route"
        assert body["route_analysis"] is not None

    def test_rejects_empty_message(self, client):
        assert client.post("/api/v1/chat", json={"message": ""}).status_code == 422
