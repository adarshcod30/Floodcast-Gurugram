"""
FloodCast Gurugram — Endpoint Tests
======================================
Basic tests for all five API routes using FastAPI's TestClient.
Includes a critical test: attractions NEVER contain risk fields.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.data_loader import load_data


@pytest.fixture(scope="module", autouse=True)
def load_test_data():
    """Load data before running endpoint tests."""
    try:
        load_data()
    except Exception:
        pytest.skip("Data files not available for endpoint tests")


@pytest.fixture
def client():
    return TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_has_status(self, client):
        response = client.get("/health")
        data = response.json()
        assert "status" in data
        assert data["status"] in ("healthy", "degraded", "unhealthy")

    def test_health_has_dependencies(self, client):
        response = client.get("/health")
        data = response.json()
        assert "dependencies" in data
        deps = data["dependencies"]
        assert "duckdb_data" in deps
        assert "weather_api" in deps
        assert "bedrock" in deps

    def test_health_has_timestamp(self, client):
        response = client.get("/health")
        data = response.json()
        assert "timestamp" in data


class TestHotspotsEndpoint:
    def test_hotspots_returns_200(self, client):
        response = client.get("/api/v1/hotspots")
        assert response.status_code == 200

    def test_hotspots_count(self, client):
        response = client.get("/api/v1/hotspots")
        data = response.json()
        assert data["total"] == 64
        assert len(data["hotspots"]) == 64

    def test_hotspots_have_data_confidence(self, client):
        """Every hotspot MUST include data_confidence."""
        response = client.get("/api/v1/hotspots")
        data = response.json()
        for hotspot in data["hotspots"]:
            assert "data_confidence" in hotspot
            assert hotspot["data_confidence"] in (
                "confirmed_named_mcg_zone1",
                "confirmed_named_multi_source",
                "plausible_real_unconfirmed_flood_status",
                "reconstructed_estimate",
            )

    def test_hotspots_have_risk_fields(self, client):
        """Every hotspot should have risk_score and risk_level."""
        response = client.get("/api/v1/hotspots")
        data = response.json()
        for hotspot in data["hotspots"]:
            assert "risk_score" in hotspot
            assert "risk_level" in hotspot
            assert hotspot["risk_level"] in ("critical", "high", "moderate", "low")

    def test_hotspots_have_coordinates(self, client):
        response = client.get("/api/v1/hotspots")
        data = response.json()
        for hotspot in data["hotspots"]:
            assert "latitude" in hotspot
            assert "longitude" in hotspot
            assert 28.0 < hotspot["latitude"] < 29.0  # Within Gurugram
            assert 76.0 < hotspot["longitude"] < 78.0


class TestAttractionsEndpoint:
    def test_attractions_returns_200(self, client):
        response = client.get("/api/v1/attractions")
        assert response.status_code == 200

    def test_attractions_count(self, client):
        response = client.get("/api/v1/attractions")
        data = response.json()
        assert data["total"] == 8
        assert len(data["attractions"]) == 8

    def test_attractions_never_have_risk_fields(self, client):
        """
        CRITICAL GUARDRAIL: Attractions must NEVER contain severity,
        risk_score, risk_level, or any flood-risk field.
        """
        response = client.get("/api/v1/attractions")
        data = response.json()
        forbidden_fields = {
            "severity_tier", "risk_score", "risk_level",
            "rainfall_threshold_mm_per_hr", "time_to_flood_after_threshold_min",
            "typical_drain_time_hr", "drainage_capacity_score",
            "time_window", "data_confidence",
        }
        for attraction in data["attractions"]:
            present_forbidden = forbidden_fields.intersection(attraction.keys())
            assert not present_forbidden, (
                f"Attraction '{attraction.get('name')}' has forbidden risk fields: "
                f"{present_forbidden}"
            )

    def test_attractions_have_required_fields(self, client):
        response = client.get("/api/v1/attractions")
        data = response.json()
        for attraction in data["attractions"]:
            assert "poi_id" in attraction
            assert "name" in attraction
            assert "category" in attraction
            assert "lat" in attraction
            assert "lon" in attraction


class TestForecastEndpoint:
    def test_forecast_returns_200(self, client):
        response = client.get("/api/v1/forecast")
        assert response.status_code == 200

    def test_forecast_has_source(self, client):
        response = client.get("/api/v1/forecast")
        data = response.json()
        assert "source" in data
        assert data["source"] in ("live", "cached", "fallback", "unavailable")

    def test_forecast_has_windows(self, client):
        response = client.get("/api/v1/forecast")
        data = response.json()
        assert "windows" in data
        assert isinstance(data["windows"], list)


class TestAqiEndpoint:
    def test_aqi_returns_200(self, client):
        response = client.get("/api/v1/aqi")
        assert response.status_code == 200

    def test_aqi_has_expected_keys(self, client):
        response = client.get("/api/v1/aqi")
        data = response.json()
        assert "aqi" in data
        assert "label" in data
        assert "components" in data
        assert "fetched_at" in data
        assert "source" in data
        assert data["aqi"] in (1, 2, 3, 4, 5)


class TestTransitEndpoint:
    def test_transit_returns_200(self, client):
        response = client.get("/api/v1/transit")
        assert response.status_code == 200

    def test_transit_has_expected_keys(self, client):
        response = client.get("/api/v1/transit")
        data = response.json()
        assert "lines" in data
        assert "summary" in data
        assert "computed_at" in data
        assert isinstance(data["lines"], list)
        assert len(data["lines"]) > 0
        for line in data["lines"]:
            assert "name" in line
            assert "status" in line
            assert "delay_minutes" in line
            assert "notes" in line


class TestChatEndpoint:
    def test_chat_returns_200(self, client):
        response = client.post(
            "/api/v1/chat",
            json={"message": "Is IFFCO Chowk risky right now?"},
        )
        assert response.status_code == 200

    def test_chat_has_verdict(self, client):
        response = client.post(
            "/api/v1/chat",
            json={"message": "Is IFFCO Chowk risky?"},
        )
        data = response.json()
        assert "verdict" in data
        assert "query_type" in data
        assert data["query_type"] in ("point", "route")

    def test_chat_rejects_empty_message(self, client):
        response = client.post("/api/v1/chat", json={"message": ""})
        assert response.status_code == 422  # Validation error

    def test_chat_rejects_missing_message(self, client):
        response = client.post("/api/v1/chat", json={})
        assert response.status_code == 422

    def test_chat_has_hotspots_referenced(self, client):
        """Chat responses must include hotspots_referenced for auditability."""
        response = client.post(
            "/api/v1/chat",
            json={"message": "Is IFFCO Chowk risky?"},
        )
        data = response.json()
        assert "hotspots_referenced" in data


class TestCivicEndpoints:
    def test_utilities_returns_200(self, client):
        response = client.get("/api/v1/utilities")
        assert response.status_code == 200
        data = response.json()
        assert "utilities" in data
        assert "total" in data
        assert isinstance(data["utilities"], list)

    def test_roadworks_returns_200(self, client):
        response = client.get("/api/v1/roadworks")
        assert response.status_code == 200
        data = response.json()
        assert "roadworks" in data
        assert "total" in data
        assert isinstance(data["roadworks"], list)

    def test_community_reports_returns_200(self, client):
        response = client.get("/api/v1/community/reports")
        assert response.status_code == 200
        data = response.json()
        assert "reports" in data
        assert "total" in data
        assert isinstance(data["reports"], list)

    def test_post_community_report_and_verify(self, client):
        payload = {
            "title": "Water accumulation on bridge",
            "description": "Left lane completely flooded on the flyover bridge.",
            "category": "hazard",
            "location_name": "IFFCO Chowk Flyover",
            "lat": 28.459,
            "lon": 77.072
        }
        # Post new report
        response = client.post("/api/v1/community/report", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data["title"] == payload["title"]
        assert data["upvotes"] == 1
        
        # Verify (upvote) the report
        rep_id = data["id"]
        verify_response = client.post(f"/api/v1/community/report/{rep_id}/verify")
        assert verify_response.status_code == 200
        verify_data = verify_response.json()
        assert verify_data["upvotes"] == 2

