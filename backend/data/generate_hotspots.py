"""
FloodCast Gurugram — Hotspot Dataset Generator
================================================
Builds the core 36-point hotspot dataset that everything else in the
project reads from.

METHODOLOGY (read this before trusting any single row):
- TOTAL COUNT (36) and TIER DISTRIBUTION (10 hypercritical / 18 moderate /
  8 minor) and ZONE SPLIT (Zone 1 = 13, Zone 2 = 23) are drawn from public
  MCG/GMDA reporting on their 2026 pre-monsoon hotspot classification.
  This aggregate structure is the one fully "official" fact in this dataset.
- Individual hotspot NAMES fall into three confidence buckets, tracked in
  the `data_confidence` column:
    1. confirmed_named_mcg_zone1   -> explicitly named by MCG as Zone 1
       hotspots in public reporting (Sector 10A, Gandhi Nagar Booster,
       Begumpur Khatola, Fazilpur).
    2. confirmed_named_multi_source -> named as a recurring waterlogging
       point across 2+ independent news reports spanning multiple years
       (2022-2025). These are real, well-documented chokepoints, but their
       specific placement into MCG's internal tier/zone system is OUR
       inference from coverage severity language, not a verbatim MCG label.
    3. reconstructed_estimate -> NOT found named in any source. These exist
       only to fill the count up to the official total of 36 and preserve
       the official tier distribution. They are placed in plausible
       localities based on general area flood-proneness, nothing more.
- COORDINATES for every single row are best-effort approximations from
  general geographic knowledge of Gurugram, NOT from a geocoding API call.
  Every row is flagged coordinates_verified = "No". Treat these as good
  enough to plot on a map for development, but verify the important ones
  (especially the hypercritical tier) against Google Maps before this
  becomes anything more than a personal project.
- RAINFALL THRESHOLDS, TIME-TO-FLOOD, DRAIN TIME, and DRAINAGE CAPACITY
  SCORE are entirely SYNTHETIC, calibrated by severity tier with random
  jitter for realism. There is no real historical rainfall-vs-flood
  dataset backing these numbers. This is the single biggest thing that
  would improve if GMDA ever shares real data — see DATA_PROVENANCE.md.

Sources referenced during research (see DATA_PROVENANCE.md for full list):
- MCG 2026 pre-monsoon hotspot classification (public reporting)
- Gurugram Waterlogging Portal launch coverage, June 2026
- The Tribune, "Commuters face tough time..." (2022)
- NewsX, "Heavy Rains Trigger Severe Waterlogging..." (2024)
- Business Standard, "Gurugram drowns in heavy rain..." (2025)
- The Tribune, "Despite Rs 500-cr spend, Gurugram sinks every monsoon" (2025)
"""

import pandas as pd
import numpy as np

RNG = np.random.default_rng(seed=42)  # fixed seed -> reproducible synthetic values

# ---------------------------------------------------------------------------
# THE 36 HOTSPOTS
# ---------------------------------------------------------------------------
# tier: hypercritical | moderate | minor
# confidence: confirmed_named_mcg_zone1 | confirmed_named_multi_source | reconstructed_estimate

HOTSPOTS = [
    # ---------------- ZONE 1 (Old / West Gurugram) — 13 total ----------------
    # Hypercritical (4)
    dict(name="Subhash Chowk", locality="Old Gurugram / Sohna Road-Sadar Bazaar junction",
         zone="Zone 1", tier="hypercritical", lat=28.4580, lon=77.0270,
         confidence="confirmed_named_multi_source",
         source="NewsX (2024) — named directly by MCG Commissioner as a recurring hotspot",
         road_type="arterial junction", commute_relevance="High"),
    dict(name="Basai Chowk", locality="West Gurugram", zone="Zone 1", tier="hypercritical",
         lat=28.4650, lon=76.9950, confidence="confirmed_named_multi_source",
         source="The Tribune (2022), NewsX (2024) — recurring across years",
         road_type="arterial junction", commute_relevance="High"),
    dict(name="Khandsa Road", locality="Old / West Gurugram", zone="Zone 1", tier="hypercritical",
         lat=28.4600, lon=77.0100, confidence="confirmed_named_multi_source",
         source="NewsX (2024) — MCG Commissioner named it directly",
         road_type="arterial road", commute_relevance="High"),
    dict(name="Sector 10A", locality="Old Gurugram", zone="Zone 1", tier="hypercritical",
         lat=28.4720, lon=77.0180, confidence="confirmed_named_mcg_zone1",
         source="MCG 2026 pre-monsoon Zone 1 hotspot list; also named in NewsX (2024) as 'Sector 10'",
         road_type="sector arterial", commute_relevance="Medium"),
    # Moderate (5)
    dict(name="Gandhi Nagar Booster", locality="Old Gurugram", zone="Zone 1", tier="moderate",
         lat=28.4680, lon=77.0050, confidence="confirmed_named_mcg_zone1",
         source="MCG 2026 pre-monsoon Zone 1 hotspot list",
         road_type="local road", commute_relevance="Medium"),
    dict(name="Begumpur Khatola", locality="West Gurugram", zone="Zone 1", tier="moderate",
         lat=28.4400, lon=76.9600, confidence="confirmed_named_mcg_zone1",
         source="MCG 2026 pre-monsoon Zone 1 hotspot list",
         road_type="local / arterial", commute_relevance="Medium"),
    dict(name="Fazilpur", locality="West Gurugram", zone="Zone 1", tier="moderate",
         lat=28.4300, lon=76.9450, confidence="confirmed_named_mcg_zone1",
         source="MCG 2026 pre-monsoon Zone 1 hotspot list; remedial work reported ongoing",
         road_type="local road", commute_relevance="Medium"),
    dict(name="Pataudi Road", locality="West Gurugram", zone="Zone 1", tier="moderate",
         lat=28.4550, lon=76.9700, confidence="confirmed_named_multi_source",
         source="NewsX (2024) — MCG Commissioner named it directly",
         road_type="arterial road", commute_relevance="Medium"),
    dict(name="AIT Chowk", locality="Old Gurugram", zone="Zone 1", tier="moderate",
         lat=28.4750, lon=76.9900, confidence="confirmed_named_multi_source",
         source="The Tribune (2022)",
         road_type="junction", commute_relevance="Medium"),
    # Minor (4) — reconstructed, no direct source found
    dict(name="Sector 4 Market Road", locality="Old Gurugram", zone="Zone 1", tier="minor",
         lat=28.4820, lon=77.0230, confidence="reconstructed_estimate",
         source="Not found named in sources reviewed — placeholder to complete official count",
         road_type="internal road", commute_relevance="Low"),
    dict(name="Old Railway Road", locality="Old Gurugram", zone="Zone 1", tier="minor",
         lat=28.4690, lon=77.0210, confidence="reconstructed_estimate",
         source="Not found named in sources reviewed — placeholder to complete official count",
         road_type="narrow arterial", commute_relevance="Medium"),
    dict(name="Palam Vihar Extension", locality="West Gurugram", zone="Zone 1", tier="minor",
         lat=28.5050, lon=76.9930, confidence="reconstructed_estimate",
         source="Not found named in sources reviewed — placeholder to complete official count",
         road_type="sector internal", commute_relevance="Medium"),
    dict(name="Rajendra Park", locality="West Gurugram", zone="Zone 1", tier="minor",
         lat=28.4780, lon=76.9750, confidence="reconstructed_estimate",
         source="Not found named in sources reviewed — placeholder to complete official count",
         road_type="sector internal", commute_relevance="Low"),

    # ---------------- ZONE 2 (NH-48 corridor / New Gurugram) — 23 total ------
    # Hypercritical (6)
    dict(name="IFFCO Chowk", locality="NH-48 corridor", zone="Zone 2", tier="hypercritical",
         lat=28.4595, lon=77.0724, confidence="confirmed_named_multi_source",
         source="Business Standard (2025), NewsX (2024) — major recurring chokepoint",
         road_type="NH-48 major junction", commute_relevance="High"),
    dict(name="Rajiv Chowk", locality="NH-48 corridor", zone="Zone 2", tier="hypercritical",
         lat=28.4477, lon=77.0691, confidence="confirmed_named_multi_source",
         source="The Tribune (2022), NewsX (2024), Business Standard (2025)",
         road_type="NH-48 major junction", commute_relevance="High"),
    dict(name="Signature Tower Flyover", locality="NH-48", zone="Zone 2", tier="hypercritical",
         lat=28.4530, lon=77.0965, confidence="confirmed_named_multi_source",
         source="The Tribune (2022), NewsX (2024)",
         road_type="NH-48 flyover/underpass", commute_relevance="High"),
    dict(name="Narsinghpur", locality="NH-48, south of city", zone="Zone 2", tier="hypercritical",
         lat=28.3850, lon=76.9800, confidence="confirmed_named_multi_source",
         source="The Tribune (2022, 2025) — 'really dangerous for commuters' per resident quote",
         road_type="NH-48 arterial", commute_relevance="High"),
    dict(name="Hero Honda Chowk", locality="NH-48, south of city", zone="Zone 2", tier="hypercritical",
         lat=28.3630, lon=76.9520, confidence="confirmed_named_multi_source",
         source="The Tribune (2022, 2025), NewsX (2024) — recurring every year in coverage",
         road_type="NH-48 major junction", commute_relevance="High"),
    dict(name="Sohna Road", locality="South Gurugram", zone="Zone 2", tier="hypercritical",
         lat=28.4180, lon=77.0430, confidence="confirmed_named_multi_source",
         source="NewsX (2024), Business Standard (2025)",
         road_type="major arterial", commute_relevance="High"),
    # Moderate (13)
    dict(name="Golf Course Extension Road", locality="South-East Gurugram", zone="Zone 2",
         tier="moderate", lat=28.4020, lon=77.0680, confidence="confirmed_named_multi_source",
         source="NewsX (2024) — 'heavily inundated'",
         road_type="arterial", commute_relevance="High"),
    dict(name="Artemis Roundabout / NH-8", locality="Sector 51", zone="Zone 2", tier="moderate",
         lat=28.4350, lon=77.0950, confidence="confirmed_named_multi_source",
         source="The Tribune (2025) — 'notorious choke point'",
         road_type="arterial roundabout", commute_relevance="High"),
    dict(name="Southern Peripheral Road (SPR)", locality="South Gurugram", zone="Zone 2",
         tier="moderate", lat=28.4050, lon=77.0800, confidence="confirmed_named_multi_source",
         source="NewsX (2024), The Tribune (2025, as 'SPR-Wazirabad')",
         road_type="major arterial", commute_relevance="High"),
    dict(name="Wazirabad", locality="South Gurugram", zone="Zone 2", tier="moderate",
         lat=28.3950, lon=77.0600, confidence="confirmed_named_multi_source",
         source="Business Standard (2025, highest rainfall recorded here), The Tribune (2025)",
         road_type="arterial", commute_relevance="Medium"),
    dict(name="Millennium Metro Station Area", locality="Central Gurugram (MG Road)",
         zone="Zone 2", tier="moderate", lat=28.4600, lon=77.0710,
         confidence="confirmed_named_multi_source", source="NewsX (2024)",
         road_type="metro / arterial junction", commute_relevance="High"),
    dict(name="Sector 15", locality="Central Gurugram", zone="Zone 2", tier="moderate",
         lat=28.4680, lon=77.0350, confidence="confirmed_named_multi_source",
         source="NewsX (2024)", road_type="sector internal", commute_relevance="Medium"),
    dict(name="Mayfield Garden", locality="Sector 51", zone="Zone 2", tier="moderate",
         lat=28.4150, lon=77.0550, confidence="confirmed_named_multi_source",
         source="The Tribune (2022)", road_type="sector road", commute_relevance="Medium"),
    dict(name="Atlas Chowk", locality="Central Gurugram", zone="Zone 2", tier="moderate",
         lat=28.4820, lon=76.9850, confidence="confirmed_named_multi_source",
         source="The Tribune (2022)", road_type="junction", commute_relevance="Medium"),
    dict(name="CRPF Chowk", locality="Central Gurugram", zone="Zone 2", tier="moderate",
         lat=28.4900, lon=77.0350, confidence="confirmed_named_multi_source",
         source="The Tribune (2022)", road_type="junction", commute_relevance="Medium"),
    dict(name="Cyber City", locality="DLF, North Gurugram", zone="Zone 2", tier="moderate",
         lat=28.4950, lon=77.0890, confidence="confirmed_named_multi_source",
         source="NewsX (2024) — cited as commuter destination affected by area flooding",
         road_type="commercial arterial", commute_relevance="High"),
    dict(name="Udyog Vihar", locality="North Gurugram", zone="Zone 2", tier="moderate",
         lat=28.5010, lon=77.0880, confidence="confirmed_named_multi_source",
         source="Recurring in general Gurugram monsoon coverage as an affected industrial belt",
         road_type="industrial / arterial", commute_relevance="High"),
    dict(name="Sector 56 Main Stretch", locality="South-East Gurugram", zone="Zone 2",
         tier="moderate", lat=28.4300, lon=77.1050, confidence="reconstructed_estimate",
         source="Not found named in sources reviewed — placeholder to complete official count",
         road_type="sector road", commute_relevance="Medium"),
    dict(name="Leisure Valley / Sector 29", locality="Central Gurugram", zone="Zone 2",
         tier="moderate", lat=28.4680, lon=77.0620, confidence="reconstructed_estimate",
         source="Not found named in sources reviewed — placeholder to complete official count",
         road_type="sector / commercial road", commute_relevance="Medium"),
    # Minor (4) — reconstructed
    dict(name="DLF Phase 2 Internal Road", locality="DLF area", zone="Zone 2", tier="minor",
         lat=28.4830, lon=77.0940, confidence="reconstructed_estimate",
         source="Not found named in sources reviewed — placeholder to complete official count",
         road_type="internal road", commute_relevance="Low"),
    dict(name="South City Internal Road", locality="South City", zone="Zone 2", tier="minor",
         lat=28.4480, lon=77.0500, confidence="reconstructed_estimate",
         source="Not found named in sources reviewed — placeholder to complete official count",
         road_type="internal road", commute_relevance="Low"),
    dict(name="Sector 49 Internal Road", locality="South Gurugram", zone="Zone 2", tier="minor",
         lat=28.4080, lon=77.0620, confidence="reconstructed_estimate",
         source="Not found named in sources reviewed — placeholder to complete official count",
         road_type="internal road", commute_relevance="Low"),
    dict(name="Sector 67 Residential Road", locality="South Gurugram", zone="Zone 2", tier="minor",
         lat=28.3980, lon=77.0550, confidence="reconstructed_estimate",
         source="Not found named in sources reviewed — placeholder to complete official count",
         road_type="internal road", commute_relevance="Low"),
]

assert len(HOTSPOTS) == 36, f"Expected 36 hotspots, got {len(HOTSPOTS)}"

# ---------------------------------------------------------------------------
# SYNTHETIC RISK-MODEL FIELDS (clearly synthetic — see module docstring)
# ---------------------------------------------------------------------------
# Calibration ranges per tier. These are engineering placeholders, not
# validated against real flood records.
TIER_PARAMS = {
    "hypercritical": dict(threshold_mm=(15, 22), time_to_flood_min=(20, 40),
                           drain_hr=(3.0, 6.0), drainage_score=(0.10, 0.30)),
    "moderate":       dict(threshold_mm=(25, 35), time_to_flood_min=(40, 90),
                           drain_hr=(1.5, 3.0), drainage_score=(0.35, 0.60)),
    "minor":          dict(threshold_mm=(40, 55), time_to_flood_min=(90, 150),
                           drain_hr=(0.5, 1.5), drainage_score=(0.65, 0.85)),
}

def synth_fields(tier: str) -> dict:
    p = TIER_PARAMS[tier]
    return dict(
        rainfall_threshold_mm_per_hr=round(RNG.uniform(*p["threshold_mm"]), 1),
        time_to_flood_after_threshold_min=int(RNG.uniform(*p["time_to_flood_min"])),
        typical_drain_time_hr=round(RNG.uniform(*p["drain_hr"]), 1),
        drainage_capacity_score=round(RNG.uniform(*p["drainage_score"]), 2),
    )

rows = []
for i, h in enumerate(HOTSPOTS, start=1):
    row = {
        "hotspot_id": f"FCG-{i:03d}",
        "name": h["name"],
        "locality_area": h["locality"],
        "zone": h["zone"],
        "severity_tier": h["tier"],
        "latitude": h["lat"],
        "longitude": h["lon"],
        "road_type": h["road_type"],
        "commute_relevance": h["commute_relevance"],
        "data_confidence": h["confidence"],
        "source_note": h["source"],
        "coordinates_verified": "No — approximate, verify before production use",
        **synth_fields(h["tier"]),
    }
    rows.append(row)

df = pd.DataFrame(rows)

# sanity checks before writing anything out
assert df["hotspot_id"].is_unique
assert set(df["severity_tier"]) == {"hypercritical", "moderate", "minor"}
tier_counts = df["severity_tier"].value_counts().to_dict()
zone_counts = df["zone"].value_counts().to_dict()
conf_counts = df["data_confidence"].value_counts().to_dict()

print("Tier distribution:", tier_counts, "(expected hypercritical=10, moderate=18, minor=8)")
print("Zone distribution:", zone_counts, "(expected Zone 1=13, Zone 2=23)")
print("Confidence distribution:", conf_counts)

assert tier_counts["hypercritical"] == 10
assert tier_counts["moderate"] == 18
assert tier_counts["minor"] == 8
assert zone_counts["Zone 1"] == 13
assert zone_counts["Zone 2"] == 23

# ---------------------------------------------------------------------------
# WRITE OUTPUTS
# ---------------------------------------------------------------------------
df.to_csv("data/hotspots.csv", index=False)
df.to_parquet("data/hotspots.parquet", index=False)
print(f"\nWrote {len(df)} rows to data/hotspots.csv and data/hotspots.parquet")
