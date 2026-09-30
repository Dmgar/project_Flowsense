"""Durable, operator-confirmed flood observations with conservative expiry."""
from __future__ import annotations
import math
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import networkx as nx

from src.core.config import settings
from src.models.schemas import FloodReport, FloodReportInput


def _now() -> datetime:
    return datetime.now(timezone.utc)


class FloodIntelligence:
    def __init__(self) -> None:
        self.db_path = settings.DATA_PROCESSED_DIR / f"flood_reports_{settings.CITY_PROFILE}.sqlite3"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS flood_reports (report_id TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    def _connect(self):
        return sqlite3.connect(self.db_path, timeout=10)

    def _save(self, report: FloodReport) -> None:
        with self._connect() as db:
            db.execute("INSERT OR REPLACE INTO flood_reports(report_id,payload) VALUES (?,?)",
                       (report.report_id, report.model_dump_json()))

    def _all(self) -> list[FloodReport]:
        with self._connect() as db:
            rows = db.execute("SELECT payload FROM flood_reports").fetchall()
        return [FloodReport.model_validate_json(row[0]) for row in rows]

    def list(self) -> list[FloodReport]:
        now = _now()
        reports = self._all()
        for report in reports:
            if report.status == "confirmed" and datetime.fromisoformat(report.expires_at) <= now:
                report.status = "expired"
                self._save(report)
        return sorted(reports, key=lambda item: item.created_at, reverse=True)

    def create(self, payload: FloodReportInput) -> FloodReport:
        created = _now()
        report = FloodReport(
            report_id=f"flood_{uuid.uuid4().hex[:10]}",
            latitude=payload.latitude, longitude=payload.longitude, depth_cm=payload.depth_cm,
            radius_m=payload.radius_m, source=payload.source, note=payload.note, demo=payload.demo,
            status="pending_review", created_at=created.isoformat(),
            expires_at=(created + timedelta(minutes=max(1, settings.FLOOD_REPORT_TTL_MINUTES))).isoformat(),
        )
        self._save(report)
        return report

    def update_status(self, report_id: str, status: str) -> FloodReport | None:
        report = next((item for item in self._all() if item.report_id == report_id), None)
        if report is None:
            return None
        if report.status != "pending_review" and status != "cleared":
            raise ValueError(f"Report is already {report.status}.")
        report.status = status
        if status == "confirmed":
            report.confirmed_at = _now().isoformat()
            report.expires_at = (_now() + timedelta(minutes=max(1, settings.FLOOD_REPORT_TTL_MINUTES))).isoformat()
        self._save(report)
        return report

    def routing_reports(self) -> list[FloodReport]:
        now = _now()
        return [report for report in self.list()
                if report.status == "confirmed" and datetime.fromisoformat(report.expires_at) > now]

    def blocked_nodes(self, graph: nx.MultiDiGraph, vehicle_type: str) -> tuple[set, int, int]:
        reports = self.routing_reports()
        max_depth = (settings.AMBULANCE_MAX_WATER_DEPTH_CM if vehicle_type == "ambulance"
                     else settings.FIRE_TRUCK_MAX_WATER_DEPTH_CM)
        blocked_reports = [report for report in reports if report.depth_cm > max_depth]
        blocked: set = set()
        for report in blocked_reports:
            lat_scale = 111_139.0
            lon_scale = lat_scale * math.cos(math.radians(report.latitude))
            for node, data in graph.nodes(data=True):
                dy = (float(data.get("y", 0.0)) - report.latitude) * lat_scale
                dx = (float(data.get("x", 0.0)) - report.longitude) * lon_scale
                if math.hypot(dx, dy) <= report.radius_m:
                    blocked.add(node)
        return blocked, len(reports), len(blocked_reports)


flood_intelligence = FloodIntelligence()
