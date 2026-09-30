"""In-memory triage for camera-derived roadway incident candidates."""
from datetime import datetime, timezone
import json
import sqlite3
from uuid import uuid4

from src.models.schemas import IncidentCandidate, IncidentCandidateInput


LABELS = {
    "collision": "Posible colisión",
    "stopped_vehicle": "Vehículo detenido",
    "road_obstruction": "Obstrucción vial",
    "smoke_fire": "Humo o incendio",
    "flooding": "Inundación",
    "unknown": "Evento sin clasificar",
}


class IncidentIntelligence:
    """Scores evidence for operator review; never treats a score as proof."""

    def __init__(self):
        self.candidates: dict[str, IncidentCandidate] = {}
        from src.core.config import settings
        self.database_path = settings.DATA_PROCESSED_DIR / f"incident_ledger_{settings.CITY_PROFILE}.sqlite3"
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.database_path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS incident_candidates (incident_id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            rows = db.execute("SELECT payload FROM incident_candidates").fetchall()
        for (payload,) in rows:
            candidate = IncidentCandidate.model_validate(json.loads(payload))
            self.candidates[candidate.incident_id] = candidate

    def save(self, candidate: IncidentCandidate) -> None:
        self.candidates[candidate.incident_id] = candidate
        payload = json.dumps(candidate.model_dump(), ensure_ascii=False)
        with sqlite3.connect(self.database_path) as db:
            db.execute(
                "INSERT INTO incident_candidates (incident_id, payload) VALUES (?, ?) "
                "ON CONFLICT(incident_id) DO UPDATE SET payload=excluded.payload",
                (candidate.incident_id, payload),
            )

    def analyze(self, evidence: IncidentCandidateInput) -> IncidentCandidate:
        temporal = min(evidence.corroborating_frames / 8, 1.0)
        persistence = min(evidence.stationary_seconds / 45, 1.0)
        traffic = min(evidence.speed_drop_pct / 80, 1.0)
        # An evidence score for triage, not a calibrated probability.
        score = min(1.0, 0.55 * evidence.model_confidence + 0.20 * temporal + 0.10 * persistence + 0.15 * traffic)
        rationale = [f"Confianza del detector: {evidence.model_confidence:.0%}"]
        if evidence.corroborating_frames > 1:
            rationale.append(f"Persistente en {evidence.corroborating_frames} fotogramas")
        if evidence.stationary_seconds >= 10:
            rationale.append(f"Objeto detenido durante {evidence.stationary_seconds:.0f} s")
        if evidence.speed_drop_pct >= 20:
            rationale.append(f"Caída de velocidad del flujo: {evidence.speed_drop_pct:.0f}%")
        if evidence.detected_classes:
            rationale.append("Clases observadas: " + ", ".join(evidence.detected_classes[:5]))
        if evidence.demo:
            rationale.append("Escenario sintético de demostración; no procede de una cámara real")
        urgency = "crítica" if evidence.event_type in {"collision", "smoke_fire", "flooding"} else "alta" if evidence.event_type in {"road_obstruction", "stopped_vehicle"} else "por evaluar"
        candidate = IncidentCandidate(
            incident_id=f"det_{uuid4().hex[:8]}", event_type=evidence.event_type,
            label=LABELS[evidence.event_type], latitude=evidence.latitude, longitude=evidence.longitude,
            confidence=round(score, 3), urgency=urgency, status="pending_review",
            rationale=rationale, detected_classes=evidence.detected_classes, camera_id=evidence.camera_id,
            demo=evidence.demo, created_at=datetime.now(timezone.utc).isoformat(),
        )
        self.save(candidate)
        return candidate

    def list(self):
        return sorted(self.candidates.values(), key=lambda item: item.created_at, reverse=True)

    def get(self, incident_id: str):
        return self.candidates.get(incident_id)


incident_intelligence = IncidentIntelligence()
