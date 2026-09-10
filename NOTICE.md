# Notice on the data

This project is licensed under the [MIT Licence](LICENSE), which disclaims
warranty in legal language. This file says the same thing in plain language,
because the legal version does not tell you the specific ways this tool can be
wrong.

## What the numbers are

**Most of the risk model is estimated, not measured.** Four columns drive every
risk score: the rainfall threshold, the time to flood, the drain time and the
drainage capacity score. They shipped as engineering estimates assigned by
severity tier, with no historical rainfall-versus-flood record behind them.
Some thresholds are now measured from citizen reports, and those are labelled
`measured` wherever they appear. Everything not carrying that label is an
estimate.

**34 of the 73 register rows are unconfirmed or structural placeholders.** 39
are backed by a named source. The tier is on every row, in the data and in the
interface. See [`docs/DATA_PROVENANCE.md`](docs/DATA_PROVENANCE.md).

**Every coordinate is approximate.** No geocoding API placed these points, and
`coordinates_verified` is `No` on all 73 rows.

**Routes are straight-line corridors, not routing.** The app finds flood points
within 1.5 km of the direct line between two places. Your actual drive may
follow entirely different roads.

**It reads a forecast, not a gauge.** No rain sensor feeds this. It reasons
about what a weather model predicts, which is not the same as what is happening
on a road right now. Drain blockage, upstream release and construction all cause
flooding this model cannot see.

## What that means for using it

This software is provided for informational purposes. **It must not be relied
upon as the sole basis for any emergency, evacuation, or public-safety
decision.**

If a road looks impassable, it is impassable, whatever this app says. If you
need the city to act, GMDA's 24x7 Flood Control Office is on **1800-180-1817**
or **0124-4753555**.

## Attribution

Rainfall and air quality from [Open-Meteo](https://open-meteo.com) under
CC-BY 4.0. Map tiles and geocoding from
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. Drainage
network from [GMDA OneMap](https://onemapdepts.gmda.gov.in), which publishes it
without authentication and without a stated licence; it is attributed here, but
that is an inference rather than a grant. GMDA has not reviewed or endorsed this
project. Warning colours follow the
[India Meteorological Department](https://mausam.imd.gov.in) scheme.
