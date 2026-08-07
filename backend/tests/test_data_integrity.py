"""
FloodCast Gurugram — Data Integrity Tests
===========================================
Loads both parquet files through DuckDB and confirms row counts match
what's documented in DATA_PROVENANCE.md. Catches silent data corruption.
"""

import pytest
import duckdb
from pathlib import Path


def _find_data_dir() -> Path:
    """Find the data directory."""
    # Try relative to backend/
    candidates = [
        Path(__file__).parent.parent / "data",
        Path("data"),
        Path("backend/data"),
    ]
    for p in candidates:
        if p.exists() and (p / "hotspots_extended.parquet").exists():
            return p
    pytest.skip("Data directory not found")


class TestHotspotsParquet:
    def test_row_count_64(self):
        """hotspots_extended.parquet must have exactly 64 rows."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        result = conn.execute(
            f"SELECT COUNT(*) FROM read_parquet('{data_dir}/hotspots_extended.parquet')"
        ).fetchone()
        conn.close()
        assert result[0] == 64, f"Expected 64 hotspot rows, got {result[0]}"

    def test_required_columns_exist(self):
        """All required columns must be present."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        result = conn.execute(
            f"SELECT * FROM read_parquet('{data_dir}/hotspots_extended.parquet') LIMIT 1"
        ).fetchone()
        columns = [desc[0] for desc in conn.description]
        conn.close()

        required = [
            "hotspot_id", "name", "locality_area", "zone", "severity_tier",
            "latitude", "longitude", "road_type", "commute_relevance",
            "data_confidence", "source_note", "coordinates_verified",
            "rainfall_threshold_mm_per_hr", "time_to_flood_after_threshold_min",
            "typical_drain_time_hr", "drainage_capacity_score",
        ]
        for col in required:
            assert col in columns, f"Missing required column: {col}"

    def test_unique_hotspot_ids(self):
        """All hotspot_id values must be unique."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        result = conn.execute(
            f"SELECT COUNT(DISTINCT hotspot_id) FROM read_parquet('{data_dir}/hotspots_extended.parquet')"
        ).fetchone()
        conn.close()
        assert result[0] == 64, f"Non-unique hotspot IDs: {result[0]} unique out of 64"

    def test_data_confidence_values(self):
        """data_confidence must be one of the documented values."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        result = conn.execute(
            f"SELECT DISTINCT data_confidence FROM read_parquet('{data_dir}/hotspots_extended.parquet')"
        ).fetchall()
        conn.close()

        valid_values = {
            "confirmed_named_mcg_zone1",
            "confirmed_named_multi_source",
            "plausible_real_unconfirmed_flood_status",
            "reconstructed_estimate",
        }
        actual_values = {row[0] for row in result}
        assert actual_values.issubset(valid_values), (
            f"Unexpected data_confidence values: {actual_values - valid_values}"
        )

    def test_confidence_distribution(self):
        """Confidence distribution must match DATA_PROVENANCE.md section 6."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        result = conn.execute(
            f"""SELECT data_confidence, COUNT(*) as cnt
                FROM read_parquet('{data_dir}/hotspots_extended.parquet')
                GROUP BY data_confidence"""
        ).fetchall()
        conn.close()

        counts = {row[0]: row[1] for row in result}
        assert counts.get("confirmed_named_mcg_zone1", 0) == 4
        assert counts.get("confirmed_named_multi_source", 0) == 26
        assert counts.get("plausible_real_unconfirmed_flood_status", 0) == 24
        assert counts.get("reconstructed_estimate", 0) == 10

    def test_severity_tier_values(self):
        """severity_tier must be one of the three valid values."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        result = conn.execute(
            f"SELECT DISTINCT severity_tier FROM read_parquet('{data_dir}/hotspots_extended.parquet')"
        ).fetchall()
        conn.close()

        valid = {"hypercritical", "moderate", "minor"}
        actual = {row[0] for row in result}
        assert actual == valid

    def test_coordinates_in_gurugram(self):
        """All coordinates should be roughly within Gurugram bounds."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        result = conn.execute(
            f"""SELECT name, latitude, longitude
                FROM read_parquet('{data_dir}/hotspots_extended.parquet')
                WHERE latitude < 28.3 OR latitude > 28.6
                   OR longitude < 76.85 OR longitude > 77.15"""
        ).fetchall()
        conn.close()
        assert len(result) == 0, f"Coordinates out of Gurugram bounds: {result}"


class TestAttractionsParquet:
    def test_row_count_8(self):
        """attractions.parquet must have exactly 8 rows."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        result = conn.execute(
            f"SELECT COUNT(*) FROM read_parquet('{data_dir}/attractions.parquet')"
        ).fetchone()
        conn.close()
        assert result[0] == 8, f"Expected 8 attraction rows, got {result[0]}"

    def test_no_risk_columns(self):
        """Attractions must NOT have any risk-related columns."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        conn.execute(
            f"SELECT * FROM read_parquet('{data_dir}/attractions.parquet') LIMIT 1"
        ).fetchone()
        columns = {desc[0] for desc in conn.description}
        conn.close()

        forbidden = {
            "severity_tier", "risk_score", "risk_level",
            "rainfall_threshold_mm_per_hr", "time_to_flood_after_threshold_min",
            "typical_drain_time_hr", "drainage_capacity_score",
        }
        present = forbidden.intersection(columns)
        assert not present, (
            f"Attractions parquet has forbidden risk columns: {present}"
        )

    def test_required_columns(self):
        """Attractions must have the required columns."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        conn.execute(
            f"SELECT * FROM read_parquet('{data_dir}/attractions.parquet') LIMIT 1"
        ).fetchone()
        columns = {desc[0] for desc in conn.description}
        conn.close()

        required = {"poi_id", "name", "category", "locality", "lat", "lon", "source"}
        missing = required - columns
        assert not missing, f"Missing attraction columns: {missing}"

    def test_unique_poi_ids(self):
        """All poi_id values must be unique."""
        data_dir = _find_data_dir()
        conn = duckdb.connect(":memory:")
        result = conn.execute(
            f"SELECT COUNT(DISTINCT poi_id) FROM read_parquet('{data_dir}/attractions.parquet')"
        ).fetchone()
        conn.close()
        assert result[0] == 8
