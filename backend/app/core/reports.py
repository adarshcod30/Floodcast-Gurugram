"""Citizen flood reports — a real, empty-by-default crowdsourced store.

WHAT THIS REPLACED, AND WHY
---------------------------
An earlier version of this project shipped a module that served
hardcoded "civic data" as if it were live: a DHBVN transformer repair
with a restoration time, a GMDA water outage on Golf Course Road, three
citizen reports with invented upvote counts, and a Metro/bus status feed
computed from a rainfall number.

None of it was real, and none of it was labelled. That is the single
most damaging thing this project could do. The whole premise — the thing
that separates it from a hotspot map anyone could draw — is that a user
or an official can always tell which numbers are sourced fact and which
are engineering estimates. A fabricated outage notice destroys that in
one screenshot, and no amount of provenance elsewhere earns the trust
back.

So the fabrications are gone rather than relabelled, and what remains is
genuinely real: this store starts EMPTY. Every report it ever returns was
filed by an actual person through the API. Zero reports is the correct,
honest state for a tool nobody has reported to yet.

PERSISTENCE
-----------
Reports are written to a JSON file on disk (path from settings) so they
survive a process restart. That file is runtime user data, gitignored,
never committed. This is deliberately a flat file, not a database: the
expected volume is low, it needs no extra service on a free tier, and
swapping in Postgres later means changing this module only.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger("floodcast.reports")

#: Categories a citizen can file under. Kept deliberately narrow — this
#: is a flood tool, not a general civic complaints inbox.
CATEGORIES = ("waterlogging", "road_blocked", "drain_overflow", "safe_passage")

#: A report older than this stops being decision-relevant. Flood
#: conditions change hourly; a 12-hour-old "road is flooded" report tells
#: you about a road that has probably drained.
ACTIVE_WINDOW_HOURS = 12


class CitizenReport(BaseModel):
    """One flood observation filed by a member of the public."""

    id: str
    title: str
    description: str
    category: str
    location_name: str
    lat: float
    lon: float
    created_at: str
    confirmations: int = 0
    #: Hashed client identifiers, so one person cannot confirm twice.
    #: Never returned by the API — see CitizenReportResponse.
    confirmed_by: List[str] = Field(default_factory=list)

    @property
    def age_hours(self) -> float:
        created = datetime.fromisoformat(self.created_at)
        return (datetime.now(timezone.utc) - created).total_seconds() / 3600

    @property
    def is_active(self) -> bool:
        return self.age_hours <= ACTIVE_WINDOW_HOURS


class _ReportStore:
    """Thread-safe, disk-backed collection of citizen reports."""

    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.Lock()
        self._reports: Dict[str, CitizenReport] = {}
        self._load()

    # -- persistence ----------------------------------------------------

    def _load(self) -> None:
        """Read reports from disk. A missing file means an empty store."""
        if not self._path.exists():
            logger.info("No report store at %s — starting empty.", self._path)
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            self._reports = {r["id"]: CitizenReport(**r) for r in raw}
            logger.info("Loaded %d citizen reports from disk.", len(self._reports))
        except Exception as exc:  # noqa: BLE001 — a corrupt file must not block startup
            logger.error("Could not read report store (%s): %s", self._path, exc)
            self._reports = {}

    def _flush(self) -> None:
        """Write the store to disk atomically.

        Writes to a temp file and renames, so a crash mid-write leaves the
        previous good file intact rather than a truncated one.
        """
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            payload = [r.model_dump() for r in self._reports.values()]
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            tmp.replace(self._path)
        except Exception as exc:  # noqa: BLE001 — losing durability beats 500ing the user
            logger.error("Could not persist report store: %s", exc)

    # -- queries --------------------------------------------------------

    def list_active(self) -> List[CitizenReport]:
        """Active reports, newest first. Empty until someone files one."""
        with self._lock:
            active = [r for r in self._reports.values() if r.is_active]
        active.sort(key=lambda r: r.created_at, reverse=True)
        return active

    def get(self, report_id: str) -> Optional[CitizenReport]:
        with self._lock:
            return self._reports.get(report_id)

    # -- mutations ------------------------------------------------------

    def add(
        self,
        title: str,
        description: str,
        category: str,
        location_name: str,
        lat: float,
        lon: float,
    ) -> CitizenReport:
        """File a new report. Starts at zero confirmations.

        Zero, not one: the filer's own submission is not corroboration,
        and seeding it at one would inflate every report's apparent
        support by exactly the amount that makes it look corroborated.
        """
        report = CitizenReport(
            id=f"rep_{uuid.uuid4().hex[:12]}",
            title=title.strip(),
            description=description.strip(),
            category=category,
            location_name=location_name.strip(),
            lat=lat,
            lon=lon,
            created_at=datetime.now(timezone.utc).isoformat(),
            confirmations=0,
        )
        with self._lock:
            self._reports[report.id] = report
            self._flush()
        logger.info("Citizen report filed: %s (%s)", report.id, report.category)
        return report

    def confirm(self, report_id: str, confirmer: str) -> Optional[CitizenReport]:
        """Record a corroboration. Idempotent per confirmer."""
        with self._lock:
            report = self._reports.get(report_id)
            if report is None:
                return None
            if confirmer not in report.confirmed_by:
                report.confirmed_by.append(confirmer)
                report.confirmations = len(report.confirmed_by)
                self._flush()
            return report

    def purge_expired(self) -> int:
        """Drop reports past the active window. Returns the count removed."""
        with self._lock:
            stale = [rid for rid, r in self._reports.items() if not r.is_active]
            for rid in stale:
                del self._reports[rid]
            if stale:
                self._flush()
        return len(stale)


# ---------------------------------------------------------------------------
# Module-level singleton, initialised at app startup
# ---------------------------------------------------------------------------

_store: Optional[_ReportStore] = None


def init_store(path: str) -> None:
    """Initialise the report store. Called once from the app lifespan."""
    global _store
    _store = _ReportStore(Path(path))


def get_store() -> _ReportStore:
    """Return the store, initialising with the configured path if needed."""
    global _store
    if _store is None:
        from app.config import settings

        init_store(settings.reports_store_path)
    assert _store is not None
    return _store
