# FloodCast Gurugram — Full Build Prompt for Antigravity

Paste everything below this line into Antigravity as one prompt. The data
files it references are already sitting in `backend/data/` in this
project folder — point Antigravity at this folder as the working
directory before running the prompt.

---

## What you are building

**FloodCast Gurugram** — a decision-intelligence tool that answers one
specific question no existing tool answers: *"Given the current rainfall
forecast, will my route through Gurugram be risky in the next few hours
— and when exactly?"*

This is not a static hotspot map (anyone can already Google the famous
flood-prone chowks) and not a citizen-reporting tool (MCG already runs
one). The entire value of this product is the **forward-looking,
time-windowed, route-level risk verdict** — nothing else. Every
architectural decision below exists in service of that one mechanism.
Do not let the build drift toward "just another map with pins."

Treat data honesty as a first-class product requirement, not an
afterthought. This project's dataset is a deliberate mix of confirmed-real
and clearly-labeled-synthetic data (documented in
`backend/data/DATA_PROVENANCE.md`), and that distinction must be visible
end to end — in the API responses and in the UI — not just buried in a
CSV column nobody reads. A user or a government official looking at this
tool should always be able to tell which numbers are sourced fact and
which are engineering estimates.

## The data you already have — do not regenerate or invent more

In `backend/data/` you will find:
- `hotspots_extended.csv` and `.parquet` — **64 rows, this is the dataset
  the app runs on.** Columns: `hotspot_id`, `name`, `locality_area`,
  `zone`, `severity_tier` (hypercritical/moderate/minor), `latitude`,
  `longitude`, `road_type`, `commute_relevance` (High/Medium/Low),
  `data_confidence` (confirmed_named_mcg_zone1 /
  confirmed_named_multi_source / plausible_real_unconfirmed_flood_status /
  reconstructed_estimate), `source_note`, `coordinates_verified`,
  `rainfall_threshold_mm_per_hr`, `time_to_flood_after_threshold_min`,
  `typical_drain_time_hr`, `drainage_capacity_score`.
- `hotspots.csv` / `.parquet` — the original 36-row official-structure
  subset. Keep this as a reference copy; the app itself reads the
  extended 64-row file, not this one.
- `attractions.csv` / `.parquet` — **8 rows, landmarks only** (Cyber Hub,
  Kingdom of Dreams, Ambience Mall, etc.). Columns: `poi_id`, `name`,
  `category`, `locality`, `lat`, `lon`, `source`. These have **no
  severity tier and no risk fields** — never compute a flood risk score
  for a row in this file, and never merge it into the hotspot table.
  It exists purely as a second map layer / reference layer so the app is
  useful as a general "is this place reachable" tool.
- `DATA_PROVENANCE.md` — full methodology and honesty notes. Read this
  file before writing any code that touches the data. Several fields
  (all four risk-model columns, and every latitude/longitude in the
  dataset) are explicitly synthetic or unverified approximations — the
  document explains exactly which and why.
- `generate_hotspots.py` and `generate_expansion.py` — the scripts that
  produced the CSVs. Keep them in the repo for future regeneration, but
  do not run them as part of the app's runtime — the CSVs are static
  input data, loaded once at startup.

Do not fabricate additional hotspots, additional attractions, or
higher-precision coordinates than what's provided. If you want to add a
coordinate-verification utility, see the "optional nice-to-have" section
near the end — it must be a separate, clearly-labeled one-time script,
never something that silently overwrites the existing data.

## Full tech stack

- **Backend:** FastAPI (Python), running on Render (free web service tier)
- **Data access:** DuckDB, querying the Parquet files directly and
  in-process — no separate database service for the reference data
- **LLM / reasoning:** AWS Bedrock (Claude models), called via boto3
- **Agent orchestration:** LangGraph
- **Weather:** OpenWeatherMap API (forecast endpoint), with caching
- **Frontend:** React + TypeScript + Tailwind CSS, running on Vercel
- **Map:** Leaflet with OpenStreetMap tiles — no Google Maps, no API key
  needed for the map itself
- **Uptime monitoring:** a `/health` endpoint designed to be polled by
  UptimeRobot (external, free, set up separately after deployment — not
  part of the codebase, but the endpoint's response shape matters, see
  below)

## The core mechanism — build this first, and get it right

This is the single most important piece of the entire project. Everything
else (agents, API, frontend) is a wrapper around this logic.

**Per-hotspot risk scoring:** For each of the 64 rows, compare the live
rainfall forecast (intensity in mm/hr, and how long that intensity is
expected to persist) against that row's `rainfall_threshold_mm_per_hr`.
When forecast intensity is projected to meet or exceed a hotspot's
threshold, compute an estimated time until that hotspot floods using
`time_to_flood_after_threshold_min`, and estimate how long it stays risky
using `typical_drain_time_hr`. The output for each hotspot must be a
**risk score with an explicit time window** (e.g. "hypercritical risk
starting ~5:15 PM, likely clear by ~9:00 PM"), never a bare yes/no and
never a risk score with no time attached to it — a risk number without a
time window is not useful for the "should I leave now" decision this
product exists to answer.

**Route-level aggregation:** When a user asks about a route between two
places, the system must (a) resolve both place names to coordinates using
the data already available — first check if the name matches a hotspot or
attraction in the provided datasets, and if not, use a lightweight
free-tier geocoding lookup — then (b) identify which hotspots fall within
a reasonable buffer distance of the straight-line path between origin and
destination (a simple point-to-line-segment distance calculation is
sufficient; do not attempt to build or integrate a full turn-by-turn
routing engine, that is explicitly out of scope), then (c) combine the
individual time-windowed risk scores of every hotspot on that corridor
into one overall verdict for the trip, stating the worst-case point and
worst-case time window along the route. Be explicit in the UI copy and
README that this is straight-line corridor risk, not turn-by-turn routing
— don't let this simplification be silently implied as more precise than
it is.

**Graceful degradation:** If the Bedrock call or the weather API call
fails for any reason, the system must fall back to a pure rule-based
version of the same scoring logic (no LLM involved) rather than returning
an error or crashing. The point of this tool is to be reliable at the
exact moment someone needs it, which is often exactly when infrastructure
is under strain.

## Backend requirements

Build a FastAPI application with the following endpoints:
- `GET /health` — returns overall status, plus individual checks for
  DuckDB/data load success, weather API reachability, and Bedrock
  reachability. Must respond quickly and must not itself trigger a fresh
  weather or Bedrock call every time it's hit (that would defeat its
  purpose as an uptime check) — check cached/last-known state instead.
- `GET /api/v1/hotspots` — returns all 64 hotspots with their current
  computed risk score and time window, plus their `data_confidence` tier
  so the frontend can visually distinguish confirmed-real from
  unconfirmed-watchlist entries.
- `GET /api/v1/attractions` — returns the 8 landmark POIs, unmodified,
  no risk fields.
- `GET /api/v1/forecast` — returns the current cached rainfall forecast
  (refresh this on an hourly cache TTL, not on every request).
- `POST /api/v1/chat` — accepts a natural-language query (point question
  or route question) and returns the LangGraph pipeline's plain-English
  verdict, including which hotspots it reasoned over and their
  `data_confidence` tiers, so the answer is auditable, not a black box.

Non-negotiable reliability features:
- Rate limiting on `/api/v1/chat` (this is the endpoint that costs money
  via Bedrock and could be abused)
- Input validation via Pydantic models on every endpoint
- CORS restricted to the exact Vercel frontend origin, not a wildcard
- Structured logging to stdout (Render captures this for free — no
  separate logging service needed)
- Auto-generated OpenAPI docs at `/docs` (FastAPI gives you this for
  free, just don't disable it)
- All secrets (AWS credentials, OpenWeatherMap key) read from environment
  variables, never hardcoded, never committed

## LangGraph agent architecture

Build these as distinct LangGraph nodes under one orchestrator:
- **Orchestrator** — routes the incoming query to determine if it's a
  point question or a route question, and sequences the other agents
- **Forecast Agent** — fetches/reads the cached rainfall forecast and
  interprets it into the intensity/duration terms the scoring logic needs
- **Route Agent** — only invoked for route-style questions; resolves
  place names and performs the corridor-matching described above
- **Verdict Agent** — takes the scored hotspot(s) and produces the final
  plain-English, time-windowed answer

For the Bedrock model calls, use a cost-tiered approach: a fast/cheap
Claude model (Haiku-class) for the routing/parsing/place-name-resolution
steps, and a stronger Claude model (Sonnet-class) only for the final
Verdict Agent's synthesis step, where reasoning quality actually matters.
Check AWS Bedrock's currently available Claude model IDs at build time
rather than assuming specific version strings, and make the model IDs
configurable via environment variables so they can be updated without a
code change.

## Frontend requirements

Build a React + TypeScript + Tailwind single-page app with:
- A Leaflet map (OpenStreetMap tiles) as the main view, with two toggleable
  layers: hotspots (colored by current computed risk, not just static
  severity tier) and attractions (a visually distinct marker style/icon
  set, clearly not part of the risk layer)
- Hotspot markers must visually communicate their `data_confidence` tier
  in some way (e.g. a small icon or border style difference) — don't let
  a reconstructed/unconfirmed placeholder look identical to a confirmed,
  sourced hotspot on the map
- A chat panel component (not a full-page reload per message) for both
  point and route natural-language queries
- Clear loading states while the backend is cold-starting (Render free
  tier sleeps after inactivity — the UI should communicate "waking up the
  server" rather than looking broken during that 30-60 second delay)
- Clear error states if the backend is unreachable
- Responsive layout that works on mobile — this is a tool people will
  check right before leaving the house, likely on a phone
- The backend base URL must be read from a build-time environment
  variable, not hardcoded, so it can point at the Render URL in
  production and localhost during development

## Deployment requirements

- Backend: include whatever Render needs to auto-build and run the
  FastAPI app (a `render.yaml` and/or a `Dockerfile`, your choice of
  whichever is more reliable for a Python/FastAPI service on Render's
  free tier), with the required environment variables documented in the
  README (AWS credentials, Bedrock model ID variables, OpenWeatherMap
  key, allowed CORS origin)
- Frontend: standard Vercel auto-detection for a React app should work
  with minimal config, but include a `vercel.json` if any redirect/rewrite
  rules are needed for client-side routing
- Confirm the `/health` endpoint responds correctly once deployed, since
  an external uptime monitor (set up separately, outside this codebase)
  will depend on it both for alerting and for keeping the free-tier
  backend from fully sleeping

## Testing requirements

- Unit tests for the risk-scoring logic are the highest priority in this
  entire test suite — these are pure functions with deterministic
  expected outputs given a fixed forecast input and the static dataset,
  so they should be thoroughly covered
- Basic endpoint tests for all five API routes, including a test that
  confirms `/api/v1/attractions` never contains a severity or risk field
- A test that loads both Parquet files through DuckDB and confirms row
  counts match what's documented in `DATA_PROVENANCE.md` (64 and 8) —
  this catches silent data corruption early
- Include a GitHub Actions workflow that runs lint and the test suite on
  every push

## Documentation requirements

The README must include:
- What the project does and why (the one-liner and the honest USP —
  route/time-window risk answers, not a hotspot map, not a reporting tool)
- Setup instructions, including every required environment variable and
  where to obtain it (AWS Bedrock access, OpenWeatherMap free key)
- How to regenerate the datasets using the two included generator scripts,
  if the underlying data is ever corrected or extended
- A clear, upfront "what's real vs. synthetic" summary pulled from
  `DATA_PROVENANCE.md` — don't bury this, it should be one of the first
  things a reader sees
- Deployment steps for both Render and Vercel
- The explicit disclosure that route risk is straight-line corridor
  matching, not turn-by-turn routing

## Guardrails — do not do these things

- Do not invent additional hotspots, attractions, or higher-precision
  coordinates beyond what's in the provided files
- Do not treat any row in `attractions.csv` as having a flood risk
- Do not call the weather API on every single incoming request — respect
  the hourly cache
- Do not expose AWS credentials to the frontend in any form
- Do not hide or drop the `data_confidence` field anywhere in the
  pipeline — it must be traceable all the way from the CSV to the API
  response to the UI
- Do not build a real routing engine — the straight-line corridor
  heuristic is the deliberate, disclosed scope for this version
- Do not skip the `/health` endpoint or the graceful-degradation fallback
  — both exist because this tool needs to work especially when the
  weather/infra is genuinely stressed, which is exactly when its
  dependencies are most likely to be flaky

## Optional nice-to-have, only after everything above is working

A separate, one-time utility script that uses a free geocoding service
(e.g. OpenStreetMap's Nominatim) to check the existing approximate
coordinates in the dataset against real geocoded results, and outputs a
diff report (proposed corrections, not automatic overwrites) for manual
review. This must never run automatically as part of the app and must
never silently modify `hotspots_extended.csv` — it produces a report for
a human to act on.

## Definition of done

- `/health` responds correctly and reflects real dependency status
- All five API endpoints work and return correctly-shaped, validated data
- The map renders both layers, with confidence tiers visually
  distinguishable
- The chat panel correctly answers both a point question ("is Iffco Chowk
  risky right now") and a route question ("is it safe from Sector 49 to
  Cyber City in the next hour"), including a stated time window in both
  answers
- Backend is deployed and reachable on a Render URL; frontend is deployed
  and reachable on a Vercel URL; the frontend successfully calls the
  deployed backend, not localhost
- README is complete per the section above
- Test suite passes, including the risk-scoring unit tests
