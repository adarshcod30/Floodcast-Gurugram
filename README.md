# FloodCast Gurugram

**Given the current rainfall forecast, will my route through Gurugram be risky in the next few hours — and when exactly?**

That question is the whole product. Not a hotspot map (anyone can already Google the famous flood-prone chowks), and not a citizen-reporting tool (MCG already runs one). The value is the forward-looking, time-windowed, route-level verdict: not *"Iffco Chowk floods"* but *"Iffco Chowk floods from about 5:15 PM and clears by about 9:00 PM — leave before 5 and you miss it."*

A risk score with no time attached is not an answer to *"should I leave now"*, so this system never produces one.

---

## Read this first: what is real and what is not

This project treats data honesty as a product requirement, not a disclaimer. The distinction below is visible in the API responses, on the map, in the register, and on a dedicated **"What's real"** tab in the app — not buried in a CSV column.

### This monsoon

Gurugram had a severe 2026 season: a 97mm-in-a-day event that left old Gurugram worst hit, an 8–9 August event — **225mm over two days** — after which MCG's Commissioner said the city had identified **155 waterlogging-prone points**, and a **75mm day on 24 August** that triggered a citywide work-from-home advisory, stranding schoolchildren in buses for 3–6 hours ([The Tribune](https://www.tribuneindia.com/news/gurugram/gurugram-drowns-again-millennium-citys-poshest-mile-goes-under-forces-wfh-order-for-aug-25/), [New Kerala/ANI](https://www.newkerala.com/news/a/gurugram-identifies-155-waterlogging-prone-points-municipal-corporation-gurugram-984.htm)).

None of the official counts agree with each other. MCG's 155, GMDA's own 6-point "vulnerable spots" list, a separate ~40-site chronic-sewer list, and a 28-point list the Tribune itself enumerated all measure different things, from different agencies, at different dates. This register does not claim to match any of them — see [`DATA_PROVENANCE.md`](backend/data/DATA_PROVENANCE.md) §9 for the full reconciliation, or the lack of one.

### The hotspot register — 39 of 73 points are sourced

| Count | Tier | What it means |
|---:|---|---|
| **4** | `confirmed_named_mcg_zone1` | Named directly in MCG's own Zone 1 hotspot list |
| **26** | `confirmed_named_multi_source` | A recurring waterlogging point in two or more independent news reports, 2022–2025 |
| **9** | `confirmed_named_2026_monsoon` | Named by a dated, on-record institutional source from the *current* season — GMDA's CEO by name, or a specific enumerated Tribune list — added after this monsoon's events |
| **24** | `plausible_real_unconfirmed_flood_status` | A real Gurugram locality on low ground or near a bad corridor. **No source confirms it floods.** A watchlist, not a finding |
| **10** | `reconstructed_estimate` | Not found named in any source. Present only to preserve MCG's official 36-point count. **A placeholder, not a fact** |

**Do not quote "73 hotspots" as though it carries the weight of "36 hotspots," or as a claim to match MCG's 155.** Expanding the register diluted average confidence relative to the original 36 (72% sourced), even though this round's nine additions are all sourced. That trade-off is documented rather than hidden.

### The risk model is calibrated, not measured

Four columns drive every risk score — `rainfall_threshold_mm_per_hr`, `time_to_flood_after_threshold_min`, `typical_drain_time_hr`, `drainage_capacity_score`. **All four are engineering estimates**, set by severity tier, with no historical rainfall-versus-flood record behind them.

The scoring *logic* is sound and tested. The *inputs* are not measurements. This is precisely the piece that becomes real the day GMDA shares historical flood-report data, and the schema is deliberately shaped so that swapping in calibrated values is a data update, not a rewrite.

### Every coordinate is approximate

No geocoding API placed these points; they are best-effort positions from Gurugram's sector layout and road network. `coordinates_verified` is `No` for all 73 rows, on purpose, as a standing reminder. `scripts/verify_coordinates.py` audits them against OpenStreetMap and writes a review report — it never edits the data.

### Route risk is straight-line corridor matching, not routing

The system draws the direct line between origin and destination and finds hotspots within a 1.5 km buffer of it. **Your actual drive may follow entirely different roads.** There is no turn-by-turn routing engine here. This is a deliberate, disclosed simplification, stated in the API response (`routing_method`, `disclaimer`) and in every route answer the app gives.

Full methodology: [`backend/data/DATA_PROVENANCE.md`](backend/data/DATA_PROVENANCE.md).

---

## What it does

- **Time-windowed risk for 73 flood points.** Compares live hourly rainfall against each point's threshold and computes when it floods and when it clears.
- **Route verdicts.** Resolves two place names, finds the hotspots along the corridor between them, and returns the worst point and worst window.
- **An hourly risk timeline.** Scrub forward through the forecast and watch the map, the verdict and the register re-read at that hour.
- **CPCB National AQI.** The 0–500 scale Indian residents and officials actually use, computed from a 24-hour pollutant mean — not a vendor's 1–5 index.
- **Citizen reports.** Genuinely crowdsourced and genuinely empty until someone files something.

### It runs with no configuration at all

No API keys, no cloud account, no signup:

- **Rainfall** comes from [Open-Meteo](https://open-meteo.com), which requires no key and reports **hourly** precipitation. (OpenWeatherMap's free tier returns 3-hour buckets; averaging a 12 mm cloudburst across three hours yields 4 mm/hr — under the flooding threshold of *every* hypercritical point in the register. Short, intense bursts are exactly what floods Gurugram, and exactly what averaging hides.)
- **Risk scoring** is pure computation over static data.
- **The chat pipeline** falls back to a deterministic rule-based engine when no LLM is configured. That path is written as a first-class experience, not a degraded placeholder — it is what you see on a fresh clone, and what the tool falls back to during exactly the infrastructure strain a flood tends to cause.

AWS Bedrock and OpenWeatherMap are upgrades, never prerequisites.

---

## Quick start

```bash
git clone <your-repo-url> && cd floodcast-gurugram
```

**Backend** (Python 3.11+):

```bash
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/uvicorn app.main:app --reload --port 8000
```

**Frontend** (Node 20+), in a second terminal:

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. Interactive API docs are at http://localhost:8000/docs.

---

## Architecture

```
                    Open-Meteo (hourly, keyless)          AWS Bedrock (optional)
                              │                                    │
                              ▼                                    ▼
  Parquet ──DuckDB──▶  ┌──────────────┐   ┌──────────────┐   ┌───────────┐
  73 hotspots          │   Forecast   │──▶│ Risk engine  │──▶│ LangGraph │
  8 landmarks          │  cache 1h    │   │ (pure funcs) │   │  agents   │
                       └──────────────┘   └──────────────┘   └───────────┘
                                                  │                 │
                                                  ▼                 ▼
                                          FastAPI ── React + Leaflet (Vercel)
                                          (Render)
```

**Backend** FastAPI · DuckDB over Parquet (no database service to run) · LangGraph agents over Claude on Bedrock
**Frontend** React + TypeScript + Leaflet/OpenStreetMap · hand-written CSS, no UI framework

### Where the logic lives

| Path | Responsibility |
|---|---|
| [`backend/app/core/risk_engine.py`](backend/app/core/risk_engine.py) | **The core.** Pure, deterministic time-windowed scoring |
| [`backend/app/core/route_engine.py`](backend/app/core/route_engine.py) | Point-to-line-segment corridor matching |
| [`backend/app/core/providers/`](backend/app/core/providers/) | Weather providers, each normalised to one shape |
| [`backend/app/core/aqi.py`](backend/app/core/aqi.py) | CPCB National AQI, pure functions |
| [`backend/app/agents/`](backend/app/agents/) | Orchestrator → Forecast → Route → Verdict |
| [`frontend/src/components/RainTimeline.tsx`](frontend/src/components/RainTimeline.tsx) | The rain-gauge timeline |

**Risk scoring exists in exactly one place.** The frontend re-derived it once, with a formula that dropped the tier weight and drainage factor, so the timeline contradicted the backend about the same hotspot at the same moment. `/api/v1/timeline` now returns server-computed frames and the client only renders.

---

## Design

Two rules hold the interface together, and both encode the honesty thesis visually:

**Colour only ever means risk.** The chrome is greyscale slate. The only saturated colour is the [IMD rainfall warning band](https://mausam.imd.gov.in) — the green/yellow/orange/red scale used in official Indian advisories. Nothing is tinted decoratively, so when something is orange it is orange because the rain says so.

**Fill means certainty.** A solid marker is sourced and named; a hollow ring is an unconfirmed watchlist entry; a dotted ring is a structural placeholder. Provenance is legible at a glance, on the map and in the register, without consulting a legend.

The signature element is the **rain-gauge timeline**: one barrel per forecast hour, filled by depth, tinted by band, and driving the verdict, map and register together. Every comparable tool is a map with pins where time is a footnote; here the time axis is the primary control, because time is what the product is actually about.

---

## Prior art — this doesn't exist in a vacuum

Two other things already address parts of this problem, and this project neither duplicates nor ignores them:

**[FloodWatch Gurgaon](https://floodwatchgurgaon.in)** is an independent, volunteer-built project covering 700+ areas with a static "Monsoon Readiness Score" (0–100, from elevation, drainage and historical incidents) and a rain simulator for testing hypothetical scenarios. It also uses Open-Meteo. The mechanism is different from this project's: MRS is a per-area seasonal-readiness score you check once; this tool reads the *live* forecast and answers a *route*, with an explicit time window, on demand. Neither approach makes the other redundant — they answer different questions. FloodWatch's complaint-email and ward-contact tooling is a genuine feature this project doesn't have; see below for the honest substitute.

**GMDA runs a 24×7 Flood Control Office** — a real-time monitoring room (Integrated Control & Command Centre), not a predictive tool, with a public helpline: **1800-180-1817** / **0124-4753555**. This project cannot make the city deploy a pump or clear a drain. If a verdict here says a route is critical, the number to actually call is that one — surfaced directly in the app's Reports and About tabs, not left for the user to go find.

---

## API

Base URL `http://localhost:8000` · full OpenAPI docs at `/docs`

| Method | Endpoint | Returns |
|---|---|---|
| `GET` | `/health` | Dependency status from cached state. Never triggers an upstream call |
| `GET` | `/api/v1/hotspots` | 73 hotspots with current risk, time window and `data_confidence` |
| `GET` | `/api/v1/attractions` | 8 landmarks. **Never** carries a risk field |
| `GET` | `/api/v1/forecast` | Cached rainfall, with provider, resolution and attribution |
| `GET` | `/api/v1/timeline` | Per-hour risk projection for every hotspot |
| `GET` | `/api/v1/air-quality` | CPCB National AQI, or `available: false` |
| `POST` | `/api/v1/chat` | Natural-language point or route verdict. Rate limited |
| `GET` `POST` | `/api/v1/reports` | Citizen reports — list, or file one |
| `POST` | `/api/v1/reports/{id}/confirm` | Corroborate a report |

### `/health` is built for an uptime monitor

It reads last-known state only — no weather call, no LLM call — so polling it every five minutes cannot burn a free-tier quota or run up a bill, and the check never depends on the thing it is checking.

It also distinguishes **degraded** from **down**. A missing LLM is a supported operating mode, not an outage; reporting it as one would train whoever is on call to ignore the alert. Only a failure to load the hotspot register returns `503`.

---

## Configuration

Every variable is optional. See [`backend/.env.example`](backend/.env.example).

| Variable | Default | Notes |
|---|---|---|
| `WEATHER_PROVIDER` | `open-meteo` | Or `openweathermap` (needs a key) |
| `OPENWEATHERMAP_API_KEY` | — | Optional. [Free key](https://openweathermap.org/api) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | Optional. Without them, chat runs rule-based |
| `AWS_REGION` | `us-east-1` | Region where Bedrock model access is granted |
| `BEDROCK_HAIKU_MODEL_ID` | `anthropic.claude-haiku-4-5` | Routing and place-name parsing |
| `BEDROCK_SONNET_MODEL_ID` | `anthropic.claude-sonnet-5` | Final verdict synthesis |
| `ALLOWED_ORIGINS` | localhost | Comma-separated exact origins. Never a wildcard |
| `CHAT_RATE_LIMIT` | `10/minute` | The only endpoint that costs money |
| `NOMINATIM_CONTACT` | — | Nominatim returns **403** without a real contact address |

Frontend: `VITE_API_BASE_URL` (see [`frontend/.env.example`](frontend/.env.example)).

**Enabling Bedrock** requires three things, and the second is a manual approval that is not instant: an AWS account, **granted model access** for Claude Haiku and Sonnet in your region (Console → Bedrock → Model access), and an IAM principal with `bedrock:InvokeModel`. Bedrock model IDs are the first-party Claude IDs with an `anthropic.` prefix.

---

## Deployment

### Backend → Render

1. **New → Blueprint**, point at this repo. [`backend/render.yaml`](backend/render.yaml) defines the service.
2. Set the root directory to `backend/`.
3. Fill the `sync: false` secrets in the dashboard, or leave them blank — the service runs without them.
4. Confirm `https://<your-service>.onrender.com/health` returns `200`.

> The free tier sleeps after ~15 minutes idle and takes 30–60s to wake. Point an external uptime monitor (UptimeRobot's free tier works) at `/health` to keep it warm. The frontend already handles the cold start explicitly, telling the user the server is waking rather than appearing to hang.
>
> Free-tier instances have no persistent disk, so the citizen-report store resets on redeploy. Attach a Render disk, or move the store to Postgres, if reports must survive.

### Frontend → Vercel

1. **New Project**, root directory `frontend/`. Vercel detects Vite; [`vercel.json`](frontend/vercel.json) supplies the SPA rewrite.
2. Set `VITE_API_BASE_URL` to your Render URL.
3. Add that Vercel URL to `ALLOWED_ORIGINS` on Render, then redeploy the backend.

---

## Development

```bash
cd backend && .venv/bin/python -m pytest tests -q      # 107 tests
cd backend && .venv/bin/python -m ruff check app tests
cd frontend && npm run build                            # type-check + build
```

CI runs all of the above on every push, plus a Docker build that boots the container and waits for `/health` — Render builds from that Dockerfile, so a broken image fails in CI rather than at deploy time. The suite runs with **no secrets configured**, which is deliberate: it must pass in the same zero-configuration mode a fresh clone runs in.

The tests assert product invariants, not just status codes — that `data_confidence` survives the whole pipeline, that attractions never leak a risk field, that any nonzero risk carries a time window, and that every timestamp has a timezone offset.

### Regenerating the datasets

The CSVs are static input, loaded once at startup. All three generators use fixed seeds, so output is byte-identical across runs. **Run from `backend/`, not `backend/data/`** — each script writes to a path relative to `backend/`.

```bash
cd backend
python3 data/generate_hotspots.py            # the 36-row official-structure base
python3 data/generate_expansion.py           # reads the base, writes the 64-row register
python3 data/generate_2026_monsoon_update.py # reads that, writes the 73-row register
```

**Edit the generators, never the CSVs** — a hand-edited CSV drifts from its generator and the next regeneration silently discards the correction.

### Auditing coordinates

```bash
python scripts/verify_coordinates.py --tier hypercritical --out audit.md
```

Writes a report of distances between dataset coordinates and OpenStreetMap. It never modifies the data: OSM is not ground truth for a Gurugram chowk, and auto-applying its answers would replace coordinates honestly labelled *approximate* with ones that merely look authoritative.

---

## Known limitations

Stated plainly, because a tool that overstates its confidence is worse than no tool:

1. **The risk model is uncalibrated.** Thresholds and drain times are tier-based estimates. Treat every timing as directional.
2. **34 of 73 points are unconfirmed or placeholder.** Filter to sourced-only in the register or on the map to see just the 39 that are backed by a named source.
3. **Coordinates are approximate.** A pin means "this junction, roughly", never a survey position.
4. **Routes are straight-line corridors.** Not turn-by-turn.
5. **Forecast, not observation.** No rain gauge or ground sensor feeds this system. It reasons about what a weather model predicts, which is not the same as what is happening on the road right now — which is exactly why citizen reports exist alongside it.
6. **Rainfall is one input among several.** Drain blockage, upstream release and construction all cause flooding this model cannot see.

---

## For evaluators at MCG / GMDA

The parts most likely to matter to you:

- **The register is auditable.** Every point carries its provenance tier and source note, from the CSV through the API to the UI. Nothing in this system claims more confidence than its source supports.
- **Nothing is fabricated.** An earlier version of this project served invented power outages, roadworks and transit status as if they were live. All of it was deleted rather than relabelled. Citizen reports start empty and only ever contain real submissions.
- **The synthetic layer is isolated and swappable.** Four documented columns hold every estimate. Given historical rainfall-versus-flood-report data, replacing them is a data update — the scoring logic, API and UI stay as they are.
- **It degrades predictably.** No weather feed, no LLM, no internet beyond the forecast fetch: the register and its thresholds still answer. That matters because a flood tool is needed most at the moment its dependencies are least reliable.

The most valuable thing GMDA could contribute is historical rainfall-versus-flood-report pairs for even a handful of hypercritical points. That single dataset converts this from a plausible model into a calibrated one.

---

## Credits & licence

Rainfall and air quality from [Open-Meteo](https://open-meteo.com) (CC-BY 4.0). Map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Warning colours follow the [India Meteorological Department](https://mausam.imd.gov.in) scheme. Hotspot classification derived from MCG and GMDA public reporting and independent news coverage, 2022–2026 — see [`DATA_PROVENANCE.md`](backend/data/DATA_PROVENANCE.md) for every source.

MIT.
