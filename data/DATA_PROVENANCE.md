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
Run `python3 data/generate_hotspots.py` from the **repository root**
(the script writes to relative path `data/hotspots.csv`, so it must be run
from one level up). The random seed is fixed (42), so the synthetic
columns are reproducible — re-running produces byte-identical output.
Editing `HOTSPOTS` in that file is the only supported way to correct or
add a row; don't hand-edit the CSV, it'll drift from the generator.

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
Run `python3 data/generate_expansion.py` from the **repository root**
*after* `generate_hotspots.py` has already produced `hotspots.csv` — it
reads that file as input. Seed is fixed (43, deliberately different from
the base dataset's 42) for reproducibility. Edit `TIER_B`, `TIER_C`, or
`ATTRACTIONS` in that file to correct or extend; don't hand-edit the CSVs.

## 9. The 2026 monsoon season update (hotspots_extended.csv / .parquet) — 73 rows

A third script, `generate_2026_monsoon_update.py`, reads the 64-row
extended file (never modifies it in place) and adds 9 more rows, all
under a new confidence tier, `confirmed_named_2026_monsoon`.

### Why a new tier, not the existing ones
These nine are named by a direct, dated, on-record institutional source
from the *current* 2026 season — GMDA CEO P.C. Meena by name, or a
specific enumerated Tribune list — rather than inferred from severity
language across news coverage spanning several years, which is what
`confirmed_named_multi_source` means. That is *stronger*, more current
sourcing, and folding it into either existing confirmed tier would either
overstate or understate it. It gets its own label instead.

### What actually happened this monsoon (why this update exists)
Gurugram had a severe 2026 monsoon:
- A 97mm-in-a-day event that left "old Gurugram areas worst hit."
- An 8–9 August event — **225mm of rain over two consecutive days** — after
  which MCG Commissioner Pradeep Dahiya stated the city had identified
  **155 waterlogging-prone points** citywide. No structured list of all
  155 was published; only named examples (chiefly Sheetla Mata Road)
  appear in reporting.
- A 24 August event — **75mm in a single day** — that triggered a
  citywide work-from-home advisory for 25 August, stranded schoolchildren
  in buses for 3–6 hours, and produced traffic jams up to 4km long.

### The official counts do not reconcile — and this document will not pretend they do
As of the 2026 season, at least **four different agency framings** of
"how many flood points does Gurugram have" are in public circulation
simultaneously, and they are not the same list measured differently —
they come from different authorities, different methodologies, and
different dates:

| Count | Source | What it actually measures |
|---|---|---|
| 155 | MCG Commissioner Pradeep Dahiya, 9 Aug 2026 | Every point that showed *any* temporary waterlogging after a specific 225mm/2-day event — a high-water-mark count, not a standing list |
| 6 (was 7) | GMDA CEO P.C. Meena, 2026 | GMDA's own "vulnerable spots" — the most severe, chronic, currently-*unresolved* locations only; Narsinghpur was the 7th until its drain fix (see below) |
| ~40 | MCG, various 2026 reporting | Sites with *chronic sewer overflow combined with* poor drainage — a public-health framing, not a pure waterlogging count |
| 79 → 16 | GMDA, 2020 → 2024 (see section 6) | A *separate* master-roads tracking system, pre-dating the 2026 season, with no confirmed 2026 update |
| 28 | The Tribune, 9 Aug 2026 | Points the paper itself identified as "key waterlogging challenges" that specific monsoon — a press enumeration, not an official list |

Treat every one of these numbers as true for what it specifically
measures, and false the moment it is generalized into "Gurugram has N
flood points." This register — even at 73 rows — is not a claim to
completeness against any of them; it only contains points we can
individually name and source, at the confidence level disclosed per row.

### The nine new rows

**Hypercritical (5)** — the five other members of GMDA's current
"vulnerable spots" list. The sixth member, Khandsa Chowk, already exists
in this register as "Khandsa Road" (base 36, `confirmed_named_multi_source`)
and was not duplicated.

- Sheetla Mata Road — also #1 on the Tribune's separate "28 points this
  monsoon" list; an STP is specifically planned for it
- Jwala Mill Road
- Sector 28 (near Chakkarpur)
- Laxman Vihar
- Krishna Chowk

**Moderate (4)** — named on the Tribune's "28 points this monsoon" list,
not on GMDA's more severe 6-point list:

- Dundahera
- Surat Nagar
- Bajghera
- Dhanwapur Road (old city bus stand area)

Coordinates for all nine follow the exact same methodology as every other
row in this dataset: best-effort placement from the locality clusters the
sources themselves describe, not a geocoding call. `coordinates_verified`
is "No" for these nine as well.

### Narsinghpur — a text-only correction, not a recalibration
Narsinghpur (in the original 36, `confirmed_named_multi_source`,
hypercritical) has been Gurugram's most-cited chronic waterlogging point
for over a decade. In 2026, GMDA built a new 700m stormwater drain linked
to the Leg-III Badshahpur drain, and reports it "worked exactly as
designed" — Narsinghpur stayed dry through the Aug 2026 rain events and
came off GMDA's vulnerable-spots list.

Its `source_note` has been updated to record this. Its `severity_tier`
and all four synthetic risk-model columns are **deliberately left
unchanged**. We have a real, dated report that the underlying problem was
fixed, but no real data on the *degree* — adjusting one row's numeric
threshold to some specific new value with no calibration source behind it
would be exactly the kind of false precision this document exists to
prevent. A text correction is fully justified by direct sourcing; a
numeric one would not be.

### Full register confidence breakdown (73 rows)
- `confirmed_named_multi_source`: 26
- `plausible_real_unconfirmed_flood_status`: 24
- `reconstructed_estimate`: 10
- `confirmed_named_2026_monsoon`: 9
- `confirmed_named_mcg_zone1`: 4

**39 of 73 rows (53%) are sourced and named** — up from 30 of 64 (47%)
before this update, because all nine additions are sourced. Still don't
quote "73 hotspots" as a claim to completeness; see the table above.

### Sources
- The Tribune — "Gurugram drowns again... forces WFH order for Aug 25" (2026)
- The Tribune — "97mm rain leaves Gurugram flooded; Old city reels under
  waterlogging" (2026)
- New Kerala / ANI — "Gurugram identifies 155 waterlogging-prone points:
  Municipal Corporation Gurugram" (9 Aug 2026) — MCG Commissioner Pradeep
  Dahiya quoted directly
- The Tribune — "Narsinghpur beats decade-long waterlogging; Gurugram
  hotspots drop from 7 to 6" (2026) — GMDA CEO P.C. Meena quoted directly
- The Tribune — "Gurugram's poster child for waterlogging Narsinghpur
  rises above decade-old tag" (2026)

## 10. Regenerating the 2026 monsoon update
Run `python3 data/generate_2026_monsoon_update.py` from the **repository
root** *after* `generate_expansion.py` has produced
`hotspots_extended.csv` — it reads that file as input. Seed is fixed (44).
Edit `NEW_HYPERCRITICAL`, `NEW_MODERATE`, or `CORRECTIONS` in that file to
correct or extend; don't hand-edit the CSVs. Regenerating the full
register from scratch is therefore a four-step chain, the last stage
exporting the JSON the app actually ships:

```bash
python3 data/generate_hotspots.py
python3 data/generate_expansion.py
python3 data/generate_2026_monsoon_update.py
python3 data/export_to_frontend.py
```

CI runs exactly this chain on every push and fails if the result differs
from what is committed, so the register the app ships can always be traced
back to the sourcing recorded here.
