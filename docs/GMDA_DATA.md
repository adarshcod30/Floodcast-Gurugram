# Getting GMDA data

The short version: **a lot of it is already public and needs no RTI.** GMDA
runs an ArcGIS server that answers unauthenticated REST queries, and it holds
real hydrology. The single most valuable dataset, the flood model MCG
commissioned, is not on it, and that one does need asking for.

Everything below was verified by querying the endpoints directly in September
2026. Record counts are what the server actually returned.

---

## 1. What is already public

Base URL:

```
https://onemapdepts.gmda.gov.in/server/rest/services
```

It answers `?f=json` with no key and no login. Reachability as tested:

| Host | Status |
|---|---|
| `onemapdepts.gmda.gov.in` | live, REST directory at `/server/rest/services` |
| `gis.gmda.gov.in` | live, no REST directory found |
| `onemapggm.gmda.gov.in` | connection refused |
| `onemapggm.mcg.gov.in` | connection refused |

32 folders are published, including `Harsac_waterlog`, `Sewerage`,
`GMDA_Utility_Network`, `Boundary` and `Gatishakti`.

### The useful one: `flood_survey_2`

```
/flood_survey_2/FeatureServer
```

| Layer | Name | Geometry | Records | Verdict |
|---:|---|---|---:|---|
| 0 | `Flood_survey_v2` | point | **25** | Effectively empty, see below |
| 1 | `Watershed_Gurugram` | polygon | **10** | Real catchment boundaries |
| 2 | `MCM_Boundary` | polygon | - | Administrative |
| 3 | `MCG_Zone_Boundary` | polygon | - | Administrative |
| 4 | `MCG_Wards_Boundary` | polygon | - | Administrative |
| 5 | `MCG_Boundary` | polygon | - | Administrative |
| 6 | `Natural_Flow_Direction` | polyline | **4,701** | **The prize** |

### `Natural_Flow_Direction` is the find

4,701 stream segments in WGS84, each carrying:

| Field | Example | Why it matters here |
|---|---|---|
| `stream_id` | `1` | Segment identity |
| `in_flow` / `out_flow` | `524` / `737` | Flow accumulation through the segment |
| `drain_area` | `1.077 sq km` | **How much land drains through this point** |
| `elevation` | `209` | Height, though `0` on some rows |

This is a real hydrological network, and it is directly relevant to the
weakest part of this project. `drainage_capacity_score` in the register is
currently an estimate assigned by severity tier, with nothing physical behind
it. For each of the 73 hotspots you can find the nearest stream segment and
read the actual catchment area draining through it. A point where 1.1 sq km
of city drains through one channel is physically more flood-prone than one
where 0.2 sq km does, and that is a sourced, defensible number rather than a
tier guess.

Query it like this:

```bash
BASE=https://onemapdepts.gmda.gov.in/server/rest/services/flood_survey_2/FeatureServer

# How many segments
curl "$BASE/6/query?where=1%3D1&returnCountOnly=true&f=json"

# Segments near a hotspot, as GeoJSON in WGS84
curl "$BASE/6/query?where=1%3D1&outFields=*&f=geojson&outSR=4326\
&geometryType=esriGeometryEnvelope&inSR=4326\
&geometry=77.06,28.46,77.09,28.49&spatialRel=esriSpatialRelIntersects"
```

`f=geojson` works, so it drops straight into any GIS or into Leaflet.

### What happened when it was actually joined to the register

[`data/fetch_gmda_drainage.py`](../data/fetch_gmda_drainage.py) pulls all
4,701 segments and the 10 watersheds, then attaches to each of the 73
hotspots the nearest stream segment and its catchment. Results:

- 73 of 73 hotspots matched a segment
- 55 of 73 sit within 250 m of one, which is where the match is trustworthy
- Catchments range from 0.149 to 9.5 sq km, median 0.621

**Then the interesting part, which does not flatter this project.** Median
catchment by the register's own severity tier, restricted to hotspots within
250 m of a mapped channel:

| Tier | n | Median catchment | Max |
|---|---:|---:|---:|
| hypercritical | 10 | 0.653 sq km | 9.500 |
| moderate | 24 | 0.663 sq km | 7.422 |
| minor | 21 | 0.698 sq km | 3.779 |

That is flat, and very slightly inverted. **GMDA's independent hydrology
shows no relationship with the severity tiers this register assigns**, and
those tiers drive every threshold behind every verdict.

Two readings, both plausible:

1. Urban waterlogging in Gurugram is driven by drain capacity, blockage and
   road geometry rather than by natural catchment size, which is what
   local reporting consistently describes. Catchment would then be the wrong
   predictor, and the tiers can still be right.
2. The tiers, which come from how severely news sources describe a place,
   are not measuring a physical property at all.

There is currently no way to tell which, because that requires the
rainfall-versus-flood pairs described below. What can be said is that the
one hotspot with a genuinely exceptional catchment, **Hero Honda Chowk at
9.5 sq km**, nearly double the next, is also the point that reliably makes
national news when it floods. A single agreement is not a correlation, but
it is not nothing either.

This is exactly why the catchment figures are shown in the app as evidence
and are **not** wired into the risk score. Mapping a catchment area onto a
rainfall threshold requires knowing how much rain that catchment takes
before the road goes under. Inventing that mapping would produce numbers
that look measured and are not, and a test in the suite fails if the
scoring ever starts reading these fields.

### The layer that looks perfect and is not

`Flood_survey_v2` (layer 0) has exactly the schema this project would want:
`waterloggingtype`, `surveydate`, `inspectorname`, `water_type_road`,
`water_type_sewerage`, `water_type_drainage`, `gully_trap`,
`rainwater_harvesting`, `pumping_station`, `zone`, `ward`, `sector`.

It has **25 records and every one of those fields is null.** The survey IDs
are placeholders (`1`, `MH 10`, `5.6`). Only the coordinates are populated.

This is a deployed schema that was never filled in, or whose populated
version lives somewhere non-public. It is worth re-checking each monsoon,
because if GMDA ever populates it, that single layer would give this project
official surveyed flood points with drainage infrastructure attributes
attached. That is precisely the ground truth the model lacks.

### Licensing, stated plainly

These endpoints are readable, which is not the same as being licensed for
redistribution. There is no published open-data licence on them. Querying
them for analysis is one thing; committing a copy into this repository and
republishing it is another, and it should be asked about first. That question
belongs in the same email as the request below.

---

## 2. The dataset actually worth asking for

In 2026 MCG commissioned a flood model from **IIT-Gandhinagar and AIReSQ**,
run on a tool called **FloodAstra**. Reported details:

- Design storm of **107.3 mm over three hours, peaking at 73 mm/hour**
- **31.48 million cubic metres** of water entering the city, 30.98 from direct
  rainfall and 0.50 from upstream inflows
- Water routed across **117 sectors through 257 boundary crossings**
- **125 connected drainage areas** identified
- Largest single sector-to-sector transfer: 44,237 cubic metres, Sector 1 to
  Sector 111
- Priority hotspots named: **Rajiv Chowk, Subhash Chowk, Sheetla Mata Road**

Two things stand out. All three named hotspots are already in this register,
which is a useful independent check on it. And a model that routes volumes
between sectors for a known rainfall intensity is, functionally, the
calibration curve this project is missing: it maps rainfall to where water
actually accumulates.

It does not appear to be public. MCG Commissioner **Pradeep Dahiya** is on
record about it, so it exists as a deliverable and has an owner.

Source: [The Tribune, "31 mn cubic metres of water: IIT study maps how Gurugram floods"](https://www.tribuneindia.com/news/haryana/31-mn-cubic-metres-of-water-iit-study-maps-how-gurugram-floods/)

---

## 3. How to ask

Try the cheap routes before the legal one.

**Ask IIT-Gandhinagar directly.** Academic groups frequently share model
outputs for non-commercial public-good use, and it is a two-line email
rather than a 30-day statutory process. Ask the authors of the FloodAstra
Gurugram work for the per-sector accumulation outputs.

**Ask GMDA's GIS division.** They built OneMap, and someone there already
decided to publish 4,701 flow-direction segments. A person who publishes
hydrology is usually willing to discuss more of it. This is also the right
place to ask what the OneMap data may be used for.

**Then RTI**, if neither answers. It is a statutory 30-day obligation.

- GMDA's RTI page: https://www.gmda.gov.in/rti.html
- MCG's RTI page: https://www.mcg.gov.in/RTI.aspx
- Central portal (Haryana bodies are often reachable through it):
  https://rtionline.gov.in
- Fee is nominal, usually 10 rupees

### What to actually ask for

A vague request gets a vague refusal. Ask for specific artefacts:

1. Rainfall-versus-waterlogging-report pairs for the last three monsoons:
   date, time, location, rainfall recorded at the nearest gauge, depth
   observed, and time to clear. **This is the single most valuable item**, and
   it is what converts every estimated threshold in this register into a
   measured one.
2. The IIT-Gandhinagar / AIReSQ FloodAstra outputs: per-sector accumulation
   volumes and the 257 boundary-crossing transfers.
3. The populated version of `Flood_survey_v2`, if one exists.
4. Locations and specifications of pumping stations and gully traps, which
   are already columns in that schema.
5. The current authoritative waterlogging-point list, with the criteria used.
   Published counts of 155, 79, 63, 28 and 6 all circulate and none reconcile.

Point 1 is worth more than the rest combined. Everything else improves the
inputs; that one makes the model honest.

---

## 4. Other sources worth knowing

| Source | What it has |
|---|---|
| GMDA satellite study (2020) | 79 vulnerable spots on GMDA master roads, remediation at 63 |
| GMDA Flood Control Office | 24x7 room, helpline 1800-180-1817 and 0124-4753555 |
| Gurugram Waterlogging Portal | Citizen reporting channel run by the city |
| [FloodWatch Gurgaon](https://floodwatchgurgaon.in) | Independent, 700+ areas, own readiness score |
| IMD | Official rainfall observations, the ground truth for any calibration |

---

## Sources

- [The Tribune, IIT study maps how Gurugram floods](https://www.tribuneindia.com/news/haryana/31-mn-cubic-metres-of-water-iit-study-maps-how-gurugram-floods/)
- [The Tribune, GMDA sets up 24x7 Flood Control Office](https://www.tribuneindia.com/news/gurugram/gmda-sets-up-24x7-flood-control-office-to-tackle-gurugram-waterlogging-mock-drills-from-may-15/)
- [OneMap Gurugram](https://onemapggm.gmda.gov.in/)
- [GMDA RTI](https://www.gmda.gov.in/rti.html)
- [MCG RTI](https://www.mcg.gov.in/RTI.aspx)
- [RTI Online](https://rtionline.gov.in)
