"""
FloodCast Gurugram — Super-App Core Module
============================================
Handles data structures and simulators for:
  - Grid Utilities (DHBVN Power Outages, GMDA Water Cuts)
  - Roadworks / Road Construction Zones
  - Crowdsourced Citizen Reports (with upvoting verification)

Geographic coordinates are matched around the existing 64 hotspots for realism.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger("floodcast.super_app")

# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

class UtilityStatus(BaseModel):
    id: str
    sector_name: str
    utility_type: str  # power | water | gas
    status: str        # active_cut | scheduled_cut | normal
    impact_level: str  # High | Medium | Low
    duration_hours: Optional[float] = None
    notes: str
    lat: float
    lon: float

class RoadworkZone(BaseModel):
    id: str
    location_name: str
    road_type: str
    work_type: str      # digging | flyover_construction | maintenance
    severity: str       # High | Medium | Low
    delay_minutes: int
    notes: str
    lat: float
    lon: float

class CitizenReport(BaseModel):
    id: str
    title: str
    description: str
    category: str       # hazard | roadblock | info
    location_name: str
    lat: float
    lon: float
    upvotes: int = 0
    created_at: str
    verified_by_users: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Mock Databases (in-memory)
# ---------------------------------------------------------------------------

_utilities: List[UtilityStatus] = []
_roadworks: List[RoadworkZone] = []
_citizen_reports: List[CitizenReport] = []


def initialize_super_app_data():
    """Seed data matching our 64 hotspot coordinate bounds."""
    global _utilities, _roadworks, _citizen_reports
    
    _utilities = [
        UtilityStatus(
            id="UTIL-001",
            sector_name="Sector 51 (Mayfield Garden)",
            utility_type="power",
            status="active_cut",
            impact_level="Medium",
            duration_hours=2.5,
            notes="Substation transformer repair in progress. Restoring by 10 PM.",
            lat=28.415,
            lon=77.055
        ),
        UtilityStatus(
            id="UTIL-002",
            sector_name="Sohna Road (Vatika City)",
            utility_type="power",
            status="scheduled_cut",
            impact_level="Low",
            duration_hours=4.0,
            notes="Scheduled maintenance on feeder lines from 10 AM to 2 PM tomorrow.",
            lat=28.398,
            lon=77.038
        ),
        UtilityStatus(
            id="UTIL-003",
            sector_name="Golf Course Road (Judges Enclave)",
            utility_type="water",
            status="active_cut",
            impact_level="High",
            duration_hours=12.0,
            notes="GMDA main line leakage. Water tankers requested for delivery.",
            lat=28.436,
            lon=77.103
        ),
        UtilityStatus(
            id="UTIL-004",
            sector_name="Dwarka Expressway (Sectors 112-115)",
            utility_type="gas",
            status="normal",
            impact_level="Low",
            notes="Pressure checks normal. No outages reported.",
            lat=28.515,
            lon=77.045
        ),
    ]
    
    _roadworks = [
        RoadworkZone(
            id="WORK-001",
            location_name="Golf Course Extension Road",
            road_type="arterial",
            work_type="flyover_construction",
            severity="High",
            delay_minutes=20,
            notes="Flyover construction active. Single lane traffic on service roads.",
            lat=28.402,
            lon=77.068
        ),
        RoadworkZone(
            id="WORK-002",
            location_name="Sector 56 Main Stretch",
            road_type="sector road",
            work_type="digging",
            severity="Medium",
            delay_minutes=10,
            notes="Sewer pipe laying work. Lane closures at junctions.",
            lat=28.43,
            lon=77.105
        ),
        RoadworkZone(
            id="WORK-003",
            location_name="Pataudi Road",
            road_type="arterial road",
            work_type="maintenance",
            severity="Low",
            delay_minutes=5,
            notes="Pothole repairs active. Slow moving traffic.",
            lat=28.455,
            lon=76.97
        ),
    ]
    
    now = datetime.now(timezone.utc)
    _citizen_reports = [
        CitizenReport(
            id="REP-001",
            title="Tree fallen on road",
            description="Large tree has fallen blocking the left lane. Cars having to squeeze past.",
            category="roadblock",
            location_name="Sector 15, near Market",
            lat=28.468,
            lon=77.035,
            upvotes=14,
            created_at=(now - timedelta(minutes=45)).isoformat(),
            verified_by_users=["user1", "user2"]
        ),
        CitizenReport(
            id="REP-002",
            title="Severe pothole cluster",
            description="Deep pothole right after the Millennium Metro Station turn. Avoid left lane to prevent tyre damage.",
            category="hazard",
            location_name="MG Road, Metro Station turn",
            lat=28.46,
            lon=77.071,
            upvotes=28,
            created_at=(now - timedelta(hours=2)).isoformat(),
            verified_by_users=["user3"]
        ),
        CitizenReport(
            id="REP-003",
            title="Water pipe leaking",
            description="Water gushing out of broken pipe on road service lane. Slow traffic building up.",
            category="hazard",
            location_name="Hero Honda Chowk service lane",
            lat=28.363,
            lon=76.952,
            upvotes=5,
            created_at=(now - timedelta(hours=4)).isoformat()
        ),
    ]


# Seed on import
initialize_super_app_data()


# ---------------------------------------------------------------------------
# Business Logic
# ---------------------------------------------------------------------------

def get_all_utilities() -> List[UtilityStatus]:
    return _utilities

def get_all_roadworks() -> List[RoadworkZone]:
    return _roadworks

def get_all_reports() -> List[CitizenReport]:
    # Sort by created_at descending (newest first)
    return sorted(_citizen_reports, key=lambda r: r.created_at, reverse=True)

def add_citizen_report(
    title: str,
    description: str,
    category: str,
    location_name: str,
    lat: float,
    lon: float
) -> CitizenReport:
    new_report = CitizenReport(
        id=f"REP-{len(_citizen_reports) + 1:03d}",
        title=title,
        description=description,
        category=category,
        location_name=location_name,
        lat=lat,
        lon=lon,
        upvotes=1,
        created_at=datetime.now(timezone.utc).isoformat()
    )
    _citizen_reports.append(new_report)
    logger.info(f"Citizen report added: {new_report.id} - {new_report.title}")
    return new_report

def verify_citizen_report(report_id: str, user_ip: str) -> Optional[CitizenReport]:
    for report in _citizen_reports:
        if report.id == report_id:
            if user_ip not in report.verified_by_users:
                report.verified_by_users.append(user_ip)
                report.upvotes += 1
                logger.info(f"Report {report_id} verified by {user_ip}. Total upvotes: {report.upvotes}")
            return report
    return None
