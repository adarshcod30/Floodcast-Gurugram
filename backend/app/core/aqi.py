"""India CPCB National Air Quality Index — pure, deterministic computation.

WHY NOT THE PROVIDER'S OWN INDEX
--------------------------------
OpenWeatherMap returns a 1-5 index and Open-Meteo offers a European AQI.
Neither is the number anyone in Gurugram actually uses. India's Central
Pollution Control Board publishes a 0-500 National AQI with six named
bands, and that is the figure quoted in local news, in GRAP escalation
orders, and by the residents this tool is for. Reporting "AQI 3" to a
Gurugram commuter is not useful; reporting "AQI 312, Very Poor" is.

METHOD (CPCB National AQI, 2014 scheme)
---------------------------------------
For each pollutant, a sub-index is interpolated linearly within the band
its concentration falls into:

    Ip = ((IHi - ILo) / (BPHi - BPLo)) * (Cp - BPLo) + ILo

The overall AQI is the *maximum* sub-index across pollutants. CPCB
requires data for at least three pollutants, one of which must be PM2.5
or PM10; if that is not met, this module returns None rather than
guessing — consistent with the project's rule that an unavailable number
is reported as unavailable, never invented.

HONEST LIMITATION
-----------------
CPCB defines these breakpoints on 24-hour averages (8-hour for CO and
O3). This module is fed a rolling 24-hour mean of hourly model output
from Open-Meteo, which approximates the 24-hour average but is *modelled*
data, not a CPCB ground-station reading. `AqiResult.basis` carries that
caveat through to the API response so the UI can state it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

#: CPCB sub-index bands, shared by every pollutant.
#: (index_low, index_high) paired positionally with each pollutant's
#: concentration breakpoints below.
INDEX_BANDS: Sequence[Tuple[int, int]] = (
    (0, 50),
    (51, 100),
    (101, 200),
    (201, 300),
    (301, 400),
    (401, 500),
)

#: Concentration breakpoints per pollutant, in the units CPCB specifies.
#: PM2.5, PM10, NO2, SO2, O3 in ug/m3; CO in mg/m3.
BREAKPOINTS: Dict[str, Sequence[Tuple[float, float]]] = {
    "pm2_5": ((0, 30), (31, 60), (61, 90), (91, 120), (121, 250), (251, 500)),
    "pm10": ((0, 50), (51, 100), (101, 250), (251, 350), (351, 430), (431, 600)),
    "no2": ((0, 40), (41, 80), (81, 180), (181, 280), (281, 400), (401, 600)),
    "so2": ((0, 40), (41, 80), (81, 380), (381, 800), (801, 1600), (1601, 2400)),
    "o3": ((0, 50), (51, 100), (101, 168), (169, 208), (209, 748), (749, 1000)),
    "co": ((0, 1.0), (1.1, 2.0), (2.1, 10), (10.1, 17), (17.1, 34), (34.1, 50)),
}

#: The six CPCB bands, with the health advisory CPCB publishes for each.
CATEGORIES: Sequence[Tuple[int, str, str]] = (
    (50, "Good", "Air quality is satisfactory; minimal health impact."),
    (100, "Satisfactory", "May cause minor breathing discomfort to sensitive people."),
    (200, "Moderate", "Breathing discomfort for people with lung or heart disease."),
    (300, "Poor", "Breathing discomfort to most people on prolonged exposure."),
    (400, "Very Poor", "Respiratory illness on prolonged exposure. Avoid outdoor exertion."),
    (500, "Severe", "Affects healthy people. Serious impact on those with existing disease."),
)

#: Display names, used in API responses and the UI.
POLLUTANT_LABELS: Dict[str, str] = {
    "pm2_5": "PM2.5",
    "pm10": "PM10",
    "no2": "NO₂",
    "so2": "SO₂",
    "o3": "O₃",
    "co": "CO",
}


@dataclass
class AqiResult:
    """A computed CPCB AQI with full attribution of how it was derived."""

    aqi: int
    category: str
    advisory: str
    #: The pollutant whose sub-index set the overall AQI.
    dominant_pollutant: str
    #: Every sub-index that could be computed, for auditability.
    sub_indices: Dict[str, int]
    #: Concentrations the computation was fed, in CPCB units.
    concentrations: Dict[str, float]
    basis: str

    def to_dict(self) -> dict:
        return {
            "aqi": self.aqi,
            "category": self.category,
            "advisory": self.advisory,
            "dominant_pollutant": POLLUTANT_LABELS.get(
                self.dominant_pollutant, self.dominant_pollutant
            ),
            "sub_indices": {
                POLLUTANT_LABELS.get(k, k): v for k, v in self.sub_indices.items()
            },
            "concentrations": {
                POLLUTANT_LABELS.get(k, k): round(v, 1)
                for k, v in self.concentrations.items()
            },
            "basis": self.basis,
            "scale": "CPCB National AQI (0-500)",
        }


def sub_index(pollutant: str, concentration: float) -> Optional[int]:
    """Compute one pollutant's CPCB sub-index by linear interpolation.

    Returns None for an unknown pollutant or a negative reading.
    Concentrations above the top breakpoint clamp to 500, matching CPCB's
    treatment of the Severe band as open-ended at the top.
    """
    bands = BREAKPOINTS.get(pollutant)
    if bands is None or concentration is None or concentration < 0:
        return None

    for (bp_lo, bp_hi), (idx_lo, idx_hi) in zip(bands, INDEX_BANDS):
        if concentration <= bp_hi:
            # Guard against a degenerate band before dividing.
            if bp_hi == bp_lo:
                return int(round(idx_hi))
            value = ((idx_hi - idx_lo) / (bp_hi - bp_lo)) * (concentration - bp_lo) + idx_lo
            return int(round(value))

    return 500


def categorise(aqi: int) -> Tuple[str, str]:
    """Map an AQI value to its CPCB band name and health advisory."""
    for ceiling, name, advisory in CATEGORIES:
        if aqi <= ceiling:
            return name, advisory
    return CATEGORIES[-1][1], CATEGORIES[-1][2]


def compute_aqi(concentrations: Dict[str, float], basis: str = "") -> Optional[AqiResult]:
    """Compute the overall CPCB National AQI from pollutant concentrations.

    Args:
        concentrations: Keys from BREAKPOINTS; PM in ug/m3, CO in mg/m3.
        basis: Free text describing where the numbers came from and over
            what averaging period. Carried into the response verbatim.

    Returns:
        An AqiResult, or None if CPCB's minimum-data rule is not met
        (at least three pollutants, including PM2.5 or PM10).
    """
    sub_indices: Dict[str, int] = {}
    used: Dict[str, float] = {}

    for pollutant, value in concentrations.items():
        if value is None:
            continue
        index = sub_index(pollutant, float(value))
        if index is not None:
            sub_indices[pollutant] = index
            used[pollutant] = float(value)

    # CPCB minimum-data rule. Report nothing rather than something wrong.
    has_particulate = "pm2_5" in sub_indices or "pm10" in sub_indices
    if len(sub_indices) < 3 or not has_particulate:
        return None

    dominant = max(sub_indices, key=lambda k: sub_indices[k])
    overall = sub_indices[dominant]
    category, advisory = categorise(overall)

    return AqiResult(
        aqi=overall,
        category=category,
        advisory=advisory,
        dominant_pollutant=dominant,
        sub_indices=sub_indices,
        concentrations=used,
        basis=basis,
    )


def mean_ignoring_none(values: Sequence[Optional[float]]) -> Optional[float]:
    """Arithmetic mean over the non-null entries, or None if all are null."""
    present: List[float] = [float(v) for v in values if v is not None]
    if not present:
        return None
    return sum(present) / len(present)
