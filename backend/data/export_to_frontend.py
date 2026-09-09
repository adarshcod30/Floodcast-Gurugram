"""Export the hotspot register and landmark list as JSON for the frontend.

Final stage of the data chain:

    generate_hotspots.py -> generate_expansion.py
      -> generate_2026_monsoon_update.py -> export_to_frontend.py

Why this exists
---------------
The register is 73 rows of static reference data, about 20 KB. Serving it
from a live API meant every visitor waited on a free-tier container waking
from sleep (measured: 42 seconds) before they could see anything at all.
Shipping it inside the bundle makes the first paint instant and removes the
single largest source of failure in the deployment.

Run from `backend/`:

    python3 data/export_to_frontend.py

Nothing here transforms values. Rows are copied verbatim from
hotspots_extended.csv so the JSON and the CSV can never disagree; the only
changes are numeric coercion (CSV has no types) and dropping the four
scoring parameters into a nested object so their provenance stays visible
in the shape of the data itself.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent
OUT_DIR = DATA_DIR.parent.parent / "frontend" / "src" / "data"

EXPECTED_HOTSPOTS = 73
EXPECTED_ATTRACTIONS = 8

FLOAT_FIELDS = {
    "latitude",
    "longitude",
    "rainfall_threshold_mm_per_hr",
    "time_to_flood_after_threshold_min",
    "typical_drain_time_hr",
    "drainage_capacity_score",
}


def read_hotspots() -> list[dict]:
    rows: list[dict] = []
    with (DATA_DIR / "hotspots_extended.csv").open(newline="", encoding="utf-8") as fh:
        for raw in csv.DictReader(fh):
            row = {k: (float(v) if k in FLOAT_FIELDS else v) for k, v in raw.items()}
            rows.append(row)
    return rows


def read_attractions() -> list[dict]:
    rows: list[dict] = []
    with (DATA_DIR / "attractions.csv").open(newline="", encoding="utf-8") as fh:
        for raw in csv.DictReader(fh):
            raw["lat"] = float(raw["lat"])
            raw["lon"] = float(raw["lon"])
            rows.append(raw)
    return rows


def main() -> None:
    hotspots = read_hotspots()
    attractions = read_attractions()

    assert len(hotspots) == EXPECTED_HOTSPOTS, f"expected {EXPECTED_HOTSPOTS}, got {len(hotspots)}"
    assert len(attractions) == EXPECTED_ATTRACTIONS, f"expected {EXPECTED_ATTRACTIONS}"

    # A missing coordinate would place a marker in the Gulf of Guinea rather
    # than fail loudly, so it is caught here instead.
    for h in hotspots:
        assert 27.9 < h["latitude"] < 28.8, f"{h['name']}: latitude out of Gurugram range"
        assert 76.6 < h["longitude"] < 77.4, f"{h['name']}: longitude out of Gurugram range"
        assert h["rainfall_threshold_mm_per_hr"] > 0, f"{h['name']}: threshold must be positive"

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "hotspots.json").write_text(
        json.dumps(hotspots, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (OUT_DIR / "attractions.json").write_text(
        json.dumps(attractions, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    tiers: dict[str, int] = {}
    confidence: dict[str, int] = {}
    for h in hotspots:
        tiers[h["severity_tier"]] = tiers.get(h["severity_tier"], 0) + 1
        confidence[h["data_confidence"]] = confidence.get(h["data_confidence"], 0) + 1

    print(f"wrote {len(hotspots)} hotspots and {len(attractions)} landmarks to {OUT_DIR}")
    print(f"  tiers:      {tiers}")
    print(f"  confidence: {confidence}")


if __name__ == "__main__":
    main()
