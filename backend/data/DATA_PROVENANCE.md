# FloodCast Gurugram — Hotspot Dataset: Data Provenance

This document exists so that nobody — including future-you — mistakes the
synthetic parts of this dataset for verified fact. Read it before you build
on top of `hotspots.csv` / `hotspots.parquet`.

## 1. What's actually official (verified against public reporting)
- **Total hotspot count: 36** — MCG's 2026 pre-monsoon classification.
- **Tier distribution: 10 hypercritical / 18 moderate / 8 minor.**
- **Zone split: Zone 1 = 13 points, Zone 2 = 23 points.**
- MCG has explicitly named four Zone 1 hotspots in public reporting:
  Sector 10A, Gandhi Nagar Booster, Begumpur Khatola, Fazilpur.
- A separate, independent June 2026 initiative — the Gurugram Waterlogging
  Portal — lets residents submit photo-based flood reports directly to
  civic authorities for drainage-upgrade prioritization. (This project does
  not duplicate that portal — see the main project README for why.)

These are the only facts in this dataset backed by an official source.
Everything else below is inference or synthesis, clearly labeled.

## 2. How the 36 rows were populated

| Confidence label | Count | What it means |
|---|---|---|
| `confirmed_named_mcg_zone1` | 4 | Explicitly named by MCG in its own Zone 1 hotspot list |
| `confirmed_named_multi_source` | 22 | Named as a recurring waterlogging point in 2+ independent news reports spanning 2022–2025 (Tribune, NewsX, Business Standard). Real, well-documented chokepoints — but their specific tier/zone placement in *this* dataset is our inference from the severity language used in coverage ("really dangerous," "notorious choke point," "heavily inundated" → hypercritical; "disrupted," "affected" → moderate), not a verbatim MCG label. |
| `reconstructed_estimate` | 10 | Not found named in any source reviewed. These exist purely to fill the count up to the official 36 and preserve the official tier distribution. Locations were chosen for general plausibility (known flood-prone districts), nothing more. **Treat these 10 rows as placeholders, not facts.** |

**Bottom line: 26 of 36 rows (72%) are real, named, multiply-sourced locations. 10 are structural placeholders.**

### Sources consulted
- MCG 2026 pre-monsoon hotspot classification (public reporting)
- Gurugram Waterlogging Portal launch coverage, June 2026
- The Tribune — "Commuters face tough time as heavy rain leads to waterlogging..." (2022)
- NewsX — "Heavy Rains Trigger Severe Waterlogging in Gurugram..." (2024), including direct quotes from MCG Commissioner Narhari Singh Bangar naming specific hotspots
- Business Standard — "Gurugram drowns in heavy rain, flooding..." (2025)
- The Tribune — "Despite Rs 500-cr spend, Gurugram sinks every monsoon" (2025)

## 3. Coordinates
Every single row — including the 26 "real" ones — has **approximate,
uncorroborated coordinates**. No geocoding API was called; these are
best-effort placements based on general knowledge of Gurugram's road
network and sector layout. `coordinates_verified` is "No" for all 36 rows
by design, as a standing reminder.

**Before this is anything more than a personal project**, at minimum
verify the 10 hypercritical-tier coordinates against Google Maps — that's
a 10-minute task, and those are the rows a wrong pin would matter most for.

## 4. The synthetic risk model — the part that most needs real data
Four columns are entirely fabricated, calibrated only by severity tier,
with no real historical flood-vs-rainfall record behind them:
- `rainfall_threshold_mm_per_hr`
- `time_to_flood_after_threshold_min`
- `typical_drain_time_hr`
- `drainage_capacity_score`

Calibration ranges used:

| Tier | Rainfall threshold (mm/hr) | Time to flood (min) | Drain time (hr) | Drainage score |
|---|---|---|---|---|
| Hypercritical | 15–22 | 20–40 | 3.0–6.0 | 0.10–0.30 |
| Moderate | 25–35 | 40–90 | 1.5–3.0 | 0.35–0.60 |
| Minor | 40–55 | 90–150 | 0.5–1.5 | 0.65–0.85 |

These ranges are engineering placeholders chosen to produce plausible,
internally-consistent behavior (hypercritical spots flood fast on modest
rain and drain slowly; minor spots need heavy sustained rain and clear
quickly) — not validated predictions. **This is exactly the piece that
would become real if GMDA ever shared historical rainfall-vs-flood-report
data.** The column names and structure are deliberately kept generic so
that swapping synthetic values for real, spot-calibrated ones later is a
data update, not a code rewrite.

## 5. Regenerating this dataset
Run `python3 generate_hotspots.py` from the `floodcast/` directory. The
random seed is fixed (42), so the synthetic columns are reproducible —
re-running produces byte-identical output. Editing `HOTSPOTS` in that file
is the only supported way to correct or add a row; don't hand-edit the CSV,
it'll drift from the generator.

## 6. The expansion (hotspots_extended.csv / .parquet) — 64 rows
A second script, `generate_expansion.py`, reads the original 36-row file
(never modifies it) and adds 28 more rows, producing `hotspots_extended.csv`.

**Important: no official "72-point" list was found.** Before building
this, MCG/GMDA official coverage, multiple news archives, GMDA's own
website, and real-estate portals were searched specifically for a
verified 72-hotspot figure. None was found. The only other official
figure that exists is a *separate* GMDA tracking system (different
authority, different roads — GMDA's master roads vs. MCG's municipal
roads) that went from 79 flood-prone points in 2020 to 16 in 2024, with
no 2026 update located. That is NOT the same list as MCG's 36, and
neither adds up to 72.

Given that, the 28 new rows are honestly labeled in two tiers, on top of
the three tiers from section 2:

| Confidence label | Count | What it means |
|---|---|---|
| `confirmed_named_multi_source` (added to) | +4 | Real waterlogging points confirmed via fresh research (Golf Course Road itself, Judges Enclave, Dwarka Expressway Sectors 112-115, Old Delhi-Gurgaon Road) — sourced, just not part of MCG's specific 36-point classification |
| `plausible_real_unconfirmed_flood_status` | 24 | **New tier.** Real, verifiable Gurugram localities (they genuinely exist) included because they sit on low-lying ground or near known-bad corridors. No source confirms these specifically flood. Treat this tier as a watchlist, not a finding. |

**Full register confidence breakdown (64 rows):**
- `confirmed_named_multi_source`: 26
- `plausible_real_unconfirmed_flood_status`: 24
- `reconstructed_estimate`: 10
- `confirmed_named_mcg_zone1`: 4

In other words: 30 of 64 rows (47%) are sourced and named. 34 of 64 (53%)
are either structural placeholders or unconfirmed watchlist entries. This
is a real drop in overall confidence compared to the original 36 (which
was 72% sourced) — expanding the register necessarily diluted average
confidence, because the additional real, sourced spots ran out. Don't
quote "64 hotspots" as if it carries the same weight as "36 hotspots."

## 7. attractions.csv / .parquet — a separate table, not a flood classification
8 real, multi-source-confirmed Gurugram landmarks (Kingdom of Dreams,
Cyber Hub, Ambience Mall, Leisure Valley Park, Aravalli Biodiversity Park,
Sheetla Mata Mandir, Galleria Market, Sultanpur National Park). These
exist purely so the app can be useful as a general "is this place
reachable" tool, not to make any flood-risk claim about them. They have
no severity tier, no synthetic risk fields, and should never be joined
into the hotspot risk logic as if they were hotspots.

## 8. Regenerating the expansion
Run `python3 generate_expansion.py` from the `floodcast/` directory
*after* `generate_hotspots.py` has already produced `hotspots.csv` — it
reads that file as input. Seed is fixed (43, deliberately different from
the base dataset's 42) for reproducibility. Edit `TIER_B`, `TIER_C`, or
`ATTRACTIONS` in that file to correct or extend; don't hand-edit the CSVs.
