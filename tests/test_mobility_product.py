from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import sqlite3
from types import SimpleNamespace
import cv2
import numpy as np
import pytest
from src.core.config import settings
from src.services.mobility_service import MobilityService


@pytest.fixture
def mobility(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "DATA_PROCESSED_DIR", tmp_path)
    return MobilityService()


def payload():
    return {"signal_id": "test-signal", "title": "Review freeway access", "owner": "Traffic operations",
            "severity": "high", "note": "Review evidence", "data_origin": "presentation"}


def test_source_status_expires_and_outage_is_distinguished(mobility, monkeypatch):
    camera_id = next(iter(mobility.cameras))
    monkeypatch.setattr("src.services.mobility_service.time.monotonic", lambda: 1000)
    assert next(c for c in mobility.list_cameras() if c["id"] == camera_id)["status"] == "unverified"
    mobility._frames[camera_id] = {"fetched_at": 990, "observed_at": "2026-10-15T00:00:00Z"}
    camera = next(c for c in mobility.list_cameras() if c["id"] == camera_id)
    assert camera["status"] == "online" and camera["observation_age_seconds"] == 10
    mobility._frames[camera_id]["possible_placeholder"] = True
    assert next(c for c in mobility.list_cameras() if c["id"] == camera_id)["status"] == "provider_notice"
    mobility._frames[camera_id]["fetched_at"] = 0
    stale = next(c for c in mobility.list_cameras() if c["id"] == camera_id)
    assert stale["status"] == "stale" and stale["last_observed_at"] is not None
    assert stale["last_source_status"] == "provider_notice"


def test_provider_outage_card_never_becomes_a_zero_traffic_measurement(mobility, monkeypatch):
    frame = np.full((100, 160, 3), 255, dtype=np.uint8)
    captured = {"frame": frame, "detections": None, "possible_placeholder": True,
                "observed_at": "2026-10-15T00:00:00+00:00", "hash": "provider-outage", "image": b"test"}
    monkeypatch.setattr(mobility, "capture", lambda _: captured)
    result = mobility.observe(next(iter(mobility.cameras)))
    assert result["counts"] is None
    assert result["detections"] == []
    assert result["inference_status"] == "unavailable"
    assert "proveedor" in result["inference_error"]


def test_case_creation_is_idempotent_under_concurrent_requests(mobility):
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: mobility.create_case(payload()), range(4)))
    assert len({item["id"] for item in results}) == 1
    assert len(mobility.cases()) == 1


def test_policy_acceptance_receipt_is_traceable_and_append_only(mobility):
    receipt = mobility.record_policy_acceptance({
        "form_type": "case_review",
        "operator_reference": "  operator   work-handle  ",
        "terms_accepted": True,
        "privacy_acknowledged": True,
    })
    assert len(receipt["receipt_id"]) == 36
    accepted_at = datetime.fromisoformat(receipt["accepted_at"])
    assert accepted_at.tzinfo == timezone.utc
    assert receipt["form_type"] == "case_review"
    assert receipt["identity_strength"] == "self-reported, not authenticated"

    root = Path(__file__).resolve().parents[1]
    expected_terms_hash = hashlib.sha256((root / "docs/legal/TERMS_OF_SERVICE.md").read_bytes()).hexdigest()
    expected_privacy_hash = hashlib.sha256((root / "docs/legal/PRIVACY_NOTICE.md").read_bytes()).hexdigest()
    with closing(sqlite3.connect(mobility.db_path)) as db:
        row = db.execute("""SELECT accepted_at, form_type, operator_reference,
            terms_version, terms_sha256, privacy_version, privacy_sha256,
            terms_accepted, privacy_acknowledged, capture_method, actor_identity_strength
            FROM policy_acceptance_events WHERE receipt_id = ?""", (receipt["receipt_id"],)).fetchone()
    assert row == (
        receipt["accepted_at"], "case_review", "operator work-handle",
        "2026-10-24", expected_terms_hash, "2026-10-24", expected_privacy_hash,
        1, 1, "two_independent_checkbox_choices_on_form_submit",
        "self_reported_unverified_operator_reference",
    )

    with closing(sqlite3.connect(mobility.db_path)) as db, db:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("UPDATE policy_acceptance_events SET operator_reference = 'changed' WHERE receipt_id = ?", (receipt["receipt_id"],))
    with closing(sqlite3.connect(mobility.db_path)) as db, db:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("DELETE FROM policy_acceptance_events WHERE receipt_id = ?", (receipt["receipt_id"],))
    with closing(sqlite3.connect(mobility.db_path)) as db:
        assert db.execute("SELECT operator_reference FROM policy_acceptance_events WHERE receipt_id = ?", (receipt["receipt_id"],)).fetchone() == ("operator work-handle",)


def test_policy_acceptance_endpoint_rejects_incomplete_choices(client, mobility, monkeypatch):
    import src.api.routes.mobility as routes
    monkeypatch.setattr(routes, "mobility_service", mobility)
    endpoint = "/api/v1/mobility/legal/acceptances"
    data = {"form_type": "camera_connection", "operator_reference": "staff-7", "terms_accepted": True, "privacy_acknowledged": True}
    accepted = client.post(endpoint, json=data)
    assert accepted.status_code == 201
    assert accepted.json()["receipt_id"]
    assert accepted.json()["terms_sha256"] and accepted.json()["privacy_sha256"]
    rejected = client.post(endpoint, json={**data, "privacy_acknowledged": False})
    assert rejected.status_code == 400
    with closing(sqlite3.connect(mobility.db_path)) as db:
        assert db.execute("SELECT COUNT(*) FROM policy_acceptance_events").fetchone() == (1,)


def test_human_review_state_machine_and_audit_survive_restart(mobility):
    case = mobility.create_case(payload())
    with pytest.raises(ValueError):
        mobility.review_case(case["id"], {"status": "resolved", "owner": "Team", "note": "Not reviewed"})
    for status in ["assigned", "under_review", "confirmed", "resolved"]:
        case = mobility.review_case(case["id"], {"status": status, "owner": "Verified team", "note": "Reviewed camera evidence"})
    restored = MobilityService().cases()[0]
    assert restored["status"] == "resolved"
    assert len(restored["audit"]) == 5
    assert [step["action"] for step in restored["audit"]] == ["new", "assigned", "under_review", "confirmed", "resolved"]
    with pytest.raises(ValueError):
        mobility.review_case(case["id"], {"status": "assigned", "owner": "Team", "note": "Cannot reopen"})


@pytest.mark.parametrize("source", ["file:///private/test.jpg", "ftp://example.com/camera", "https://user:secret@example.com/a.jpg"])
def test_invalid_or_credentialed_camera_source_is_rejected(mobility, source):
    count = len(mobility.cameras)
    with pytest.raises(ValueError):
        mobility.connect({"name": "Test camera", "source": source, "lat": 34.0, "lng": -118.0})
    assert len(mobility.cameras) == count


def test_failed_connection_is_not_saved(mobility, monkeypatch):
    def fail(*args):
        raise ValueError("No image")
    monkeypatch.setattr(mobility, "capture", fail)
    with pytest.raises(ValueError):
        mobility.connect({"name": "Test camera", "source": "https://example.com/a.jpg", "lat": 34.0, "lng": -118.0})
    assert not any(item["id"].startswith("connected-") for item in MobilityService().list_cameras())


def test_observation_preserves_aligned_frame_and_does_not_invent_speed(mobility, monkeypatch):
    camera_id = next(iter(mobility.cameras))
    image = np.zeros((260, 320, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", image)
    captured = {"image": encoded.tobytes(), "frame": image, "observed_at": "2026-10-15T00:00:00+00:00",
                "detections": None, "hash": "test-frame"}
    monkeypatch.setattr(mobility, "capture", lambda _: captured)
    monkeypatch.setattr(settings, "PERCEPTION_MODEL_PATH", mobility.db_path)
    mobility._detector = SimpleNamespace(detect=lambda _: [SimpleNamespace(class_name="car", confidence=.9, bbox=(32, 26, 64, 52))])
    result = mobility.observe(camera_id)
    assert result["counts"]["car"] == 1
    assert result["detections"][0]["bbox"] == {"x": .1, "y": .1, "width": .2, "height": .2}
    assert result["speed_kmh"] is None and result["lane_occupancy"] is None
    assert mobility.historical_image(camera_id, result["frame_id"]) == encoded.tobytes()
    mobility.observe(camera_id)
    assert len(mobility.history(camera_id)) == 1


def test_unavailable_inference_returns_missing_counts_not_fake_zero(mobility, monkeypatch):
    camera_id = next(iter(mobility.cameras))
    monkeypatch.setattr(settings, "PERCEPTION_MODEL_PATH", mobility.db_path.with_name("absent.onnx"))
    monkeypatch.setattr(mobility, "capture", lambda _: {"image": b"test", "frame": np.zeros((10, 10, 3), dtype=np.uint8),
                        "observed_at": "2026-10-15T00:00:00+00:00", "detections": None, "hash": "test"})
    result = mobility.observe(camera_id)
    assert result["counts"] is None
    assert result["inference_status"] == "unavailable"
    assert result["detections"] == []


def test_case_export_and_error_contracts(client, mobility, monkeypatch):
    import src.api.routes.mobility as routes
    monkeypatch.setattr(routes, "mobility_service", mobility)
    data = payload()
    data["title"] = "=HYPERLINK(test)"
    response = client.post("/api/v1/mobility/cases", json=data)
    assert response.status_code == 200
    exported = client.get("/api/v1/mobility/reports/cases.csv")
    assert "'=HYPERLINK(test)" in exported.text
    assert "presentation" in exported.text
    rejected = client.patch(f"/api/v1/mobility/cases/{response.json()['id']}", json={"status": "resolved", "owner": "Test team", "note": "No human review"})
    assert rejected.status_code == 409
    assert client.get("/api/v1/mobility/cameras/absent/snapshot").status_code == 404
    pdf = client.get("/api/v1/mobility/reports/cases.pdf")
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF-")
    assert "attachment" in pdf.headers["content-disposition"]
