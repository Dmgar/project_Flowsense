import time
import cv2
import numpy as np
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from src.services.detection_store import (DetectionStore, EvidenceRecorder, EvidenceStorageGate,
    evidence_capacity_block_reason, evidence_frame_interval, evidence_h264_crf,
    measured_evidence_fps)


def sample(sequence, boxes=True):
    return {"sequence": sequence, "generation": 1, "media_time_seconds": sequence / 15,
            "observed_at": f"2026-10-20T06:00:{sequence:02d}+00:00",
            "counts": {"car": int(boxes)},
            "detections": [{"id": 1, "class": "car", "confidence": .8, "bbox": [20, 20, 40, 30]}] if boxes else []}


def test_evidence_sampling_adapts_only_when_the_bounded_queue_is_backlogged():
    assert evidence_frame_interval(15, 0) == 1 / 15
    assert evidence_frame_interval(15, 9) == 1 / 15
    assert evidence_frame_interval(15, 10) == 1 / 12
    assert evidence_frame_interval(15, 25) == 1 / 8
    assert evidence_frame_interval(15, 38) == 1 / 6
    assert evidence_frame_interval(8, 38) == 1 / 6


def test_saved_video_sampling_preserves_quota_and_reduces_rate_near_storage_limit():
    assert evidence_frame_interval(15, 0, 3_749_999_999, 5_000_000_000) == 1 / 15
    assert evidence_frame_interval(15, 0, 3_750_000_000, 5_000_000_000) == 1 / 10
    assert evidence_frame_interval(15, 0, 4_500_000_000, 5_000_000_000) == 1 / 6
    assert evidence_frame_interval(15, 25, 4_500_000_000, 5_000_000_000) == 1 / 6


def test_encoded_evidence_rate_uses_written_source_timestamps_not_target_cap():
    assert measured_evidence_fps([0.0]) is None
    assert measured_evidence_fps([0.0, 1 / 7.5, 2 / 7.5]) == 7.5
    assert measured_evidence_fps([0.0, 0.0]) is None
    assert measured_evidence_fps([1.0, 0.5]) is None


def test_evidence_encoder_increases_compression_only_as_clip_quota_fills():
    assert evidence_h264_crf(0, 5_000_000_000) == 28
    assert evidence_h264_crf(3_749_999_999, 5_000_000_000) == 28
    assert evidence_h264_crf(3_750_000_000, 5_000_000_000) == 31
    assert evidence_h264_crf(4_499_999_999, 5_000_000_000) == 31
    assert evidence_h264_crf(4_499_999_999, 5_000_000_000) == 31
    assert evidence_h264_crf(4_500_000_000, 5_000_000_000) == 37
    assert evidence_h264_crf(5_000_000_000, 5_000_000_000) == 37
    assert evidence_h264_crf(100, 0) == 37


def test_evidence_encoder_also_adapts_to_disk_headroom():
    assert evidence_h264_crf(0, 5_000_000_000, 1_750_000_000) == 28
    assert evidence_h264_crf(0, 5_000_000_000, 1_749_999_999) == 31
    assert evidence_h264_crf(0, 5_000_000_000, 1_250_000_000) == 31
    assert evidence_h264_crf(0, 5_000_000_000, 1_249_999_999) == 37
    assert evidence_h264_crf(0, 5_000_000_000, 900_000_000) == 37


def test_video_storage_gate_distinguishes_clip_cap_from_low_disk_space(tmp_path):
    store = DetectionStore(tmp_path, max_video_bytes=10, min_free_bytes=2_000_000_000)
    (store.clips / 'existing.mp4').write_bytes(b'0123456789')
    assert 'clip storage limit' in evidence_capacity_block_reason(store, disk_free_bytes=3_000_000_000)
    store.max_video_bytes = 100
    assert '2 GB safety reserve' in evidence_capacity_block_reason(store, disk_free_bytes=1_999_999_999)
    assert evidence_capacity_block_reason(store, disk_free_bytes=2_000_000_000) == ''
    store.min_free_bytes = 1_000_000_000
    assert evidence_capacity_block_reason(store, disk_free_bytes=1_200_000_000) == ''


def test_default_video_reserve_allows_recording_to_resume_between_one_and_two_gb(tmp_path):
    store = DetectionStore(tmp_path)
    assert store.max_video_bytes == 6_000_000_000
    assert store.min_free_bytes == 1_000_000_000
    assert evidence_capacity_block_reason(store, disk_free_bytes=1_500_000_000,
        clip_bytes=5_999_999_999) == ''
    assert 'clip storage limit' in evidence_capacity_block_reason(store,
        disk_free_bytes=1_500_000_000, clip_bytes=6_000_000_000)
    assert evidence_capacity_block_reason(store, disk_free_bytes=1_500_000_000) == ''
    assert '1 GB safety reserve' in evidence_capacity_block_reason(store, disk_free_bytes=999_999_999)


def test_video_storage_size_cache_expires_on_clip_finalization(tmp_path):
    store = DetectionStore(tmp_path)
    first = store.clips / "first.mp4"
    first.write_bytes(b"12345")

    assert store._video_bytes() == 5
    (store.clips / "second.mp4").write_bytes(b"1234567")
    assert store._video_bytes() == 5

    store.clip_finished("second", 1.0)
    assert store._video_bytes() == 12


def test_capacity_refresh_reuses_the_cached_directory_scan(tmp_path, monkeypatch):
    store = DetectionStore(tmp_path, max_video_bytes=1000, min_free_bytes=0)
    (store.clips / "existing.mp4").write_bytes(b"clip")
    original_glob = Path.glob
    scans = []

    def count_glob(path, pattern):
        scans.append((path, pattern))
        return original_glob(path, pattern)

    monkeypatch.setattr(Path, "glob", count_glob)
    assert evidence_capacity_block_reason(store, disk_free_bytes=2_000_000_000) == ""
    assert evidence_capacity_block_reason(store, disk_free_bytes=2_000_000_000) == ""
    assert len(scans) == 1

    store._invalidate_video_bytes_cache()
    assert evidence_capacity_block_reason(store, disk_free_bytes=2_000_000_000) == ""
    assert len(scans) == 2


def test_video_storage_gate_rechecks_and_resumes_after_disk_space_returns(tmp_path):
    store = DetectionStore(tmp_path)
    now = [0.0]
    available = [False]
    gate = EvidenceStorageGate(store, clock=lambda: now[0],
        capacity_check=lambda _: '' if available[0] else 'Video evidence paused: free disk space is below the 2 GB safety reserve.')

    assert gate.blocked
    available[0] = True
    now[0] += 4.9
    assert gate.refresh() is True
    now[0] += 0.1
    assert gate.refresh() is False
    assert gate.reason == ''


def test_video_storage_gate_rechecks_healthy_disk_before_an_open_clip_crosses_the_reserve(tmp_path):
    store = DetectionStore(tmp_path)
    now = [0.0]
    available = [True]
    checks = [0]

    def capacity(_):
        checks[0] += 1
        return '' if available[0] else 'Video evidence paused: free disk space is below the 2 GB safety reserve.'

    gate = EvidenceStorageGate(store, clock=lambda: now[0], capacity_check=capacity)
    assert not gate.blocked
    now[0] = 4.9
    assert gate.refresh() is False
    assert checks[0] == 1
    available[0] = False
    now[0] = 5.0
    assert gate.refresh() is True
    assert checks[0] == 2


def test_recorder_samples_clip_frames_under_backpressure_without_mutating_detection_metrics():
    import queue

    recorder = object.__new__(EvidenceRecorder)
    recorder.fps = 15
    recorder.queue = queue.Queue(maxsize=45)
    recorder.observation_queue = queue.Queue(maxsize=120)
    recorder.last_saved_media_time = -10.0
    recorder.last_saved_ids = set()
    recorder.last_saved_crossed = set()
    recorder.current_clip = None
    recorder.observation_error = ""
    recorder.observation_dropped = 0
    for _ in range(10):
        recorder.queue.put_nowait(None)
    recorder.error = ""
    recorder.skipped_frames = 0
    recorder.sampled_frames = 0
    recorder.last_queued_media_time = 0.0
    recorder.last_generation = 1
    first = {"media_time_seconds": .05, "generation": 1, "detections": [{"id": 4}]}
    recorder.submit(np.zeros((1, 1, 3), np.uint8), first)
    assert recorder.queue.qsize() == 10
    assert recorder.sampled_frames == 1
    assert recorder.skipped_frames == 0
    assert first["detections"] == [{"id": 4}]

    second = {"media_time_seconds": .084, "generation": 1, "detections": [{"id": 4}]}
    recorder.submit(np.zeros((1, 1, 3), np.uint8), second)
    assert recorder.queue.qsize() == 11
    assert recorder.sampled_frames == 1
    assert recorder.skipped_frames == 0


def test_observation_history_is_saved_while_video_queue_is_full():
    import queue
    import threading
    import time

    class Store:
        def __init__(self):
            self.saved = threading.Event()
            self.rows = []

        def save(self, camera, session, model, metrics, clip):
            self.rows.append((camera, session, model, metrics["sequence"], clip))
            self.saved.set()

    recorder = object.__new__(EvidenceRecorder)
    recorder.camera, recorder.session, recorder.model = "camera", "session", "test-model"
    recorder.store = Store()
    recorder.observation_queue = queue.Queue(maxsize=120)
    recorder.observation_stop = threading.Event()
    recorder.observation_error = ""
    recorder.observation_dropped = 0
    recorder.last_saved_media_time = -10.0
    recorder.last_saved_ids = set()
    recorder.last_saved_crossed = set()
    recorder.current_clip = None
    recorder.fps = 15
    recorder.queue = queue.Queue(maxsize=1)
    recorder.queue.put_nowait(None)
    recorder.error = ""
    recorder.skipped_frames = 0
    recorder.sampled_frames = 0
    recorder.last_queued_media_time = None
    recorder.last_generation = None
    recorder.observation_thread = threading.Thread(target=recorder._save_observations, daemon=True)
    recorder.observation_thread.start()

    recorder.submit(np.zeros((1, 1, 3), np.uint8), sample(1))
    try:
        assert recorder.store.saved.wait(1)
        assert recorder.store.rows == [("camera", "session", "test-model", 1, None)]
        assert recorder.skipped_frames == 1
    finally:
        recorder.observation_stop.set()
        recorder.observation_thread.join(1)


def test_saved_tracks_survive_reopening_without_double_counting_frames(tmp_path):
    store = DetectionStore(tmp_path)
    store.save("camera", "session", "test-model", sample(1))
    store.save("camera", "session", "test-model", sample(1))
    store.save("camera", "session", "test-model", sample(2))
    reopened = DetectionStore(tmp_path).history("camera")
    assert reopened["unique_tracks"] == {"car": 1}
    assert reopened["events"][0]["observations"] == 2
    assert reopened["events"][0]["model"] == "test-model"
    assert reopened["last_observed_at"] == sample(2)["observed_at"]
    store.save("camera", "other-session", "test-model", sample(3))
    assert store.history("camera")["unique_tracks"] == {"car": 2}
    assert store.history("unobserved")["last_observed_at"] is None


def test_model_hits_are_distinct_from_persisted_sample_count(tmp_path):
    store = DetectionStore(tmp_path)
    first = sample(1)
    first["detections"][0]["model_hits"] = 3
    store.save("camera", "session", "test-model", first)
    second = sample(2)
    second["detections"][0]["model_hits"] = 5
    store.save("camera", "session", "test-model", second)

    event = DetectionStore(tmp_path).history("camera")["events"][0]
    assert event["observations"] == 2  # database samples containing this track
    assert event["model_hits"] == 5  # actual temporal detector updates


def test_uncertain_class_candidate_is_saved_as_a_hint_not_a_confirmed_label(tmp_path):
    store = DetectionStore(tmp_path)
    first = sample(1)
    first["detections"][0].update({"class": "vehicle", "class_status": "uncertain", "candidate_class": "car"})
    store.save("camera", "session", "test-model", first)

    event = DetectionStore(tmp_path).history("camera")["events"][0]
    assert event["class"] == "vehicle"
    assert event["candidate_class"] == "car"
    assert DetectionStore(tmp_path).history("camera")["unique_tracks"] == {"vehicle": 1}
    assert DetectionStore(tmp_path).history("camera")["candidate_tracks"] == {"car": 1}

    confirmed = sample(2)
    confirmed["detections"][0].update({"class": "car", "class_status": "stable", "candidate_class": "car"})
    store.save("camera", "session", "test-model", confirmed)
    event = DetectionStore(tmp_path).history("camera")["events"][0]
    assert event["class"] == "car"
    assert event["candidate_class"] is None
    assert DetectionStore(tmp_path).history("camera")["candidate_tracks"] == {}


def test_reviewed_uncertain_track_is_removed_from_provisional_candidate_totals(tmp_path):
    store = DetectionStore(tmp_path)
    first = sample(1)
    first["detections"][0].update({"class": "vehicle", "class_status": "uncertain", "candidate_class": "truck"})
    store.save("camera", "session", "test-model", first)
    assert store.history("camera")["candidate_tracks"] == {"truck": 1}

    store.review_track("camera", "session", 1, 1, "car")
    history = store.history("camera")
    assert history["unique_tracks"] == {"car": 1}
    assert history["candidate_tracks"] == {}


def test_candidate_totals_cover_all_saved_tracks_even_when_history_page_is_limited(tmp_path):
    store = DetectionStore(tmp_path)
    for track_id in range(1, 7):
        observation = sample(track_id)
        observation["detections"][0].update({
            "id": track_id,
            "class": "vehicle",
            "class_status": "uncertain",
            "candidate_class": "car" if track_id < 6 else "truck",
        })
        store.save("camera", "session", "test-model", observation)

    # Human-reviewed tracks no longer appear among pending class suggestions.
    store.review_track("camera", "session", 1, 1, "car")
    page = store.history("camera", limit=2)

    assert len(page["events"]) == 2
    assert page["candidate_tracks"] == {"car": 4, "truck": 1}


def test_video_evidence_is_playable_and_linked_to_saved_track(tmp_path):
    store = DetectionStore(tmp_path, min_free_bytes=0)
    recorder = EvidenceRecorder(store, "camera", "session", 15, "test-model")
    for index in range(16):
        frame = np.zeros((180, 320, 3), np.uint8)
        cv2.rectangle(frame, (20 + index * 3, 70), (60 + index * 3, 100), (100, 220, 100), -1)
        recorder.submit(frame, sample(index))
    recorder.close()
    assert not recorder.thread.is_alive()
    assert not recorder.error
    history = DetectionStore(tmp_path).history("camera")
    assert len(history["clips"]) == 1
    clip = history["clips"][0]
    assert clip["state"] == "ready" and clip["duration"] >= .9
    assert history["events"][0]["clip"] == clip["id"]
    path = store.clip_path(clip["id"])
    cap = cv2.VideoCapture(str(path))
    try:
        ok, first = cap.read()
        assert ok
        for _ in range(10):
            ok, last = cap.read()
        assert ok and not np.array_equal(first, last)
    finally:
        cap.release()
    assert store.clip_path("missing") is None


def test_restart_drain_finishes_open_clip_and_does_not_open_another(tmp_path):
    import time

    store = DetectionStore(tmp_path, min_free_bytes=0)
    recorder = EvidenceRecorder(store, "camera", "session", 4, "test-model")
    try:
        for index in range(8):
            metrics = sample(index)
            metrics["media_time_seconds"] = index * .25
            recorder.submit(np.zeros((180, 320, 3), np.uint8), metrics)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            history = store.history("camera")
            if history["clips"] and history["clips"][0]["state"] == "recording":
                break
            time.sleep(.02)
        else:
            raise AssertionError("Recorder did not open its initial evidence clip")

        recorder.request_restart_drain()
        for index in range(8, 16):
            metrics = sample(index)
            metrics["media_time_seconds"] = index * .25
            recorder.submit(np.zeros((180, 320, 3), np.uint8), metrics)
        deadline = time.monotonic() + 5
        while not recorder.restart_drain_ready and time.monotonic() < deadline:
            time.sleep(.02)
        assert recorder.restart_drain_ready
    finally:
        recorder.close()

    clips = store.history("camera")["clips"]
    assert len(clips) == 1
    assert clips[0]["state"] == "ready"
    assert clips[0]["duration"] >= .25


def test_mp4_writer_failure_keeps_saving_tracks_and_retries_video(tmp_path, monkeypatch):
    import av
    import src.services.detection_store as detection_store

    monkeypatch.setattr(detection_store, "EVIDENCE_WRITER_RETRY_SECONDS", 0)
    failed_first_write = [False]

    class FakeFrame:
        @staticmethod
        def from_ndarray(_frame, format):
            return type("EncodedFrame", (), {"pts": None, "time_base": None})()

    class FakeStream:
        def __init__(self):
            self.width = self.height = 0
            self.pix_fmt = ""
            self.options = {}

        def encode(self, frame=None):
            if frame is not None and not failed_first_write[0]:
                failed_first_write[0] = True
                raise RuntimeError("simulated encoder fault")
            return []

    class FakeContainer:
        def __init__(self, path):
            from pathlib import Path
            Path(path).write_bytes(b"partial video")
            self.stream = FakeStream()

        def add_stream(self, *_args, **_kwargs):
            return self.stream

        def mux(self, _packet):
            pass

        def close(self):
            pass

    monkeypatch.setattr(av, "VideoFrame", FakeFrame)
    monkeypatch.setattr(av, "open", lambda path, *_args, **_kwargs: FakeContainer(path))
    store = DetectionStore(tmp_path, min_free_bytes=0)
    recorder = EvidenceRecorder(store, "camera", "session", 4, "test-model")
    try:
        for index in range(24):
            metrics = sample(index)
            metrics["media_time_seconds"] = index * .25
            recorder.submit(np.zeros((180, 320, 3), np.uint8), metrics)
    finally:
        recorder.close()

    clips = store.history("camera")["clips"]
    assert failed_first_write[0]
    assert sum(clip["state"] == "interrupted" for clip in clips) == 1
    assert sum(clip["state"] == "ready" for clip in clips) >= 1
    history = store.history("camera")
    assert history["events"]
    assert history["events"][0]["observations"] >= 8
    pause, = store.summary("camera", "2026-10-20T00:00:00+00:00")["video_evidence"]["recent_recording_pauses"]
    assert "MP4 writer failed" in pause["reason"]
    assert pause["ended_at"] is not None


def test_storage_reserve_finalizes_open_clip_but_keeps_saving_observations(tmp_path, monkeypatch):
    import src.services.detection_store as detection_store

    class FillingDiskGate:
        def __init__(self, _store):
            self.checks = 0
            self.blocked = False
            self.reason = 'Video evidence paused: free disk space is below the 2 GB safety reserve.'

        def refresh(self, force=False):
            self.checks += 1
            self.blocked = self.blocked or self.checks >= 3
            return self.blocked

    monkeypatch.setattr(detection_store, 'EvidenceStorageGate', FillingDiskGate)
    store = DetectionStore(tmp_path, min_free_bytes=0)
    recorder = EvidenceRecorder(store, 'camera', 'session', 4, 'test-model')
    for index in range(6):
        metrics = sample(index + 1)
        metrics['media_time_seconds'] = index * .25
        metrics['observed_at'] = f'2026-10-20T06:00:{index:02d}+00:00'
        frame = np.full((180, 320, 3), index * 15, np.uint8)
        recorder.submit(frame, metrics)
    recorder.close()

    history = DetectionStore(tmp_path).history('camera')
    assert len(history['clips']) == 1
    assert history['clips'][0]['state'] == 'ready'
    assert history['clips'][0]['duration'] >= .25
    assert len(history['events']) == 1
    assert history['events'][0]['observations'] == 3
    assert history['last_observed_at'] == '2026-10-20T06:00:04+00:00'
    assert 'safety reserve' in recorder.error


def test_vehicle_evidence_clip_includes_one_second_of_pre_roll(tmp_path):
    store = DetectionStore(tmp_path, min_free_bytes=0)
    recorder = EvidenceRecorder(store, "camera", "session", 15, "test-model")
    for index in range(30):
        frame = np.zeros((180, 320, 3), np.uint8)
        cv2.rectangle(frame, (20 + index * 4, 70), (60 + index * 4, 100), (100, 220, 100), -1)
        recorder.submit(frame, sample(index, boxes=index >= 22))
        time.sleep(.01)
    recorder.close()

    clip = DetectionStore(tmp_path).history("camera")["clips"][0]
    assert clip["state"] == "ready"
    assert clip["start_media_time"] <= 7 / 15
    assert clip["start_media_time"] >= 6 / 15
    assert clip["duration"] >= 22 / 15

    cap = cv2.VideoCapture(str(store.clip_path(clip["id"])))
    try:
        frame_count = 0
        while cap.read()[0]:
            frame_count += 1
    finally:
        cap.release()
    assert frame_count >= 23


def test_unfinished_clips_are_preserved_but_marked_interrupted_after_restart(tmp_path):
    store = DetectionStore(tmp_path)
    clip_id = "c" * 32
    store.clip_started(clip_id, "camera", "session", 0.0)
    clip_path = store.clips / f"{clip_id}.mp4"
    clip_path.write_bytes(b"partial-evidence")

    reopened = DetectionStore(tmp_path)
    history = reopened.history("camera", include_legacy=True)
    evidence = reopened.summary("camera", "2026-10-20T00:00:00+00:00")["video_evidence"]

    assert history["clips"][0]["state"] == "interrupted"
    assert clip_path.read_bytes() == b"partial-evidence"
    assert reopened.clip_path(clip_id) is None
    assert evidence["interrupted_clips"] == 1


def test_evidence_recording_pause_history_survives_capacity_recovery(tmp_path):
    store = DetectionStore(tmp_path)
    store.evidence_pause_changed("camera", "session", "Video evidence paused: disk reserve reached.",
        "2026-10-20T06:00:00+00:00")
    store.evidence_pause_changed("camera", "session", "", "2026-10-20T06:07:00+00:00")

    summary = DetectionStore(tmp_path).summary("camera", "2026-10-20T00:00:00+00:00")
    pause, = summary["video_evidence"]["recent_recording_pauses"]
    assert pause == {"started_at": "2026-10-20T06:00:00+00:00",
        "ended_at": "2026-10-20T06:07:00+00:00",
        "reason": "Video evidence paused: disk reserve reached.", "in_progress": False}


def test_stale_frame_timestamps_cannot_reverse_restart_pause_history(tmp_path):
    store = DetectionStore(tmp_path)
    disk_pause = "Video evidence paused: disk reserve reached."
    restart_pause = "Video evidence paused: planned service restart drain."
    store.evidence_pause_changed("camera", "session", disk_pause, "2026-10-20T06:00:00+00:00")
    store.evidence_pause_changed("camera", "session", restart_pause, "2026-10-20T06:01:00+00:00")

    # A queued recorder frame can arrive after the control-plane restart mark,
    # but its media timestamp must not rewrite the newer pause state.
    store.evidence_pause_changed("camera", "session", disk_pause, "2026-10-20T06:00:59+00:00")
    store.evidence_pause_changed("camera", "session", "", "2026-10-20T06:00:58+00:00")
    store.evidence_pause_changed("camera", "session", "", "2026-10-20T06:01:05+00:00")

    pauses = DetectionStore(tmp_path).summary("camera", "2026-10-20T00:00:00+00:00")["video_evidence"]["recent_recording_pauses"]
    assert pauses == [
        {"started_at": "2026-10-20T06:00:00+00:00", "ended_at": "2026-10-20T06:01:00+00:00",
         "reason": disk_pause, "in_progress": False},
        {"started_at": "2026-10-20T06:01:00+00:00", "ended_at": "2026-10-20T06:01:05+00:00",
         "reason": restart_pause, "in_progress": False},
    ]


def test_pause_summary_hides_an_invalid_end_without_rewriting_saved_history(tmp_path):
    store = DetectionStore(tmp_path)
    store.evidence_pause_changed("camera", "session", "Video evidence paused: restart.",
        "2026-10-20T06:01:00+00:00")
    store.evidence_pause_changed("camera", "session", "", "2026-10-20T06:02:00+00:00")
    with closing(store.connect()) as db, db:
        db.execute("UPDATE evidence_pauses SET ended_at=? WHERE camera=?",
                   ("2026-10-20T06:00:59+00:00", "camera"))

    pause, = store.summary("camera", "2026-10-20T00:00:00+00:00")["video_evidence"]["recent_recording_pauses"]

    assert pause == {"started_at": "2026-10-20T06:01:00+00:00", "ended_at": None,
        "reason": "Video evidence paused: restart.", "in_progress": False, "timestamp_conflict": True}
    with closing(store.connect()) as db:
        saved_end, = db.execute("SELECT ended_at FROM evidence_pauses WHERE camera=?", ("camera",)).fetchone()
    assert saved_end == "2026-10-20T06:00:59+00:00"


def test_planned_restart_drain_is_saved_as_an_evidence_pause(tmp_path):
    import threading
    from src.services.detection_store import EvidenceRecorder, RESTART_DRAIN_PAUSE_REASON

    store = DetectionStore(tmp_path)
    recorder = EvidenceRecorder.__new__(EvidenceRecorder)
    recorder.store, recorder.camera, recorder.session = store, "camera", "session"
    recorder.restart_requested = threading.Event()
    recorder.restart_drained = threading.Event()

    recorder.request_restart_drain()

    pause, = store.summary("camera", "2000-01-01T00:00:00+00:00")["video_evidence"]["recent_recording_pauses"]
    assert pause["reason"] == RESTART_DRAIN_PAUSE_REASON
    assert pause["in_progress"] is True


def test_subsecond_capture_is_preserved_but_not_advertised_as_reviewable_video(tmp_path):
    store = DetectionStore(tmp_path)
    clip_id = "d" * 32
    store.clip_started(clip_id, "camera", "session", 0.0)
    clip_path = store.clips / f"{clip_id}.mp4"
    clip_path.write_bytes(b"single-frame-video-container")

    store.clip_finished(clip_id, .067)
    with closing(store.connect()) as db:
        assert db.execute("SELECT state FROM clips WHERE id=?", (clip_id,)).fetchone()[0] == "short"
        # Simulate the same row as produced before the short-clip safeguard.
        db.execute("UPDATE clips SET state='ready' WHERE id=?", (clip_id,))
    reopened = DetectionStore(tmp_path)
    history = reopened.history("camera", include_legacy=True)
    evidence = reopened.summary("camera", "2026-10-20T00:00:00+00:00")["video_evidence"]

    assert history["clips"][0]["state"] == "short"
    assert reopened.clip_path(clip_id) is None
    assert clip_path.read_bytes() == b"single-frame-video-container"
    assert evidence["ready_clips"] == 0
    assert evidence["short_clips"] == 1


def test_track_history_links_the_clip_at_its_counted_crossing(tmp_path):
    store = DetectionStore(tmp_path)
    first_clip = "a" * 32
    crossing_clip = "b" * 32
    first = sample(1)
    store.clip_started(first_clip, "camera", "session", first["media_time_seconds"])
    store.clip_finished(first_clip, .02)
    store.save("camera", "session", "test-model", first, first_clip)

    crossing = sample(2)
    crossing_at = "2026-10-20T06:00:02+00:00"
    crossing["observed_at"] = crossing_at
    crossing["media_time_seconds"] = 2 / 15
    crossing["sequence"] = 2
    crossing["detections"][0].update({"counted": True, "crossed_at": crossing_at})
    store.clip_started(crossing_clip, "camera", "session", crossing["media_time_seconds"],
                       observed_at=crossing_at, generation=1, start_sequence=2)
    store.clip_finished(crossing_clip, 1)
    store.save("camera", "session", "test-model", crossing, crossing_clip)
    # Simulate a historical row retaining the first clip for the whole track.
    with store.connect() as db:
        db.execute("UPDATE tracks SET clip=?", (first_clip,))

    history = store.history("camera")
    assert history["events"][0]["clip"] == crossing_clip
    assert history["events"][0]["crossing_offset_seconds"] == 0
    assert history["events"][0]["model_hits"] == 1
    clips = {clip["id"]: clip for clip in history["clips"]}
    assert clips[crossing_clip]["created_at"] == crossing_at


def test_saved_clip_history_pages_are_stable_and_scoped_to_active_zone(tmp_path):
    store = DetectionStore(tmp_path)
    ids = [f"{index:032x}" for index in range(1, 5)]
    for index, clip_id in enumerate(ids, 1):
        store.clip_started(clip_id, "camera", "session", float(index), generation=1)
        store.clip_finished(clip_id, 1)
        (store.clips / f"{clip_id}.mp4").write_bytes(b"playable")
        with store.connect() as db:
            db.execute("UPDATE clips SET created_at=? WHERE id=?",
                       (f"2026-10-20T06:00:0{index}+00:00", clip_id))

    first = store.clip_history("camera", limit=2)
    second = store.clip_history("camera", limit=2, before=first["next_cursor"])

    assert [clip["id"] for clip in first["clips"]] == ids[2:][::-1]
    assert first["has_more"] is True
    assert [clip["id"] for clip in second["clips"]] == ids[:2][::-1]
    assert second["has_more"] is False
    assert second["next_cursor"] is None


def test_saved_clip_history_can_include_earlier_zone_revisions_with_labels(tmp_path):
    store = DetectionStore(tmp_path)
    store.zone = lambda camera: {"revision": 2, "enabled": True}
    ids = [f"{index:032x}" for index in range(1, 4)]
    for revision, clip_id in enumerate(ids):
        store.clip_started(clip_id, "camera", "session", float(revision), zone_revision=revision)
        store.clip_finished(clip_id, 1)

    current = store.clip_history("camera", limit=10)
    all_revisions = store.clip_history("camera", limit=10, include_earlier_zones=True)

    assert [clip["zone_revision"] for clip in current["clips"]] == [2]
    assert [clip["zone_revision"] for clip in all_revisions["clips"]] == [2, 1, 0]
    assert current["includes_earlier_zones"] is False
    assert all_revisions["includes_earlier_zones"] is True


def test_crossing_clip_lookup_stays_in_stream_generation_when_media_time_restarts(tmp_path):
    store = DetectionStore(tmp_path)
    observed_at = "2026-10-20T06:00:02+00:00"
    media_time = 2 / 15
    old_clip, current_clip = "e" * 32, "f" * 32
    for generation, clip_id in ((1, old_clip), (2, current_clip)):
        observation = sample(2 + generation)
        observation.update({"generation": generation, "sequence": 2 + generation,
                            "observed_at": observed_at, "media_time_seconds": media_time})
        observation["detections"][0].update({"counted": generation == 2,
                                               "crossed_at": observed_at if generation == 2 else None})
        store.clip_started(clip_id, "camera", "session", media_time, observed_at=observed_at,
                           generation=generation, start_sequence=2 + generation)
        store.clip_finished(clip_id, 1)
        store.save("camera", "session", "test-model", observation, clip_id)

    event = next(item for item in store.history("camera")["events"] if item["generation"] == 2)
    assert event["clip"] == current_clip
    assert event["crossing_offset_seconds"] == 0


def test_clip_timestamp_uses_capture_generation_when_media_time_restarts(tmp_path):
    store = DetectionStore(tmp_path)
    first = sample(1)
    first["generation"] = 1
    store.save("camera", "session", "test-model", first)
    second = sample(2)
    second["generation"] = 2
    second["sequence"] = 2
    second["media_time_seconds"] = first["media_time_seconds"]
    second_at = "2026-10-20T06:00:02+00:00"
    second["observed_at"] = second_at
    second["sequence"] = 2
    store.save("camera", "session", "test-model", second)
    clip_id = "d" * 32
    store.clip_started(clip_id, "camera", "session", second["media_time_seconds"],
                       zone_revision=0, observed_at=second_at, generation=2, start_sequence=2)
    store.clip_finished(clip_id, 1)

    history = DetectionStore(tmp_path).history("camera")

    assert history["clips"][0]["created_at"] == second_at
    assert history["clips"][0]["generation"] == 2
    assert history["clips"][0]["start_sequence"] == 2


def test_history_api_rejects_unknown_camera_and_invalid_limits(client):
    base = "/api/v1/mobility/video"
    assert client.get(f"{base}/cameras/unknown/history").status_code == 404
    assert client.get(f"{base}/cameras/caltrans-d7-cctv-1031/history?limit=501").status_code == 422
    assert client.get(f"{base}/cameras/unknown/clips").status_code == 404
    assert client.get(f"{base}/cameras/caltrans-d7-cctv-1031/clips?limit=101").status_code == 422
    assert client.get(f"{base}/cameras/caltrans-d7-cctv-1031/clips?before_id={'a' * 32}").status_code == 422
    assert client.get(f"{base}/clips/not-a-clip").status_code == 404


def test_history_api_exposes_full_candidate_aggregate_beside_limited_event_page(client, tmp_path, monkeypatch):
    from src.services.video_service import video_service

    store = DetectionStore(tmp_path)
    store.zone = lambda camera: {"revision": 0, "enabled": True}
    for track_id, candidate in ((1, "car"), (2, "car"), (3, "truck")):
        observation = sample(track_id)
        observation["detections"][0].update({
            "id": track_id,
            "class": "vehicle",
            "class_status": "uncertain",
            "candidate_class": candidate,
        })
        store.save("caltrans-d7-cctv-1031", "session-id", "test-model", observation)
    monkeypatch.setattr(video_service, "observation_store", store)

    response = client.get("/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/history?limit=1")

    assert response.status_code == 200
    assert len(response.json()["events"]) == 1
    assert response.json()["candidate_tracks"] == {"car": 2, "truck": 1}


def test_clip_history_api_returns_cursor_for_the_next_page(client, tmp_path, monkeypatch):
    from urllib.parse import urlencode
    from src.services.video_service import video_service

    store = DetectionStore(tmp_path)
    store.zone = lambda camera: {"revision": 0, "enabled": True}
    ids = [f"{index:032x}" for index in range(1, 4)]
    for index, clip_id in enumerate(ids, 1):
        store.clip_started(clip_id, "caltrans-d7-cctv-1031", "session", float(index))
        store.clip_finished(clip_id, 1)
        with store.connect() as db:
            db.execute("UPDATE clips SET created_at=? WHERE id=?",
                       (f"2026-10-20T06:00:0{index}+00:00", clip_id))
    monkeypatch.setattr(video_service, "observation_store", store)
    base = "/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/clips?limit=2"

    first = client.get(base)
    cursor = first.json()["next_cursor"]
    second = client.get(base + "&" + urlencode({"before_created_at": cursor["created_at"],
                                                "before_id": cursor["id"]}))

    assert first.status_code == second.status_code == 200
    assert [clip["id"] for clip in first.json()["clips"]] == ids[2:0:-1]
    assert first.json()["has_more"] is True
    assert [clip["id"] for clip in second.json()["clips"]] == ids[:1]
    assert second.json()["has_more"] is False


def test_clip_history_api_requires_explicit_opt_in_for_earlier_zones(client, tmp_path, monkeypatch):
    from src.services.video_service import video_service

    store = DetectionStore(tmp_path)
    store.zone = lambda camera: {"revision": 1, "enabled": True}
    ids = [f"{index:032x}" for index in (1, 2)]
    for revision, clip_id in enumerate(ids):
        store.clip_started(clip_id, "caltrans-d7-cctv-1031", "session", float(revision), zone_revision=revision)
        store.clip_finished(clip_id, 1)
    monkeypatch.setattr(video_service, "observation_store", store)
    base = "/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/clips?limit=10"

    current = client.get(base).json()
    all_revisions = client.get(base + "&include_earlier_zones=true").json()

    assert [clip["zone_revision"] for clip in current["clips"]] == [1]
    assert [clip["zone_revision"] for clip in all_revisions["clips"]] == [1, 0]
    assert all_revisions["includes_earlier_zones"] is True


def test_summary_distinguishes_playable_recording_missing_and_unavailable_crossing_clips(tmp_path):
    from datetime import datetime, timedelta, timezone

    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]], "direction": [0, 1], "minimum_motion": .008})
    ready_id, recording_id, short_id = "a" * 32, "b" * 32, "c" * 32
    store.clip_started(ready_id, "camera", "session", 0, zone_revision=zone["revision"], generation=1)
    (store.clips / f"{ready_id}.mp4").write_bytes(b"playable media")
    store.clip_finished(ready_id, 1)
    store.clip_started(recording_id, "camera", "session", 1, zone_revision=zone["revision"], generation=1)
    store.clip_started(short_id, "camera", "session", 2, zone_revision=zone["revision"], generation=1)
    store.clip_finished(short_id, .1)
    now = datetime.now(timezone.utc)
    earlier = sample(7)
    earlier_at = (now - timedelta(seconds=5)).isoformat()
    earlier.update({"sequence": 7, "observed_at": earlier_at, "analysis_zone": zone})
    earlier["detections"][0].update({"id": 7, "counted": True, "crossed_at": earlier_at})
    store.save("camera", "session", "test-model", earlier)
    pause_start = (now - timedelta(milliseconds=1)).isoformat()
    pause_end = (now + timedelta(milliseconds=10)).isoformat()
    store.evidence_pause_changed("camera", "session", "test storage pause", pause_start)
    for index, clip_id in enumerate((ready_id, recording_id, short_id, None), 1):
        observation = sample(index)
        observed_at = (now + timedelta(milliseconds=index)).isoformat()
        observation.update({"sequence": index, "observed_at": observed_at, "analysis_zone": zone})
        observation["detections"][0].update({"id": index, "counted": True, "crossed_at": observed_at})
        store.save("camera", "session", "test-model", observation, clip_id)
    store.evidence_pause_changed("camera", "session", "", pause_end)
    pedestrian = sample(5)
    pedestrian_at = (now + timedelta(milliseconds=5)).isoformat()
    pedestrian.update({"sequence": 5, "observed_at": pedestrian_at, "analysis_zone": zone})
    pedestrian["detections"][0].update({"id": 5, "class": "pedestrian", "counted": True, "crossed_at": pedestrian_at})
    store.save("camera", "session", "test-model", pedestrian)
    false_positive = sample(6)
    false_positive_at = (now + timedelta(milliseconds=6)).isoformat()
    false_positive.update({"sequence": 6, "observed_at": false_positive_at, "analysis_zone": zone})
    false_positive["detections"][0].update({"id": 6, "counted": True, "crossed_at": false_positive_at})
    store.save("camera", "session", "test-model", false_positive)
    store.review_track("camera", "session", 1, 6, "false_positive")

    linkage = store.summary("camera", (now - timedelta(minutes=1)).isoformat())["video_evidence_linkage"]

    assert linkage == {"window_seconds": 900, "counted_crossings": 5,
        "playable_clip_crossings": 1, "recording_clip_crossings": 1,
        "paused_clip_crossings": 1, "no_clip_crossings": 1,
        "unavailable_clip_crossings": 1, "playable_percent": 20.0}


def test_operator_detection_reviews_are_durable_and_compare_only_reviewed_labels(tmp_path):
    store = DetectionStore(tmp_path)
    store.save("camera", "session", "test-model", sample(1))

    saved = store.review_track("camera", "session", 1, 1, "car")
    assert saved["original_class"] == "car" and saved["reviewed_class"] == "car"
    matched = store.history("camera")["review_summary"]
    assert matched["scored_predictions"] == 1
    assert matched["matching_labels"] == 1
    assert matched["agreement_rate"] == 1
    assert store.review_track("camera", "session", 1, 1, "false_positive")["original_class"] == "car"

    reopened = DetectionStore(tmp_path).history("camera")
    assert reopened["events"][0]["feedback"]["reviewed_class"] == "false_positive"
    assert reopened["review_summary"]["reviewed_detections"] == 1
    assert reopened["review_summary"]["matching_labels"] == 0
    assert reopened["review_summary"]["class_or_detection_errors"] == 1
    assert reopened["review_summary"]["agreement_rate"] == 0


def test_review_history_remains_available_outside_the_recent_track_window(tmp_path):
    store = DetectionStore(tmp_path)
    first = sample(1)
    first["media_time_seconds"] = 10.2
    first["analysis_zone"] = {"revision": 0}
    first["detections"][0].update({"counted": True, "crossed_at": first["observed_at"]})
    store.clip_started("review-clip", "camera", "session", 8.0, generation=1)
    store.save("camera", "session", "test-model", first, clip="review-clip")
    store.clip_finished("review-clip", 10.0)
    store.review_track("camera", "session", 1, 1, "car")

    for sequence in range(2, 8):
        newer = sample(sequence)
        newer["detections"][0]["id"] = sequence
        store.save("camera", "session", "test-model", newer)

    recent = store.history("camera", limit=1)
    assert len(recent["events"]) == 1
    assert recent["events"][0]["track"] != 1
    assert len(recent["reviewed_events"]) == 1
    assert recent["reviewed_events"][0]["track"] == 1
    assert recent["reviewed_events"][0]["feedback"]["reviewed_class"] == "car"
    assert recent["reviewed_events"][0]["clip"] == "review-clip"
    assert recent["reviewed_events"][0]["crossing_offset_seconds"] == 2.2


def test_reviewed_class_updates_saved_history_and_road_crossings_without_rewriting_model_output(tmp_path):
    store = DetectionStore(tmp_path)
    store.set_zone("camera", {"enabled": True, "name": "Inbound", "polygon": [[0, 0], [1, 0], [1, 1]],
                               "direction": [0, 1], "minimum_motion": .008})
    first = sample(1)
    first["detections"][0].update({"class": "vehicle", "class_status": "uncertain",
                                   "candidate_class": "car", "counted": True,
                                   "crossed_at": first["observed_at"]})
    first["analysis_zone"] = {"revision": 1}
    store.save("camera", "session", "test-model", first)

    saved = store.review_track("camera", "session", 1, 1, "truck")
    history = DetectionStore(tmp_path).history("camera")
    summary = store.summary("camera", "2026-10-20T00:00:00+00:00")

    assert saved["original_class"] == "vehicle"
    assert saved["model_prediction"] == "car"
    assert saved["applies_to_track_counts"] is True
    assert history["events"][0]["class"] == "vehicle"
    assert history["events"][0]["effective_class"] == "truck"
    assert history["unique_tracks"] == {"truck": 1}
    assert summary["classes"] == {"truck": 1}
    assert history["review_summary"]["scored_predictions"] == 1
    assert history["review_summary"]["matching_labels"] == 0
    assert history["review_summary"]["class_or_detection_errors"] == 1
    assert history["review_summary"]["applies_to_track_counts"] is True

    store.review_track("camera", "session", 1, 1, "false_positive")
    history = store.history("camera")
    summary = store.summary("camera", "2026-10-20T00:00:00+00:00")
    assert history["events"][0]["class"] == "vehicle"
    assert history["events"][0]["effective_class"] == "false_positive"
    assert history["unique_tracks"] == {}
    assert summary["total_passed"] == 0
    assert history["review_summary"]["false_positives"] == 1


def test_reviewed_vehicle_without_a_specific_model_suggestion_is_an_abstention(tmp_path):
    store = DetectionStore(tmp_path)
    uncertain = sample(1)
    uncertain["detections"][0].update({"class": "vehicle", "class_status": "uncertain"})
    store.save("camera", "session", "test-model", uncertain)

    saved = store.review_track("camera", "session", 1, 1, "car")
    history = store.history("camera")

    assert saved["model_prediction"] is None
    assert history["unique_tracks"] == {"car": 1}
    assert history["review_summary"]["scored_predictions"] == 0
    assert history["review_summary"]["model_abstentions"] == 1
    assert history["review_summary"]["matching_labels"] == 0
    assert history["review_summary"]["agreement_rate"] is None


def test_minute_summary_distinguishes_observed_zero_from_video_gaps(tmp_path):
    from datetime import datetime, timedelta, timezone

    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]], "direction": [0, 1], "minimum_motion": .008})
    now = datetime.now(timezone.utc)
    observed_at = (now.replace(second=0, microsecond=0) - timedelta(minutes=3)).isoformat()
    crossing_at = (now.replace(second=0, microsecond=0) - timedelta(minutes=2)).isoformat()
    for sequence, timestamp in ((1, observed_at), (2, crossing_at)):
        metrics = {"sequence": sequence, "generation": 1, "media_time_seconds": sequence / 15,
            "observed_at": timestamp, "counts": {"car": int(sequence == 2)},
            "detections": [], "traffic": {"analysis_available": True}, "analysis_zone": zone}
        if sequence == 2:
            detection = {"id": 1, "class": "car", "confidence": .8, "bbox": [20, 20, 40, 30],
                        "counted": True, "crossed_at": timestamp}
            metrics["detections"] = [detection]
            metrics["observed_detections"] = [detection]
        store.save("camera", "session", "test-model", metrics)

    summary = store.summary("camera", (now - timedelta(hours=1)).isoformat())
    minutes = summary["minutes"]
    observed_minute = next(item for item in minutes if item["minute"].startswith(observed_at[:16]))
    crossing_minute = next(item for item in minutes if item["minute"].startswith(crossing_at[:16]))

    assert observed_minute["total"] == 0
    assert observed_minute["video_samples"] == 1
    assert crossing_minute["total"] == 1
    assert crossing_minute["video_samples"] == 1
    assert [item["minute"] for item in minutes] == sorted(item["minute"] for item in minutes)
    assert not any(item["minute"].startswith(now.isoformat()[:16]) for item in minutes)
    assert summary["minute_video_coverage"] is True
    assert summary["minute_timeline_sorted"] is True


def test_live_summary_compares_equivalent_local_and_utc_timestamps_by_instant(tmp_path):
    from datetime import datetime, timedelta, timezone

    store = DetectionStore(tmp_path)
    zone = store.set_zone("camera", {"enabled": True, "name": "Inbound",
        "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]], "direction": [0, 1], "minimum_motion": .008})
    observed_utc = datetime.now(timezone.utc) - timedelta(seconds=1)
    local_offset = timezone(timedelta(hours=-5))
    observed_local = observed_utc.astimezone(local_offset).isoformat()
    observation = sample(1)
    observation.update({"observed_at": observed_local, "analysis_zone": zone,
        "traffic": {"analysis_available": True, "object_count": 1, "image_coverage": .05,
                    "slow_fraction": .1, "visibility": "low_light"}})
    observation["detections"][0].update({"counted": True, "crossed_at": observed_local,
        "direction": "approaching"})
    store.save("camera", "session", "test-model", observation)

    summary = store.summary("camera", (observed_utc - timedelta(minutes=1)).isoformat())

    assert summary["tracked_in_window"] == 1
    assert summary["total_passed"] == 1
    assert summary["traffic_estimate"]["track_crossings_last_minute"] == 1
    assert summary["video_continuity"]["sample_count"] == 1
    assert summary["minutes"][0]["minute"] == observed_utc.strftime("%Y-%m-%dT%H:%M:00+00:00")


def test_existing_review_database_migrates_without_losing_human_labels(tmp_path):
    database = tmp_path / "observations.sqlite3"
    with closing(sqlite3.connect(database)) as db, db:
        db.execute("""CREATE TABLE track_feedback (
            session TEXT, generation INTEGER, track INTEGER, camera TEXT,
            original_class TEXT NOT NULL, reviewed_class TEXT NOT NULL, reviewed_at TEXT NOT NULL,
            PRIMARY KEY(session,generation,track))""")
        db.execute("""INSERT INTO track_feedback VALUES
            ('session',1,1,'camera','car','bus','2026-10-20T06:00:00+00:00')""")

    store = DetectionStore(tmp_path)
    with closing(store.connect()) as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(track_feedback)")}
        migrated = db.execute("SELECT original_class,reviewed_class,prediction_class FROM track_feedback").fetchone()

    assert "prediction_class" in columns
    assert migrated == ("car", "bus", "car")


def test_detection_review_api_accepts_valid_labels_and_rejects_unknown_tracks(client, tmp_path, monkeypatch):
    from src.services.video_service import video_service

    store = DetectionStore(tmp_path)
    store.save("caltrans-d7-cctv-1031", "session-id", "test-model", sample(1))
    monkeypatch.setattr(video_service, "observation_store", store)
    endpoint = "/api/v1/mobility/video/cameras/caltrans-d7-cctv-1031/tracks/session-id/1/1/feedback"

    response = client.put(endpoint, json={"reviewed_class": "truck"})
    assert response.status_code == 200
    assert response.json()["original_class"] == "car"
    assert response.json()["model_prediction"] == "car"
    assert response.json()["applies_to_track_counts"] is True
    assert response.json()["reviewed_class"] == "truck"
    assert client.put(endpoint, json={"reviewed_class": "plane"}).status_code == 422
    assert client.put(endpoint.replace("/1/1/feedback", "/1/2/feedback"),
                      json={"reviewed_class": "car"}).status_code == 404
def test_external_clip_directory_preserves_legacy_playback_and_counts_all_quota_bytes(tmp_path):
    root = tmp_path / "observations"
    legacy = DetectionStore(root)
    legacy_id = "a" * 32
    legacy.clip_started(legacy_id, "camera", "session", 1.0)
    legacy_path = legacy.clips / f"{legacy_id}.mp4"
    legacy_path.write_bytes(b"legacy-clip")
    legacy.clip_finished(legacy_id, 1.0)

    external_path = tmp_path / "separate-volume" / "camera-clips"
    external = DetectionStore(root, clip_directory=external_path)
    new_id = "b" * 32
    external.clip_started(new_id, "camera", "session", 2.0)
    new_path = external.clips / f"{new_id}.mp4"
    new_path.write_bytes(b"new-external-clip")
    external.clip_finished(new_id, 1.0)

    assert external.clips == external_path
    assert external.clip_path(legacy_id) == legacy_path
    assert external.clip_path(new_id) == new_path
    assert external._video_bytes() == len(b"legacy-clip") + len(b"new-external-clip")
    assert external.summary("camera", "2026-10-20T00:00:00+00:00")["video_evidence"]["external_clip_storage"] is True


def test_external_clip_capacity_checks_the_volume_that_receives_new_clips(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import src.services.detection_store as detection_store

    root = tmp_path / "observations"
    external_path = tmp_path / "separate-volume" / "camera-clips"
    store = DetectionStore(root, clip_directory=external_path, min_free_bytes=1_000_000_000)
    checked_paths = []

    def disk_usage(path):
        checked_paths.append(Path(path))
        return SimpleNamespace(free=1_200_000_000, total=20_000_000_000, used=18_800_000_000)

    monkeypatch.setattr(detection_store.shutil, "disk_usage", disk_usage)

    assert evidence_capacity_block_reason(store) == ""
    assert checked_paths == [external_path]


def test_external_clip_directory_appears_in_storage_summary_and_uses_its_free_space(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import src.services.detection_store as detection_store

    external_path = tmp_path / "evidence-volume"
    store = DetectionStore(tmp_path / "observations", clip_directory=external_path)
    checked_paths = []

    def disk_usage(path):
        checked_paths.append(Path(path))
        return SimpleNamespace(free=1_250_000_000, total=20_000_000_000, used=18_750_000_000)

    monkeypatch.setattr(detection_store.shutil, "disk_usage", disk_usage)
    summary = store.summary("camera", datetime.now(timezone.utc).isoformat())

    assert summary["video_evidence"]["external_clip_storage"] is True
    assert summary["video_evidence"]["free_disk_bytes"] == 1_250_000_000
    assert checked_paths == [external_path]
