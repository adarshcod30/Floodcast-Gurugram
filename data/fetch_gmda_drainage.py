"""Fetch GMDA's published drainage network and join it to the register.

WHAT THIS ADDS
The register's `drainage_capacity_score` is an estimate assigned by severity
tier, with nothing physical behind it. GMDA publishes a real hydrological
stream network: 4,701 segments, each carrying the catchment area that drains
through it. This attaches, for every hotspot, the nearest stream segment and
its measured catchment.

That is a sourced physical fact about each location, and the first piece of
non-estimated evidence in the register.

WHAT THIS DELIBERATELY DOES NOT DO
It does not feed the risk score. Turning "1.1 sq km drains through here" into
a flooding threshold requires knowing how much rain that catchment needs
before the road goes under, and that is exactly the calibration this project
does not have. Inventing a mapping would produce numbers that look measured
and are not, which is the failure this project exists to avoid. The data is
added as evidence, shown in the UI, and left out of the arithmetic until
there are rainfall-versus-flood pairs to fit against.

SOURCE AND LICENCE
GMDA OneMap, ArcGIS REST, publicly readable without authentication:
  https://onemapdepts.gmda.gov.in/server/rest/services/flood_survey_2/FeatureServer
No explicit licence is published on that endpoint. Indian government data of
this kind is generally reusable with attribution under NDSAP / GODL-India,
and this project attributes it clearly, but that is an inference and not a
grant. GMDA has not reviewed or endorsed this project. If this data is ever
used beyond public-good analysis, confirm terms with GMDA's GIS division
first.

Run from the repository root:

    python3 data/fetch_gmda_drainage.py
"""

from __future__ import annotations

import csv
import json
import math
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = (
    "https://onemapdepts.gmda.gov.in/server/rest/services"
    "/flood_survey_2/FeatureServer"
)
FLOW_LAYER = 6
WATERSHED_LAYER = 1

DATA_DIR = Path(__file__).resolve().parent
RAW_DIR = DATA_DIR / "gmda"
PAGE = 1000
RETRIEVED = time.strftime("%Y-%m-%d")

# Gurugram's latitude, for the flat-earth projection. The city is about 20 km
# across, where ignoring curvature costs far less than the precision of the
# hotspot coordinates themselves.
KM_PER_DEG_LAT = 111.32
KM_PER_DEG_LON = 111.32 * math.cos(math.radians(28.46))


def _ssl_context() -> ssl.SSLContext:
    """Two quirks of this host, both handled without weakening verification.

    First, it negotiates TLS the old way, which Python refuses by default
    (UNSAFE_LEGACY_RENEGOTIATION_DISABLED). That is why curl reaches this
    server and urllib does not. Only the renegotiation restriction is
    relaxed.

    Second, the chain verifies against the macOS system store but not against
    the bundle python.org's build ships with, so certifi's roots are used
    explicitly.

    Certificate verification stays fully on. Nothing is ever sent to this
    host, only read from it.
    """
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
    ctx.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
    return ctx


SSL_CTX = _ssl_context()


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "floodcast-gurugram/1.0"})
    with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as r:
        return json.loads(r.read().decode())


def fetch_layer(layer: int) -> list[dict]:
    """Page through a layer. ArcGIS caps a single response, so this walks
    resultOffset until the server stops setting exceededTransferLimit."""
    features: list[dict] = []
    offset = 0
    while True:
        params = urllib.parse.urlencode({
            "where": "1=1",
            "outFields": "*",
            "outSR": 4326,
            "f": "geojson",
            "resultOffset": offset,
            "resultRecordCount": PAGE,
        })
        page = fetch_json(f"{BASE}/{layer}/query?{params}")
        batch = page.get("features", [])
        features.extend(batch)
        print(f"    layer {layer}: +{len(batch)} (total {len(features)})")
        if len(batch) < PAGE:
            break
        offset += PAGE
        time.sleep(0.4)  # A public government endpoint. Do not hammer it.
    return features


def to_km(lat: float, lon: float) -> tuple[float, float]:
    return lon * KM_PER_DEG_LON, lat * KM_PER_DEG_LAT


def point_to_segment_km(p, a, b) -> float:
    px, py = p
    ax, ay = a
    bx, by = b
    abx, aby = bx - ax, by - ay
    apx, apy = px - ax, py - ay
    ab2 = abx * abx + aby * aby
    if ab2 == 0:
        return math.hypot(apx, apy)
    t = max(0.0, min(1.0, (apx * abx + apy * aby) / ab2))
    return math.hypot(px - (ax + t * abx), py - (ay + t * aby))


def parse_drain_area(value) -> float | None:
    """`drain_area` arrives as text like '1.077 sq km'."""
    if not value:
        return None
    try:
        return float(str(value).split()[0])
    except (ValueError, IndexError):
        return None


def nearest_segment(lat: float, lon: float, segments: list[dict]) -> tuple[dict, float]:
    """Nearest stream segment and its distance in metres."""
    p = to_km(lat, lon)
    best, best_km = None, float("inf")
    for seg in segments:
        for line in seg["lines"]:
            for i in range(len(line) - 1):
                d = point_to_segment_km(p, line[i], line[i + 1])
                if d < best_km:
                    best_km, best = d, seg
    return best, best_km * 1000.0


def point_in_ring(x: float, y: float, ring: list) -> bool:
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y1 > y) != (y2 > y):
            xin = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < xin:
                inside = not inside
    return inside


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    print("Fetching GMDA Natural_Flow_Direction ...")
    flow = fetch_layer(FLOW_LAYER)
    print("Fetching GMDA Watershed_Gurugram ...")
    sheds = fetch_layer(WATERSHED_LAYER)

    (RAW_DIR / "natural_flow_direction.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": flow}), encoding="utf-8"
    )
    (RAW_DIR / "watershed_gurugram.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": sheds}), encoding="utf-8"
    )

    # Pre-project every segment once.
    segments = []
    for f in flow:
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if geom.get("type") == "LineString":
            coords = [coords]
        lines = [[to_km(c[1], c[0]) for c in line if len(c) >= 2] for line in coords]
        lines = [ln for ln in lines if len(ln) >= 2]
        if not lines:
            continue
        p = f.get("properties") or {}
        segments.append({
            "lines": lines,
            "stream_id": p.get("stream_id"),
            "drain_area_sq_km": parse_drain_area(p.get("drain_area")),
            "in_flow": p.get("in_flow"),
            "out_flow": p.get("out_flow"),
            "elevation": p.get("elevation"),
        })
    print(f"  usable stream segments: {len(segments)}")

    shed_polys = []
    for f in sheds:
        geom = f.get("geometry") or {}
        polys = geom.get("coordinates") or []
        if geom.get("type") == "Polygon":
            polys = [polys]
        shed_polys.append({
            "id": (f.get("properties") or {}).get("id"),
            "rings": [poly[0] for poly in polys if poly],
        })
    print(f"  watersheds: {len(shed_polys)}")

    with (DATA_DIR / "hotspots_extended.csv").open(newline="", encoding="utf-8") as fh:
        hotspots = list(csv.DictReader(fh))

    out_rows = []
    for h in hotspots:
        lat, lon = float(h["latitude"]), float(h["longitude"])
        seg, metres = nearest_segment(lat, lon, segments)

        shed_id = ""
        for s in shed_polys:
            if any(point_in_ring(lon, lat, ring) for ring in s["rings"]):
                shed_id = s["id"]
                break

        out_rows.append({
            "hotspot_id": h["hotspot_id"],
            "name": h["name"],
            "gmda_nearest_stream_m": round(metres, 1),
            "gmda_stream_id": seg["stream_id"] if seg else "",
            "gmda_drain_area_sq_km": seg["drain_area_sq_km"] if seg else "",
            "gmda_flow_accumulation": seg["out_flow"] if seg else "",
            "gmda_elevation_m": seg["elevation"] if seg else "",
            "gmda_watershed_id": shed_id,
        })

    out = DATA_DIR / "gmda_drainage_join.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out_rows[0].keys()))
        w.writeheader()
        w.writerows(out_rows)

    (RAW_DIR / "SOURCE.txt").write_text(
        "GMDA OneMap, ArcGIS REST FeatureServer 'flood_survey_2'\n"
        f"{BASE}\n"
        f"Layer {FLOW_LAYER} Natural_Flow_Direction: {len(flow)} features\n"
        f"Layer {WATERSHED_LAYER} Watershed_Gurugram: {len(sheds)} features\n"
        f"Retrieved: {RETRIEVED}\n"
        "Publicly readable without authentication. No explicit licence is\n"
        "published on the endpoint. Attributed to GMDA; GMDA has not reviewed\n"
        "or endorsed this project.\n",
        encoding="utf-8",
    )

    matched = [r for r in out_rows if r["gmda_drain_area_sq_km"] != ""]
    close = [r for r in matched if r["gmda_nearest_stream_m"] <= 250]
    areas = sorted(float(r["gmda_drain_area_sq_km"]) for r in matched)
    print(f"\nwrote {out.relative_to(DATA_DIR.parent)}")
    print(f"  hotspots joined to a stream segment: {len(matched)}/{len(out_rows)}")
    print(f"  within 250 m of one:                {len(close)}/{len(out_rows)}")
    if areas:
        print(f"  catchment sq km  min {areas[0]:.3f}  "
              f"median {areas[len(areas)//2]:.3f}  max {areas[-1]:.3f}")


if __name__ == "__main__":
    main()
