import numpy as np
from src.perception.models import Detection
from src.perception import road_tracking
from src.perception.road_tracking import ClassConsensus, FlowAssistedIoU, RoadTracker, crossed_counting_segment, in_road_zone, remove_duplicate_vehicle_detections
from src.services.detection_store import DetectionStore
from src.services.video_service import directional_outside_tracks, unique_render_boxes


def detection(x, label="car", score=.8, scores=None):
    return Detection((x, 140, 40, 30), {"car": 2, "bus": 5, "truck": 7}[label], label, score, scores or {})


def test_live_overlay_deduplicates_provisional_and_confirmed_vehicle_boxes_together():
    confirmed = {"id": 432, "class": "car", "bbox": (100, 100, 190, 170),
                 "confidence": .68, "track_confidence": .68, "class_status": "stable"}
    provisional = {"id": 447, "class": "vehicle", "candidate_class": "truck",
                   "bbox": (130, 46, 202, 162), "confidence": .47,
                   "track_confidence": .47, "class_status": "uncertain"}
    nearby = {"id": 438, "class": "truck", "bbox": (330, 85, 100, 73),
              "confidence": .55, "track_confidence": .55, "class_status": "stable"}

    vehicles, candidates = unique_render_boxes([confirmed, nearby], [provisional])

    assert [box["id"] for box in vehicles] == [432, 438]
    assert candidates == []


def test_live_overlay_keeps_provisional_vehicle_when_it_does_not_overlap_another():
    provisional = {"id": 9, "class": "vehicle", "bbox": (20, 30, 40, 25),
                   "confidence": .2, "track_confidence": .2, "class_status": "uncertain"}

    vehicles, candidates = unique_render_boxes([], [provisional])

    assert vehicles == []
    assert candidates == [provisional]


def test_optical_flow_projection_is_assigned_to_only_one_predicted_track():
    class ProjectedAffinity:
        def compute(self, predicted, detected):
            return np.asarray([[float(abs(box[0] - target[0]) < 1)
                                for target in detected] for box in predicted])

    projections = [((0, 0, 10, 10), (50, 0, 10, 10)),
                   ((10, 0, 10, 10), (100, 0, 10, 10))]
    predicted = np.asarray([[4, 0, 14, 10], [1, 0, 11, 10]], dtype=float)
    detected = np.asarray([[50, 0, 60, 10], [100, 0, 110, 10]], dtype=float)

    scores = FlowAssistedIoU(ProjectedAffinity(), projections).compute(predicted, detected)

    assert scores.tolist() == [[0, 1], [1, 0]]


def test_track_association_rejects_fast_position_or_scale_discontinuities():
    plausible = (100, 140, 40, 30)
    nearby = (112, 143, 42, 31)

    assert RoadTracker.association_is_plausible(plausible, nearby, .1)
    assert not RoadTracker.association_is_plausible(plausible, (450, 140, 40, 30), .1)
    assert not RoadTracker.association_is_plausible(plausible, (100, 140, 100, 75), .1)
    assert not RoadTracker.association_is_plausible(plausible, (100, 140, -1, 30), .1)


def test_tracker_splits_a_byte_track_id_when_the_box_jumps_to_another_vehicle():
    from types import SimpleNamespace

    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    tracker.update([detection(100)], frame, 0, {"enabled": False})
    first = tracker.update([detection(110)], frame, .1, {"enabled": False})
    assert first
    road_key = next(key for key in tracker.states if key[0] == "road")
    byte_track_id = road_key[1]
    tracker.trackers["road"].update = lambda objects, timestamp: SimpleNamespace(
        tracker_id=np.asarray([byte_track_id]), data={"source_index": np.asarray([0])})

    second = tracker.update([detection(450)], frame, .2, {"enabled": False})

    assert second
    assert second[0]["id"] != first[0]["id"]
    assert second[0]["observation_hits"] == 1
    assert second[0]["counted"] is False


def test_finite_counting_segment_detects_diagonal_crossing_and_rejects_off_segment_motion():
    gate = [[.2, .2], [.8, .8]]
    assert crossed_counting_segment((.3, .2), (.7, .8), gate)
    assert not crossed_counting_segment((.1, .1), (.3, .3), gate)
    assert not crossed_counting_segment((.1, .9), (.9, .9), gate)


def test_horizontal_or_vertical_counting_segments_are_supported():
    assert crossed_counting_segment((.2, .2), (.8, .8), [[0, .5], [1, .5]])
    assert crossed_counting_segment((.2, .2), (.8, .8), [[.5, 0], [.5, 1]])
    assert not crossed_counting_segment((.1, .2), (.4, .2), [[0, .5], [1, .5]])


def test_oriented_counting_segment_rejects_reverse_crossings():
    gate = [[.5, .1], [.5, .9]]

    assert crossed_counting_segment((.4, .5), (.6, .5), gate, (1, 0))
    assert not crossed_counting_segment((.6, .5), (.4, .5), gate, (1, 0))
    assert not crossed_counting_segment((.4, .5), (.6, .5), gate, (-1, 0))


def test_road_tracker_counts_rightward_vehicle_at_vertical_counting_line():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [1, 0], "minimum_motion": .008,
            "counting_line": [[.225, .1], [.225, .9]]}
    outputs = []
    for index, left in enumerate((100, 110, 120)):
        current = Detection((left, 140, 40, 30), 2, "car", .8,
                            {"car": .9, "bus": .02, "truck": .02})
        outputs = tracker.update([current], frame, index / 15, zone)

    assert outputs and outputs[-1]["counted"] is True


def test_uncertain_bus_truck_evidence_does_not_become_a_specific_label():
    consensus = ClassConsensus()
    for index in range(10):
        consensus.update(detection(50, "bus" if index % 2 else "truck", .6, {"bus": .6, "truck": .58, "car": .1}))
    assert consensus.label == "vehicle" and not consensus.locked and consensus.candidate is None


def test_weak_large_vehicle_scores_do_not_publish_a_truck_or_bus_hint():
    for vehicle_type in ("truck", "bus"):
        consensus = ClassConsensus()
        scores = {"car": .10, "bus": .08, "truck": .08}
        scores[vehicle_type] = .39
        for _ in range(6):
            consensus.update(detection(50, vehicle_type, .39, scores))

        assert consensus.label == "vehicle"
        assert consensus.locked is False
        assert consensus.candidate is None


def test_large_vehicle_hint_waits_for_four_consistent_updates_but_car_hint_stays_fast():
    consensus = ClassConsensus()
    scores = {"car": .10, "bus": .08, "truck": .52}
    consensus.update(detection(50, "truck", .52, scores))
    consensus.update(detection(50, "truck", .52, scores))
    assert consensus.label == "vehicle" and consensus.candidate is None

    consensus.update(detection(50, "truck", .52, scores))
    assert consensus.label == "vehicle" and consensus.candidate is None

    consensus.update(detection(50, "truck", .52, scores))
    assert consensus.label == "vehicle" and consensus.candidate == "truck"


def test_provisional_car_hint_does_not_change_saved_vehicle_class():
    consensus = ClassConsensus(low_light=True)
    scores = {"car": .31, "bus": .20, "truck": .10}
    consensus.update(detection(50, "car", .31, scores))
    consensus.update(detection(50, "car", .31, scores))
    assert consensus.label == "vehicle"
    assert consensus.locked is False
    assert consensus.candidate == "car"


def test_strong_two_observation_night_car_consensus_confirms_without_weakening_bus_rules():
    consensus = ClassConsensus(low_light=True)
    scores = {"car": .72, "bus": .05, "truck": .04}
    consensus.update(detection(50, "car", .72, scores))
    consensus.update(detection(50, "car", .72, scores))

    assert consensus.label == "car"
    assert consensus.locked is True
    assert consensus.candidate is None


def test_two_observation_night_car_consensus_stays_uncertain_when_class_scores_are_close():
    consensus = ClassConsensus(low_light=True)
    scores = {"car": .36, "bus": .24, "truck": .12}
    consensus.update(detection(50, "car", .36, scores))
    consensus.update(detection(50, "car", .36, scores))

    assert consensus.label == "vehicle"
    assert consensus.locked is False
    assert consensus.candidate == "car"


def test_provisional_hint_clears_as_soon_as_vehicle_type_is_confirmed():
    consensus = ClassConsensus()
    for _ in range(3):
        consensus.update(detection(50, "car", .8, {"car": .85, "bus": .05, "truck": .02}))

    assert consensus.label == "car"
    assert consensus.locked is True
    assert consensus.candidate is None


def test_road_tracker_exposes_provisional_candidate_separately_from_confirmed_type():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    scores = {"car": .31, "bus": .20, "truck": .10}
    outputs = []
    for index, x in enumerate((100, 104)):
        outputs = tracker.update([Detection((x, 140, 40, 30), 2, "car", .31, scores)],
                                 frame, index / 15, {"enabled": False, "low_light": True})
    assert outputs[-1]["class"] == "vehicle"
    assert outputs[-1]["class_status"] == "uncertain"
    assert outputs[-1]["candidate_class"] == "car"


def test_locked_bus_ignores_short_truck_noise_then_corrects_sustained_evidence():
    consensus = ClassConsensus()
    for _ in range(3):
        consensus.update(detection(50, "bus", .9, {"bus": .9, "truck": .05, "car": .02}))
    assert consensus.label == "bus" and consensus.locked
    for _ in range(2):
        consensus.update(detection(50, "truck", .95))
    assert consensus.label == "bus"
    for _ in range(3):
        consensus.update(detection(50, "truck", .95))
    assert consensus.label == "truck" and consensus.locked
    for _ in range(2):
        consensus.update(detection(50, "bus", .95))
    assert consensus.label == "truck"


def test_small_implausible_bus_prediction_stays_an_unclassified_vehicle():
    tracker = RoadTracker()
    frame = np.zeros((720, 1280, 3), np.uint8)
    scores = {"bus": .92, "truck": .03, "car": .02}
    outputs = []

    for index in range(8):
        outputs = tracker.update([Detection((100 + index * 2, 200, 41, 45), 5, "bus", .92, scores)],
                                 frame, index / 10, {"enabled": False})

    assert outputs[-1]["class"] == "vehicle"
    assert outputs[-1]["class_status"] == "uncertain"
    assert outputs[-1]["candidate_class"] is None


def test_temporal_consensus_cannot_promote_a_geometrically_invalid_bus_alternative():
    consensus = ClassConsensus()
    frame_shape = (720, 1280, 3)
    # The frame-level winner says car, but the unfiltered bus score would win
    # temporal averaging if large-vehicle geometry were not checked per class.
    scores = {"car": .20, "bus": .90, "truck": .02}

    for _ in range(8):
        consensus.update(Detection((100, 200, 41, 45), 2, "car", .90, scores), frame_shape)

    assert consensus.label == "vehicle"
    assert consensus.locked is False
    assert consensus.candidate not in {"bus", "truck"}


def test_large_vehicle_classes_require_minimum_image_detail_and_shape():
    frame_shape = (720, 1280, 3)
    supports = ClassConsensus._supports_large_vehicle_class

    assert supports("bus", (100, 200, 120, 55), frame_shape)
    assert not supports("bus", (100, 200, 41, 45), frame_shape)
    assert supports("truck", (100, 200, 110, 82), frame_shape)
    assert not supports("truck", (100, 200, 53, 25), frame_shape)


def test_car_label_can_be_revised_when_a_track_becomes_a_strong_bus_consensus():
    consensus = ClassConsensus(low_light=True)
    for _ in range(3):
        consensus.update(detection(50, "car", .65, {"car": .75, "bus": .08, "truck": .05}))
    assert consensus.label == "car" and consensus.locked
    for _ in range(5):
        consensus.update(detection(50, "bus", .8, {"car": .05, "bus": .88, "truck": .03}))
    assert consensus.label == "bus" and consensus.locked


def test_bytetrack_id_survives_and_corrects_car_bus_label_changes():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    ids, labels = set(), []
    for index in range(12):
        label = "car" if index < 6 else "bus"
        tracked = tracker.update([detection(100 + index * 3, label)], frame, index / 15, {"enabled": False})
        ids.update(box["id"] for box in tracked)
        labels.extend(box["class"] for box in tracked)
    assert ids == {1}
    assert "car" in labels and "bus" in labels
    assert labels[-1] == "bus"


def test_nested_near_identical_road_boxes_keep_the_best_detection():
    larger = Detection((808, 394, 184, 107), 2, "car", .65, {"car": .65})
    nested = Detection((810, 393, 107, 74), 2, "car", .36, {"car": .36})
    nearby = Detection((100, 150, 100, 55), 2, "car", .8, {"car": .8})

    kept, suppressed = remove_duplicate_vehicle_detections([nested, nearby, larger])

    assert kept == [nearby, larger]
    assert suppressed == 1


def test_byte_track_id_restart_preserves_the_counted_vehicle_identity(monkeypatch):
    class RestartingTracker:
        def __init__(self, **_kwargs):
            self.calls = 0
            self.iou = None
            self.tracks = []

        def update(self, objects, timestamp=None):
            self.calls += 1
            objects.tracker_id = np.full(len(objects), 7 if self.calls < 3 else 20, dtype=int)
            return objects

    monkeypatch.setattr(road_tracking, "ByteTrackTracker", RestartingTracker)
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .64}
    outputs = []
    for index, top in enumerate((220, 230, 240)):
        current = Detection((100 + index * 2, top, 40, 30), 2, "car", .8, {"car": .9, "bus": .02, "truck": .02})
        outputs = tracker.update([current], frame, index / 15, zone)

    assert outputs
    assert outputs[-1]["id"] == 1
    assert outputs[-1]["counted"] is True
    assert tracker.next_id == 2


def test_night_count_waits_for_three_real_updates_after_crossing():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .64,
            "low_light": True}
    outputs = []
    for index, top in enumerate((220, 230, 240)):
        current = Detection((100 + index * 2, top, 40, 30), 2, "car", .4,
                            {"car": .55, "bus": .05, "truck": .04})
        outputs = tracker.update([current], frame, index / 15, zone)
    assert outputs and outputs[-1]["counted"] is True
    assert outputs[-1]["observation_hits"] == 3


def test_night_crossing_from_one_weak_detection_is_not_counted():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .64,
            "low_light": True}
    outputs = []
    for index, top in enumerate((220, 230, 240)):
        current = Detection((100 + index * 2, top, 40, 30), 2, "car", .22,
                            {"car": .35, "bus": .08, "truck": .05})
        outputs = tracker.update([current], frame, index / 15, zone)
    assert outputs and outputs[-1]["counted"] is False


def test_repeated_weak_night_car_is_shown_provisionally_before_count_confirmation():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .64,
            "low_light": True}
    observations = []
    for index, top in enumerate((220, 230)):
        current = Detection((100 + index * 2, top, 40, 30), 2, "car", .22,
                            {"car": .35, "bus": .05, "truck": .04})
        observations.append(tracker.update([current], frame, index / 15, zone))

    assert observations[0] == []
    assert observations[1]
    assert observations[1][-1]["class"] == "vehicle"
    assert observations[1][-1]["candidate_class"] == "car"
    assert observations[1][-1]["counted"] is False


def test_repeated_ten_to_fifteen_percent_night_detections_recover_an_inbound_track():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .95,
            "low_light": True}
    observations = []
    for index, top in enumerate((150, 160, 170)):
        weak_car = Detection((100 + index * 2, top, 40, 30), 2, "car", .12,
                             {"car": .20, "bus": .02, "truck": .01})
        observations.append(tracker.update([weak_car], frame, index / 15, zone))

    assert observations[0] == []
    assert observations[1] == []
    assert observations[2]
    assert observations[2][-1]["class"] == "vehicle"
    assert observations[2][-1]["candidate_class"] == "car"
    assert observations[2][-1]["counted"] is False


def test_weak_night_car_survives_one_missed_inference_then_appears_after_a_real_repeat():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .95,
            "low_light": True}
    weak_car = lambda top: Detection((100, top, 40, 30), 2, "car", .12,
                                     {"car": .20, "bus": .02, "truck": .01})

    assert tracker.update([weak_car(150)], frame, 0.0, zone) == []
    assert tracker.update([], frame, .2, zone) == []
    assert tracker.update([weak_car(160)], frame, .4, zone) == []
    recovered = tracker.update([weak_car(170)], frame, .6, zone)

    assert len(recovered) == 1
    assert recovered[0]["class"] == "vehicle"
    assert recovered[0]["candidate_class"] == "car"
    assert recovered[0]["observation_hits"] == 2
    assert recovered[0]["counted"] is False


def test_weak_night_car_does_not_survive_an_expired_detection_gap():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .95,
            "low_light": True}
    weak_car = Detection((100, 150, 40, 30), 2, "car", .12,
                         {"car": .20, "bus": .02, "truck": .01})

    assert tracker.update([weak_car], frame, 0.0, zone) == []
    assert tracker.update([], frame, .2, zone) == []
    assert tracker.update([weak_car], frame, 1.0, zone) == []


def test_single_weak_night_detection_cannot_start_a_track():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .95,
            "low_light": True}
    weak_car = Detection((100, 150, 40, 30), 2, "car", .12,
                         {"car": .20, "bus": .02, "truck": .01})

    assert tracker.update([weak_car], frame, 0, zone) == []
    assert tracker.update([], frame, 1 / 15, zone) == []


def test_repeated_weak_night_detections_from_opposing_traffic_stay_hidden():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
            "direction": [0, 1], "minimum_motion": .008, "counting_line_y": .95,
            "low_light": True}
    observations = []
    for index, top in enumerate((170, 160, 150)):
        weak_car = Detection((100 + index * 2, top, 40, 30), 2, "car", .12,
                             {"car": .20, "bus": .02, "truck": .01})
        observations.append(tracker.update([weak_car], frame, index / 15, zone))

    assert observations == [[], [], []]


def test_zone_and_motion_reject_opposing_traffic_even_inside_polygon():
    tracker = RoadTracker()
    frame = np.zeros((400, 600, 3), np.uint8)
    zone = {"enabled": True, "polygon": [[.1, .1], [.9, .1], [.9, .9], [.1, .9]], "direction": [1, 0], "minimum_motion": .008}
    outputs = []
    for index in range(12):
        tracked = tracker.update([detection(100 + index * 6), detection(400 - index * 6), detection(560)], frame, index / 15, zone)
        outputs.extend(tracked)
    assert outputs
    assert all(box["bbox"][0] < 250 and box["direction"] == "approaching" for box in outputs)
    assert all(in_road_zone(box["bbox"], frame.shape, zone) for box in outputs)


def test_direction_audit_finds_repeated_approaching_tracks_outside_zone_without_counting_them():
    frame = np.zeros((400, 600, 3), np.uint8)
    road_zone = {"enabled": True, "polygon": [[.08, .1], [.35, .1], [.35, .95], [.08, .95]],
                 "direction": [1, 0], "minimum_motion": .008, "counting_line_y": .64}
    audit_zone = {**road_zone, "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]], "counting_line_y": 1.01}
    production, audit = RoadTracker(), RoadTracker()
    accepted, audit_tracks = [], []
    for index in range(12):
        current = detection(340 + index * 5)
        accepted = production.update([current], frame, index / 15, road_zone)
        audit_tracks = audit.update([current], frame, index / 15, audit_zone)

    outside = directional_outside_tracks(audit_tracks, frame.shape, road_zone)
    assert accepted == []  # Production zone continues to exclude this carriageway.
    assert len(outside) == 1
    assert outside[0]["observation_hits"] >= 2
    assert len(outside[0]["trail"]) >= 2

    opposing = RoadTracker()
    opposing_tracks = []
    for index in range(12):
        opposing_tracks = opposing.update([detection(500 - index * 5)], frame,
                                         index / 15, audit_zone)
    assert directional_outside_tracks(opposing_tracks, frame.shape, road_zone) == []


def test_bottom_center_anchor_excludes_objects_on_other_carriageway():
    profile = {"enabled": True, "polygon": [[.2, .5], [.8, .5], [.8, .9], [.2, .9]]}
    assert not in_road_zone((200, 100, 50, 50), (400, 600), profile)
    assert in_road_zone((200, 150, 50, 70), (400, 600), profile)


def test_current_zone_history_keeps_earlier_analysis_separate(tmp_path):
    store = DetectionStore(tmp_path)
    base = {"sequence": 1, "generation": 1, "observed_at": "2026-10-20T12:00:00+00:00", "media_time_seconds": 1,
            "counts": {"car": 1}, "detections": [{"id": 1, "class": "vehicle", "bbox": [100, 100, 40, 20], "confidence": .7}]}
    store.save("camera", "session", "model", base)
    zone = store.set_zone("camera", {"enabled": True, "name": "Incoming", "polygon": [[0, 0], [1, 0], [1, 1]], "direction": [1, 0], "minimum_motion": .008})
    assert store.history("camera")["events"] == []
    next_sample = {**base, "sequence": 2, "generation": 2, "analysis_zone": zone}
    store.save("camera", "session", "model", next_sample)
    corrected = {**next_sample, "sequence": 3, "detections": [{**base["detections"][0], "class": "car", "class_status": "stable"}]}
    store.save("camera", "session", "model", corrected)
    reclassified = {**next_sample, "sequence": 4, "detections": [{**base["detections"][0], "class": "bus", "class_status": "stable"}]}
    store.save("camera", "session", "model", reclassified)
    history = DetectionStore(tmp_path).history("camera")
    assert history["unique_tracks"] == {"bus": 1}
    assert len(history["events"]) == 1
    assert history["earlier_tracks"] == 1
    assert len(store.history("camera", include_legacy=True)["events"]) == 2


def test_zone_api_rejects_crossed_and_outside_polygons(client):
    endpoint = "/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/analysis-zone"
    assert client.get(endpoint).json()["enabled"] is True
    invalid = {"polygon": [[0, 0], [1, 1], [0, 1], [1, 0]], "direction": [1, 0]}
    assert client.put(endpoint, json=invalid).status_code == 422
    invalid["polygon"] = [[-.1, 0], [1, 0], [1, 1]]
    assert client.put(endpoint, json=invalid).status_code == 422
