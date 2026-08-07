#!/usr/bin/env python3
"""Compare dataset coordinates against OpenStreetMap geocoding.

WHAT THIS IS
------------
A one-time, manually-run audit tool. Every coordinate in
hotspots_extended.csv is an approximate, unverified placement (see
DATA_PROVENANCE.md section 3), and this script measures how far each one
sits from where Nominatim thinks that place is.

WHAT THIS IS NOT
----------------
It NEVER modifies the dataset. It writes a report for a human to read.

That restraint is the point. Nominatim is not ground truth for a Gurugram
chowk — it will confidently return a point for a name that means
something else, or fail on a junction that has no OSM node at all.
Auto-applying its answers would replace a set of coordinates honestly
labelled "approximate" with a set that looks authoritative and is not.
A large distance here is a prompt to check a map, not a correction.

USAGE
-----
    python scripts/verify_coordinates.py                 # all 64
    python scripts/verify_coordinates.py --tier hypercritical
    python scripts/verify_coordinates.py --out report.md

Nominatim's usage policy caps requests at 1/second and requires a real
contact address; both are honoured below. A full 64-row run takes a
little over a minute.
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

REPO = Path(__file__).resolve().parent.parent
DATASET = REPO / "backend" / "data" / "hotspots_extended.csv"

NOMINATIM = "https://nominatim.openstreetmap.org/search"

#: Distances above this are worth a human look. Chosen because Gurugram's
#: sector grid is roughly 1 km across, so a discrepancy larger than this
#: means the pin is likely in a different sector than the name implies.
REVIEW_THRESHOLD_KM = 1.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def geocode(client: httpx.Client, name: str, contact: str) -> Optional[tuple[float, float, str]]:
    """Look up one place. Returns (lat, lon, display_name) or None."""
    try:
        response = client.get(
            NOMINATIM,
            params={
                "q": f"{name}, Gurugram, Haryana, India",
                "format": "json",
                "limit": 1,
            },
            headers={
                "User-Agent": (
                    f"FloodCastGurugram-coordinate-audit/1.0 "
                    f"(+https://github.com/floodcast-gurugram; {contact})"
                )
            },
            timeout=15.0,
        )
        response.raise_for_status()
        results = response.json()
    except Exception as exc:  # noqa: BLE001 — one failure must not end the run
        print(f"  ! {name}: request failed ({exc})", file=sys.stderr)
        return None

    if not results:
        return None
    first = results[0]
    return float(first["lat"]), float(first["lon"]), first.get("display_name", "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tier", help="Only check one severity tier")
    parser.add_argument("--out", type=Path, help="Write the Markdown report here")
    parser.add_argument(
        "--contact",
        default="coordinate-audit@floodcast.invalid",
        help="Contact address for the Nominatim User-Agent (its policy requires a real one)",
    )
    args = parser.parse_args()

    if not DATASET.exists():
        print(f"Dataset not found: {DATASET}", file=sys.stderr)
        return 1

    with DATASET.open(encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if not args.tier or r["severity_tier"] == args.tier]

    print(f"Checking {len(rows)} hotspots against Nominatim (~{len(rows)}s)...\n")

    checked: list[dict] = []
    unmatched: list[str] = []

    with httpx.Client() as client:
        for i, row in enumerate(rows, 1):
            name = row["name"]
            print(f"[{i}/{len(rows)}] {name}")

            hit = geocode(client, name, args.contact)
            time.sleep(1.05)  # Nominatim allows 1 request/second

            if hit is None:
                unmatched.append(name)
                continue

            osm_lat, osm_lon, display = hit
            distance = haversine_km(
                float(row["latitude"]), float(row["longitude"]), osm_lat, osm_lon
            )
            checked.append(
                {
                    "name": name,
                    "tier": row["severity_tier"],
                    "confidence": row["data_confidence"],
                    "current": (float(row["latitude"]), float(row["longitude"])),
                    "osm": (osm_lat, osm_lon),
                    "km": distance,
                    "display": display,
                }
            )

    checked.sort(key=lambda r: r["km"], reverse=True)
    flagged = [r for r in checked if r["km"] > REVIEW_THRESHOLD_KM]

    lines = [
        "# Coordinate audit — proposed corrections",
        "",
        "Generated by `scripts/verify_coordinates.py`. **Nothing has been changed.**",
        "",
        "OpenStreetMap is not ground truth for a Gurugram chowk. A large distance",
        "means *check this against a map*, not *this is wrong*. Apply anything you",
        "accept by editing the generator scripts, never the CSV directly.",
        "",
        f"- Checked: **{len(checked)}**",
        f"- Beyond {REVIEW_THRESHOLD_KM} km: **{len(flagged)}**",
        f"- No OSM match: **{len(unmatched)}**",
        "",
        "## Worth reviewing",
        "",
        "| Distance | Hotspot | Tier | Provenance | Dataset | OpenStreetMap |",
        "|---:|---|---|---|---|---|",
    ]
    for r in flagged:
        lines.append(
            f"| {r['km']:.2f} km | {r['name']} | {r['tier']} | {r['confidence']} | "
            f"`{r['current'][0]:.4f}, {r['current'][1]:.4f}` | "
            f"`{r['osm'][0]:.4f}, {r['osm'][1]:.4f}` |"
        )

    if unmatched:
        lines += [
            "",
            "## No OpenStreetMap match",
            "",
            "Absence of a match is not evidence the coordinate is wrong — many",
            "junctions simply have no OSM node under that name.",
            "",
        ]
        lines += [f"- {n}" for n in unmatched]

    report = "\n".join(lines) + "\n"

    if args.out:
        args.out.write_text(report, encoding="utf-8")
        print(f"\nReport written to {args.out}")
    else:
        print("\n" + report)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
