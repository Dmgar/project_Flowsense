from src.perception.audit import direction_audit_counts


def test_direction_audit_reports_pending_tracks_separately_from_wrong_way_tracks():
    detections = [
        {"direction": "approaching", "direction_status": "confirmed"},
        {"direction": "checking", "direction_status": "checking"},
        {"direction": "receding", "direction_status": "confirmed"},
    ]

    assert direction_audit_counts(detections) == {
        "approaching": 1,
        "checking": 1,
        "wrong_direction": 1,
    }


def test_direction_audit_counts_legacy_approaching_boxes_without_status():
    assert direction_audit_counts([{"direction": "approaching"}]) == {
        "approaching": 1,
        "checking": 0,
        "wrong_direction": 0,
    }
