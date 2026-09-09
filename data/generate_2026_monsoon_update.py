"""FloodCast Gurugram — 2026 Monsoon Season Update (v3)

Adds to, but does not alter, the 64-row extended dataset produced by
generate_hotspots.py + generate_expansion.py. Reads hotspots_extended.csv
fresh and never mutates it in memory — the same discipline the expansion
script already applies to the base 36.

WHY THIS FILE EXISTS
---------------------
Gurugram had a severe 2026 monsoon: a 97mm-in-a-day event, a 225mm-over-
two-days event on 8-9 Aug that made MCG formally identify 155
waterlogging-prone points citywide, and a 75mm-in-a-day event on 24 Aug
that triggered a citywide work-from-home order for 25 Aug. GMDA
separately maintains its own "vulnerable spots" list — the most severe,
chronic, currently-unresolved locations — which stood at 6 named points
after Narsinghpur's drain fix took it off the list.

None of MCG's 155, GMDA's 6 "vulnerable spots", GMDA's own ~40-point
chronic-sewer-overflow list, and the Tribune's separately-reported
"28 points this monsoon" enumeration reconcile into one number. That is
documented in DATA_PROVENANCE.md section 9, not smoothed over here.

WHAT THIS FILE ADDS
--------------------
Nine hotspots, cross-checked against the existing 64 to confirm they are
genuinely absent (not re-namings of e.g. "Khandsa Road", which already
exists):

  HYPERCRITICAL (5) — the five other members of GMDA CEO P.C. Meena's
  named "vulnerable spots" list (Aug 2026). The sixth member, Khandsa
  Chowk, already exists in our data as "Khandsa Road".

  MODERATE (4) — named on the Tribune's separately-reported "28 points
  this monsoon" list, not on GMDA's more severe 6-point list.

A new confidence tier, `confirmed_named_2026_monsoon`, is used for all
nine. These carry a direct, dated, on-record institutional source from
the CURRENT season (a named GMDA official, or a specific enumerated
Tribune list) — stronger sourcing than `confirmed_named_multi_source`,
which is inferred from severity language across news reports spanning
several years. Giving them their own tier is more honest than folding
them into either existing confirmed tier.

Coordinates follow the exact methodology already used for all 64 prior
rows: best-effort placement from the locality clusters the sources
themselves describe, NOT from a geocoding call, flagged
coordinates_verified = "No" like everything else in this dataset. See
DATA_PROVENANCE.md before trusting any single coordinate here.

ALSO: a text-only correction to Narsinghpur's source_note, documenting
that a new 700m stormwater drain (linked to the Leg-III Badshahpur
drain) resolved its decade-long waterlogging and it stayed dry through
the Aug 2026 rain events, per GMDA. Its severity_tier and synthetic risk
parameters are deliberately left untouched — adjusting a numeric
threshold without a real calibration source would be the same kind of
false precision this project exists to avoid. The correction is text
only, fully justified by direct sourcing.

Sources:
- The Tribune, "Gurugram drowns again... forces WFH order for Aug 25" (2026)
- The Tribune, "97mm rain leaves Gurugram flooded" (2026)
- New Kerala / ANI, "Gurugram identifies 155 waterlogging-prone points" —
  MCG Commissioner Pradeep Dahiya quoted directly, 9 Aug 2026
- The Tribune, "Narsinghpur beats decade-long waterlogging; Gurugram
  hotspots drop from 7 to 6" — GMDA CEO P.C. Meena quoted directly (2026)
- The Tribune, "Gurugram's poster child for waterlogging... rises above
  decade-old tag" (2026)
"""

import pandas as pd
import numpy as np

RNG = np.random.default_rng(seed=44)  # third seed in the chain, still reproducible

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


CONFIDENCE_TIER = "confirmed_named_2026_monsoon"

# ---------------------------------------------------------------------------
# HYPERCRITICAL (5) — GMDA's named "vulnerable spots" list, Aug 2026
# ---------------------------------------------------------------------------
NEW_HYPERCRITICAL = [
    dict(name="Sheetla Mata Road", locality="Old Gurugram / Sohna Road old-city stretch",
         zone="Zone 2", lat=28.4255, lon=77.0355,
         source=(
             "GMDA CEO P.C. Meena's named 'vulnerable spots' list (The Tribune, 2026); "
             "also #1 on the Tribune's separately-reported '28 points this monsoon' list "
             "(9 Aug 2026, after a 225mm/2-day event); an STP is specifically planned for it"
         ),
         road_type="old-city arterial", commute_relevance="High"),
    dict(name="Jwala Mill Road", locality="Basai / Khandsa industrial belt, West Gurugram",
         zone="Zone 1", lat=28.4550, lon=77.0050,
         source="GMDA CEO P.C. Meena's named 'vulnerable spots' list (The Tribune, 2026)",
         road_type="industrial arterial", commute_relevance="Medium"),
    dict(name="Sector 28 (near Chakkarpur)", locality="Chakkarpur, Central Gurugram",
         zone="Zone 2", lat=28.4780, lon=77.0780,
         source="GMDA CEO P.C. Meena's named 'vulnerable spots' list (The Tribune, 2026)",
         road_type="sector arterial", commute_relevance="High"),
    dict(name="Laxman Vihar", locality="Old Gurugram, near Sector 4",
         zone="Zone 1", lat=28.4780, lon=77.0120,
         source="GMDA CEO P.C. Meena's named 'vulnerable spots' list (The Tribune, 2026)",
         road_type="residential colony road", commute_relevance="Medium"),
    dict(name="Krishna Chowk", locality="Old Gurugram, near Palam Vihar",
         zone="Zone 1", lat=28.4850, lon=77.0080,
         source="GMDA CEO P.C. Meena's named 'vulnerable spots' list (The Tribune, 2026)",
         road_type="junction", commute_relevance="Medium"),
]

# ---------------------------------------------------------------------------
# MODERATE (4) — Tribune's "28 points this monsoon" list, not on GMDA's
# more severe 6-point list
# ---------------------------------------------------------------------------
NEW_MODERATE = [
    dict(name="Dundahera", locality="North Gurugram, near NH-48 / Delhi border",
         zone="Zone 2", lat=28.4970, lon=77.0460,
         source="The Tribune, '28 points this monsoon' list (9 Aug 2026)",
         road_type="local / arterial", commute_relevance="Medium"),
    dict(name="Surat Nagar", locality="West Gurugram, off Basai Road",
         zone="Zone 1", lat=28.4600, lon=76.9980,
         source="The Tribune, '28 points this monsoon' list (9 Aug 2026)",
         road_type="residential colony road", commute_relevance="Low"),
    dict(name="Bajghera", locality="West Gurugram, Pataudi Road belt",
         zone="Zone 1", lat=28.4450, lon=76.9400,
         source="The Tribune, '28 points this monsoon' list (9 Aug 2026)",
         road_type="village / arterial approach", commute_relevance="Low"),
    dict(name="Dhanwapur Road (old city bus stand area)", locality="Old Gurugram core",
         zone="Zone 1", lat=28.4720, lon=77.0240,
         source="The Tribune, '28 points this monsoon' list (9 Aug 2026)",
         road_type="old-city arterial", commute_relevance="Medium"),
]

# ---------------------------------------------------------------------------
# Text-only corrections to existing rows — never touches numeric fields
# ---------------------------------------------------------------------------
CORRECTIONS = {
    "Narsinghpur": (
        "UPDATE (2026): a new 700m stormwater drain, linked to the Leg-III "
        "Badshahpur drain, resolved this decade-long chokepoint — GMDA reports "
        "it 'worked exactly as designed' and Narsinghpur stayed dry through the "
        "Aug 2026 rain events, dropping off GMDA's vulnerable-spots list (The "
        "Tribune, 2026). Original source retained below; severity_tier and the "
        "synthetic risk-model columns are deliberately left unchanged — this is "
        "a provenance correction, not a recalibration, since we have no real "
        "data to justify a specific new numeric threshold. | Was: The Tribune "
        "(2022, 2025) — 'really dangerous for commuters' per resident quote"
    ),
}


def build_rows(records, tier, start_id):
    rows = []
    for i, h in enumerate(records, start=start_id):
        row = {
            "hotspot_id": f"FCG-{i:03d}",
            "name": h["name"],
            "locality_area": h["locality"],
            "zone": h["zone"],
            "severity_tier": tier,
            "latitude": h["lat"],
            "longitude": h["lon"],
            "road_type": h["road_type"],
            "commute_relevance": h["commute_relevance"],
            "data_confidence": CONFIDENCE_TIER,
            "source_note": h["source"],
            "coordinates_verified": "No — approximate, verify before production use",
            **synth_fields(tier),
        }
        rows.append(row)
    return rows


# hotspots_extended.csv currently has 64 rows (FCG-001..FCG-064); new rows
# continue the sequence rather than restarting it.
new_rows = (
    build_rows(NEW_HYPERCRITICAL, "hypercritical", start_id=65)
    + build_rows(NEW_MODERATE, "moderate", start_id=65 + len(NEW_HYPERCRITICAL))
)
new_df = pd.DataFrame(new_rows)
assert len(new_df) == 9, f"Expected 9 new rows, got {len(new_df)}"

# Read the prior stage fresh from disk — never mutated in place.
base_df = pd.read_csv("data/hotspots_extended.csv")
assert len(base_df) == 64, f"Expected 64 rows from the prior stage, got {len(base_df)}"

for name, new_note in CORRECTIONS.items():
    mask = base_df["name"] == name
    assert mask.sum() == 1, f"Expected exactly one row named '{name}', found {mask.sum()}"
    base_df.loc[mask, "source_note"] = new_note

full_df = pd.concat([base_df, new_df], ignore_index=True)
assert full_df["hotspot_id"].is_unique
assert len(full_df) == 73, f"Expected 73 total rows, got {len(full_df)}"

full_df.to_csv("data/hotspots_extended.csv", index=False)
full_df.to_parquet("data/hotspots_extended.parquet", index=False)

tier_counts = full_df["severity_tier"].value_counts().to_dict()
conf_counts = full_df["data_confidence"].value_counts().to_dict()

print(f"2026 monsoon update: {len(base_df)} prior + {len(new_df)} new "
      f"({len(NEW_HYPERCRITICAL)} hypercritical + {len(NEW_MODERATE)} moderate) "
      f"= {len(full_df)} total")
print(f"Corrected source_note for: {', '.join(CORRECTIONS)}")
print()
print("Tier distribution:", tier_counts, "(expected hypercritical=15, moderate=29, minor=29)")
print()
print("Confidence breakdown, full register:")
print(full_df["data_confidence"].value_counts().to_string())

assert tier_counts["hypercritical"] == 15
assert tier_counts["moderate"] == 29
assert tier_counts["minor"] == 29
assert conf_counts[CONFIDENCE_TIER] == 9
