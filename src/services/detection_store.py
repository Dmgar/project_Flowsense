"""Durable camera observations. Counts are track observations, not road flow."""
from collections import deque
from contextlib import closing
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import shutil
import sqlite3
import threading
import time

EVIDENCE_H264_PRESET = "veryfast"
EVIDENCE_H264_CRF = "28"
EVIDENCE_QUEUE_WARNING = "Evidence writer fell behind; a few clip frames may be missing. Camera analysis continues."
OBSERVATION_QUEUE_WARNING = "Observation history writer fell behind; recent road analysis may be delayed. Live video and inference continue."
EVIDENCE_DISK_RESERVE_BYTES = 1_000_000_000
STANDARD_ROAD_COVERAGE_FLOOR = .08
LOW_LIGHT_ROAD_COVERAGE_FLOOR = .20
ROAD_COVERAGE_POLICY_VERSION = 2
EVIDENCE_CAPACITY_RECHECK_SECONDS = 5.0
EVIDENCE_WRITER_RETRY_SECONDS = 5.0
VIDEO_BYTES_CACHE_SECONDS = 10.0
VIDEO_CAPACITY_SCAN_VERSION = 1
EVIDENCE_FRAME_POLICY_VERSION = 4
MIN_PLAYABLE_CLIP_SECONDS = 0.25
EVIDENCE_PREROLL_SECONDS = 1.0
RESTART_DRAIN_PAUSE_REASON = "Video evidence paused: planned service restart drain."


def _iso_timestamp(value):
    """Order ISO timestamps by instant, even when stored offsets differ."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def evidence_capacity_block_reason(store, disk_free_bytes=None, clip_bytes=None):
    """Explain why MP4 capture must pause without deleting existing evidence."""
    if clip_bytes is None:
        cached_video_bytes = getattr(store, "_video_bytes", None)
        if callable(cached_video_bytes):
            clip_bytes = cached_video_bytes()
        else:
            clip_bytes = sum(path.stat().st_size for directory in store.clip_directories
                             for path in directory.glob("*.mp4") if path.is_file())
    if clip_bytes >= store.max_video_bytes:
        return f"Video evidence paused: the {store.max_video_bytes / 1e9:g} GB clip storage limit is reached."
    free_bytes = shutil.disk_usage(store.clips).free if disk_free_bytes is None else disk_free_bytes
    reserve_bytes = getattr(store, "min_free_bytes", EVIDENCE_DISK_RESERVE_BYTES)
    if free_bytes < reserve_bytes:
        reserve_gb = reserve_bytes / 1e9
        return f"Video evidence paused: free disk space is below the configured {reserve_gb:g} GB safety reserve."
    return ""


class EvidenceStorageGate:
    """Pause MP4 output at safe limits and resume automatically after capacity returns."""
    def __init__(self, store, clock=time.monotonic, capacity_check=evidence_capacity_block_reason):
        self.store = store
        self.clock = clock
        self.capacity_check = capacity_check
        self.reason = capacity_check(store)
        self.last_checked = clock()

    @property
    def blocked(self):
        return bool(self.reason)

    def refresh(self, force=False):
        now = self.clock()
        if not force and now - self.last_checked < EVIDENCE_CAPACITY_RECHECK_SECONDS:
            return self.blocked
        self.reason = self.capacity_check(self.store)
        self.last_checked = now
        return self.blocked


def evidence_frame_interval(source_fps, queue_depth, video_bytes=None, max_video_bytes=None):
    """Reduce saved-video cadence under encoder backlog or near-full clip quota."""
    rate = max(1.0, float(source_fps))
    if video_bytes is not None and max_video_bytes is not None and max_video_bytes > 0:
        usage = max(0.0, float(video_bytes) / max_video_bytes)
        if usage >= .90:
            # Keep the footage continuous while reserving quota for more
            # crossings. Six encoded frames per second is still replayable
            # motion evidence and materially reduces storage at the hard edge.
            rate = min(rate, 6.0)
        elif usage >= .75:
            rate = min(rate, 10.0)
    if queue_depth >= 38:
        rate = min(rate, 6.0)
    elif queue_depth >= 25:
        rate = min(rate, 8.0)
    elif queue_depth >= 10:
        rate = min(rate, 12.0)
    return 1.0 / rate


def measured_evidence_fps(media_times):
    """Measure encoded-frame cadence over source media timestamps, not its target cap."""
    ordered = list(media_times)
    if len(ordered) < 2:
        return None
    elapsed = float(ordered[-1]) - float(ordered[0])
    if not math.isfinite(elapsed) or elapsed <= 0:
        return None
    return round((len(ordered) - 1) / elapsed, 1)


def evidence_h264_crf(video_bytes, max_video_bytes, free_disk_bytes=None,
                      minimum_free_bytes=EVIDENCE_DISK_RESERVE_BYTES):
    """Adapt clip quality to both its quota and the host's remaining disk headroom."""
    maximum = max(1, int(max_video_bytes))
    usage = min(1.0, max(0.0, float(video_bytes) / maximum))
    disk_headroom = (float(free_disk_bytes) - max(0, int(minimum_free_bytes))
                     if free_disk_bytes is not None else None)
    if usage >= .90 or (disk_headroom is not None and disk_headroom < 250_000_000):
        return 37
    if usage >= .75 or (disk_headroom is not None and disk_headroom < 750_000_000):
        return 31
    return int(EVIDENCE_H264_CRF)


class DetectionStore:
    def __init__(self, root, max_video_bytes=6_000_000_000, record_video=True,
                 min_free_bytes=EVIDENCE_DISK_RESERVE_BYTES, clip_directory=None):
        self.root = Path(root)
        self.max_video_bytes = max_video_bytes
        self.record_video = record_video
        self.min_free_bytes = max(0, int(min_free_bytes))
        self._video_bytes_lock = threading.Lock()
        self._video_bytes_cached = None
        self._video_bytes_cached_at = 0.0
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "observations.sqlite3"
        self.legacy_clips = self.root / "clips"
        self.clips = Path(clip_directory) if clip_directory else self.legacy_clips
        self.clips.mkdir(parents=True, exist_ok=True)
        self.clip_directories = ((self.clips, self.legacy_clips)
                                 if self.clips != self.legacy_clips and self.legacy_clips.exists()
                                 else (self.clips,))
        with closing(self.connect()) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS tracks (
                    session TEXT, generation INTEGER, track INTEGER, camera TEXT,
                    class TEXT, first_seen TEXT, last_seen TEXT, confidence REAL,
                    observations INTEGER, model TEXT, clip TEXT, bbox TEXT, candidate_class TEXT,
                    PRIMARY KEY(session,generation,track));
                CREATE INDEX IF NOT EXISTS tracks_camera_time ON tracks(camera,last_seen);
                CREATE TABLE IF NOT EXISTS samples (
                    session TEXT, sequence INTEGER, camera TEXT, observed_at TEXT,
                    media_time REAL, counts TEXT, model TEXT,
                    PRIMARY KEY(session,sequence));
                CREATE TABLE IF NOT EXISTS clips (
                    id TEXT PRIMARY KEY, camera TEXT, session TEXT, created_at TEXT,
                    duration REAL, state TEXT, start_media_time REAL);
                CREATE TABLE IF NOT EXISTS evidence_pauses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, camera TEXT NOT NULL, session TEXT NOT NULL,
                    started_at TEXT NOT NULL, ended_at TEXT, reason TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS analysis_zones (camera TEXT PRIMARY KEY,payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS analysis_runs (session TEXT,generation INTEGER,profile TEXT,
                    PRIMARY KEY(session,generation));
                CREATE TABLE IF NOT EXISTS track_feedback (
                    session TEXT, generation INTEGER, track INTEGER, camera TEXT,
                    original_class TEXT NOT NULL, reviewed_class TEXT NOT NULL,
                    reviewed_at TEXT NOT NULL, prediction_class TEXT,
                    PRIMARY KEY(session,generation,track));
                CREATE INDEX IF NOT EXISTS feedback_camera_time ON track_feedback(camera,reviewed_at);
            """)
            existing = {row[1] for row in db.execute("PRAGMA table_info(tracks)")}
            for column, definition in (("zone_revision", "INTEGER DEFAULT 0"), ("class_status", "TEXT DEFAULT 'legacy_unverified'"), ("direction", "TEXT DEFAULT 'unrestricted'"), ("counted", "INTEGER DEFAULT 0"), ("crossed_at", "TEXT"), ("model_hits", "INTEGER DEFAULT 0")):
                if column not in existing:
                    db.execute(f"ALTER TABLE tracks ADD COLUMN {column} {definition}")
            if "candidate_class" not in existing:
                db.execute("ALTER TABLE tracks ADD COLUMN candidate_class TEXT")
            feedback_columns = {row[1] for row in db.execute("PRAGMA table_info(track_feedback)")}
            if "prediction_class" not in feedback_columns:
                db.execute("ALTER TABLE track_feedback ADD COLUMN prediction_class TEXT")
                # A stored specific model class is valid historical evidence. An
                # older generic "vehicle" label stays unscored because its
                # provisional candidate was not captured with the review.
                db.execute("UPDATE track_feedback SET prediction_class=original_class "
                           "WHERE prediction_class IS NULL AND original_class!='vehicle'")
            if "zone_revision" not in {row[1] for row in db.execute("PRAGMA table_info(clips)")}:
                db.execute("ALTER TABLE clips ADD COLUMN zone_revision INTEGER DEFAULT 0")
            clip_columns = {row[1] for row in db.execute("PRAGMA table_info(clips)")}
            if "generation" not in clip_columns:
                db.execute("ALTER TABLE clips ADD COLUMN generation INTEGER")
            if "start_sequence" not in clip_columns:
                db.execute("ALTER TABLE clips ADD COLUMN start_sequence INTEGER")
            # A process crash can leave an MP4 without its final container
            # index. Preserve the file, but never report it as still recording
            # or expose it as a playable clip after the next startup.
            db.execute("UPDATE clips SET state='interrupted' WHERE state='recording'")
            sample_columns = {row[1] for row in db.execute("PRAGMA table_info(samples)")}
            for column, definition in (("zone_revision", "INTEGER DEFAULT 0"), ("traffic", "TEXT DEFAULT '{}'"),
                                       ("generation", "INTEGER DEFAULT 0")):
                if column not in sample_columns:
                    db.execute(f"ALTER TABLE samples ADD COLUMN {column} {definition}")
            db.execute("CREATE INDEX IF NOT EXISTS sample_camera_time ON samples(camera,observed_at)")
            db.execute("CREATE INDEX IF NOT EXISTS sample_session_zone_time ON samples(session,zone_revision,observed_at)")
            db.execute("CREATE INDEX IF NOT EXISTS sample_session_zone_media ON samples(session,zone_revision,media_time)")
            db.execute("CREATE INDEX IF NOT EXISTS tracks_crossings ON tracks(camera,zone_revision,crossed_at)")
            # Preserve original files, but don't present single-frame or
            # otherwise sub-second captures as reviewable video evidence.
            db.execute("UPDATE clips SET state='short' WHERE state='ready' AND duration<?",
                       (MIN_PLAYABLE_CLIP_SECONDS,))
            # Keep the observation ledger, but do not advertise a clip as ready
            # after its MP4 has been removed or moved outside configured storage.
            available_clip_ids = {
                path.stem
                for directory in self.clip_directories
                for path in directory.glob("*.mp4")
                if path.is_file()
            }
            missing_clip_ids = [clip_id for clip_id, in db.execute(
                "SELECT id FROM clips WHERE state='ready'")
                if clip_id not in available_clip_ids]
            db.executemany("UPDATE clips SET state='unavailable' WHERE id=? AND state='ready'",
                           ((clip_id,) for clip_id in missing_clip_ids))
            restored_clip_ids = [clip_id for clip_id, in db.execute(
                "SELECT id FROM clips WHERE state='unavailable' AND duration>=?",
                (MIN_PLAYABLE_CLIP_SECONDS,))
                if clip_id in available_clip_ids]
            db.executemany("UPDATE clips SET state='ready' WHERE id=? AND state='unavailable'",
                           ((clip_id,) for clip_id in restored_clip_ids))

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def zone(self, camera):
        with closing(self.connect()) as db:
            row = db.execute("SELECT payload FROM analysis_zones WHERE camera=?", (camera,)).fetchone()
        if row:
            return json.loads(row[0])
        presets = Path(__file__).resolve().parents[2] / "data/camera_analysis_zones.json"
        return json.loads(presets.read_text(encoding="utf-8")).get(camera,
            {"enabled": False, "name": "Full scene", "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
             "direction": [0, 1], "minimum_motion": .008, "revision": 0})

    def set_zone(self, camera, profile):
        profile = {**profile, "revision": self.zone(camera)["revision"] + 1}
        with closing(self.connect()) as db, db:
            db.execute("INSERT OR REPLACE INTO analysis_zones VALUES (?,?)", (camera, json.dumps(profile)))
        return profile

    def save(self, camera, session, model, metrics, clip=None):
        timestamp = metrics["observed_at"]
        profile = metrics.get("analysis_zone", {})
        with closing(self.connect()) as db, db:
            if clip is None:
                active = db.execute("""SELECT id FROM clips WHERE session=? AND generation=?
                    AND zone_revision=? AND state='recording' AND start_media_time<=?
                    ORDER BY start_media_time DESC LIMIT 1""",
                    (session, metrics.get("generation", 0), profile.get("revision", 0),
                     metrics.get("media_time_seconds", 0.0))).fetchone()
                clip = active[0] if active else None
            inserted = db.execute("INSERT OR IGNORE INTO samples (session,sequence,camera,observed_at,media_time,counts,model,zone_revision,traffic,generation) VALUES (?,?,?,?,?,?,?,?,?,?)",
                       (session, metrics["sequence"], camera, timestamp,
                        metrics["media_time_seconds"], json.dumps(metrics["counts"]), model, profile.get("revision", 0),
                        json.dumps(metrics.get("traffic", {})), metrics.get("generation", 0)))
            if inserted.rowcount == 0:
                return
            db.execute("INSERT OR IGNORE INTO analysis_runs VALUES (?,?,?)", (session, metrics["generation"], json.dumps(profile)))
            for box in metrics.get("observed_detections", metrics["detections"]):
                db.execute("""INSERT INTO tracks (session,generation,track,camera,class,first_seen,last_seen,
                    confidence,observations,model,clip,bbox,candidate_class,zone_revision,class_status,direction,counted,crossed_at,model_hits)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(session,generation,track) DO UPDATE SET
                    last_seen=excluded.last_seen, confidence=MAX(tracks.confidence,excluded.confidence),
                    observations=tracks.observations+1, bbox=excluded.bbox,
                    class=excluded.class,class_status=excluded.class_status,candidate_class=excluded.candidate_class,
                    direction=excluded.direction,
                    counted=MAX(tracks.counted,excluded.counted),crossed_at=COALESCE(tracks.crossed_at,excluded.crossed_at),
                    model_hits=MAX(tracks.model_hits,excluded.model_hits),
                    clip=CASE WHEN tracks.counted=0 AND excluded.counted=1 AND excluded.crossed_at IS NOT NULL
                              THEN excluded.clip ELSE COALESCE(tracks.clip,excluded.clip) END""",
                    (session, metrics["generation"], box["id"], camera, box["class"], timestamp,
                     timestamp, max(box["confidence"], box.get("track_confidence", 0)), 1, model, clip, json.dumps(box["bbox"]),
                     box.get("candidate_class") if box.get("class_status") == "uncertain" else None,
                     profile.get("revision", 0), box.get("class_status", "legacy_unverified"), box.get("direction", "unrestricted"),
                     int(box.get("counted", False)), box.get("crossed_at"),
                     int(box.get("model_hits", box.get("observation_hits", 1)))))

    def clip_started(self, clip, camera, session, media_time, zone_revision=0, observed_at=None,
                     generation=None, start_sequence=None):
        with closing(self.connect()) as db, db:
            db.execute("""INSERT INTO clips
                (id,camera,session,created_at,duration,state,start_media_time,zone_revision,generation,start_sequence)
                VALUES (?,?,?,?,?,?,?,?,?,?)""", (clip, camera, session,
                       observed_at or datetime.now(timezone.utc).isoformat(), 0, "recording", media_time,
                       zone_revision, generation, start_sequence))
            if observed_at and generation is not None:
                # Observation persistence runs independently from encoding. Link
                # tracks already saved from the clip's pre-roll as soon as the
                # writer opens this clip.
                db.execute("""UPDATE tracks SET clip=COALESCE(clip,?) WHERE session=? AND generation=?
                    AND zone_revision=? AND first_seen>=?""",
                    (clip, session, generation, zone_revision, observed_at))
        self._invalidate_video_bytes_cache()

    def clip_finished(self, clip, duration):
        with closing(self.connect()) as db, db:
            state = "ready" if duration >= MIN_PLAYABLE_CLIP_SECONDS else "short"
            db.execute("UPDATE clips SET duration=?,state=? WHERE id=?", (duration, state, clip))
        self._invalidate_video_bytes_cache()

    def clip_failed(self, clip, duration):
        """Retain a partial MP4 for diagnosis without advertising it as playable."""
        if not clip:
            return
        with closing(self.connect()) as db, db:
            db.execute("UPDATE clips SET duration=?,state='interrupted' WHERE id=? AND state='recording'",
                       (max(0.0, float(duration)), clip))
        self._invalidate_video_bytes_cache()

    def evidence_pause_changed(self, camera, session, reason, observed_at=None):
        """Persist pause transitions while ignoring timestamps from stale queued frames."""
        stamp = observed_at or datetime.now(timezone.utc).isoformat()
        with closing(self.connect()) as db, db:
            active = db.execute("SELECT id,reason,started_at FROM evidence_pauses WHERE camera=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1", (camera,)).fetchone()
            if reason and active and active[1] == reason:
                return
            if active:
                # The recorder may process an already-queued frame after an
                # API restart has written a newer transition. Do not let that
                # stale frame reverse or replace the active pause interval.
                if _iso_timestamp(stamp) < _iso_timestamp(active[2]):
                    return
                db.execute("UPDATE evidence_pauses SET ended_at=? WHERE id=?", (stamp, active[0]))
            elif reason:
                latest = db.execute("SELECT ended_at FROM evidence_pauses WHERE camera=? ORDER BY id DESC LIMIT 1",
                                    (camera,)).fetchone()
                if latest and latest[0] and _iso_timestamp(stamp) < _iso_timestamp(latest[0]):
                    return
            if reason:
                db.execute("INSERT INTO evidence_pauses(camera,session,started_at,reason) VALUES (?,?,?,?)",
                           (camera, session, stamp, reason))

    def _invalidate_video_bytes_cache(self):
        with self._video_bytes_lock:
            self._video_bytes_cached = None
            self._video_bytes_cached_at = 0.0

    def _video_bytes(self):
        """Avoid a directory-wide MP4 stat scan on every frequently polled summary."""
        now = time.monotonic()
        with self._video_bytes_lock:
            if (self._video_bytes_cached is not None
                    and now - self._video_bytes_cached_at < VIDEO_BYTES_CACHE_SECONDS):
                return self._video_bytes_cached
            total = sum(path.stat().st_size for directory in self.clip_directories
                        for path in directory.glob("*.mp4") if path.is_file())
            self._video_bytes_cached = total
            self._video_bytes_cached_at = now
            return total

    def history(self, camera, limit=100, include_legacy=False):
        analysis_zone = self.zone(camera)
        revision = analysis_zone["revision"]
        condition = "camera=?" if include_legacy else "camera=? AND zone_revision=?"
        parameters = (camera,) if include_legacy else (camera, revision)
        with closing(self.connect()) as db:
            db.row_factory = sqlite3.Row
            events = [dict(row) for row in db.execute(f"SELECT * FROM tracks WHERE {condition} ORDER BY julianday(last_seen) DESC LIMIT ?", (*parameters, limit))]
            # Keep operator-reviewed evidence independently addressable even
            # after high-volume cameras push those tracks out of recent history.
            reviewed_events = [dict(row) for row in db.execute("""SELECT tracks.* FROM tracks
                JOIN track_feedback ON track_feedback.session=tracks.session
                    AND track_feedback.generation=tracks.generation AND track_feedback.track=tracks.track
                WHERE tracks.camera=? ORDER BY julianday(track_feedback.reviewed_at) DESC LIMIT 50""", (camera,))]
            for event in reviewed_events:
                if not event["counted"] or not event["crossed_at"] or not event["clip"]:
                    continue
                if event["generation"] is not None:
                    sample_row = db.execute("""SELECT media_time FROM samples
                        WHERE session=? AND generation=? AND zone_revision=?
                        ORDER BY ABS(julianday(observed_at)-julianday(?)) LIMIT 1""",
                        (event["session"], event["generation"], event["zone_revision"], event["crossed_at"])).fetchone()
                else:
                    sample_row = db.execute("""SELECT media_time FROM samples
                        WHERE session=? AND zone_revision=?
                        ORDER BY ABS(julianday(observed_at)-julianday(?)) LIMIT 1""",
                        (event["session"], event["zone_revision"], event["crossed_at"])).fetchone()
                clip_row = db.execute("SELECT start_media_time FROM clips WHERE id=?", (event["clip"],)).fetchone()
                if sample_row and clip_row:
                    event["crossing_offset_seconds"] = round(max(0.0, sample_row[0] - clip_row[0]), 3)
            clips = [dict(row) for row in db.execute(f"SELECT * FROM clips WHERE {condition} ORDER BY julianday(created_at) DESC LIMIT ?", (*parameters, 30))]
            # The evidence writer can process queued frames after capture. Use
            # the sample timestamps/media positions to present clip time and
            # crossing evidence instead of the writer thread's delayed clock
            # or a track's original (possibly earlier) clip.
            for clip in clips:
                start_sample = None
                if clip["start_sequence"] is not None:
                        start_sample = db.execute("""SELECT observed_at FROM samples
                        WHERE session=? AND sequence=? AND zone_revision=?""",
                        (clip["session"], clip["start_sequence"], clip["zone_revision"])).fetchone()
                if not start_sample:
                    generation_row = db.execute("SELECT generation FROM tracks WHERE session=? AND camera=? AND clip=? LIMIT 1",
                        (clip["session"], camera, clip["id"])).fetchone()
                    if clip["generation"] is not None:
                        generation_row = (clip["generation"],)
                    if generation_row:
                        start_sample = db.execute("""SELECT observed_at FROM samples
                            WHERE session=? AND generation=? AND zone_revision=? AND ABS(media_time-?)<=.25
                            ORDER BY ABS(media_time-?) LIMIT 1""",
                            (clip["session"], generation_row[0], clip["zone_revision"],
                             clip["start_media_time"], clip["start_media_time"])).fetchone()
                if not start_sample and clip["generation"] is None:
                    # Old clips have no source-generation identity. Keep their
                    # original timestamp rather than guessing across reconnects.
                    pass
                if start_sample:
                    clip["created_at"] = start_sample[0]
            clips.sort(key=lambda clip: _iso_timestamp(clip["created_at"]), reverse=True)
            for event in events:
                if not event["counted"] or not event["crossed_at"]:
                    continue
                if event["generation"] is not None:
                    crossing_sample = db.execute("""SELECT media_time FROM samples
                        WHERE session=? AND generation=? AND zone_revision=?
                        ORDER BY ABS(julianday(observed_at)-julianday(?)) LIMIT 1""",
                        (event["session"], event["generation"], event["zone_revision"], event["crossed_at"])).fetchone()
                else:
                    crossing_sample = db.execute("""SELECT media_time FROM samples
                        WHERE session=? AND zone_revision=?
                        ORDER BY ABS(julianday(observed_at)-julianday(?)) LIMIT 1""",
                        (event["session"], event["zone_revision"], event["crossed_at"])).fetchone()
                if not crossing_sample:
                    continue
                media_time = crossing_sample[0]
                if event["generation"] is not None:
                    crossing_clip = db.execute("""SELECT id,start_media_time FROM clips WHERE session=? AND generation=? AND zone_revision=?
                        AND start_media_time<=? AND (state='recording' OR start_media_time+duration>=?)
                        ORDER BY start_media_time DESC LIMIT 1""",
                        (event["session"], event["generation"], event["zone_revision"], media_time, media_time)).fetchone()
                else:
                    crossing_clip = db.execute("""SELECT id,start_media_time FROM clips WHERE session=? AND zone_revision=?
                        AND start_media_time<=? AND (state='recording' OR start_media_time+duration>=?)
                        ORDER BY start_media_time DESC LIMIT 1""",
                        (event["session"], event["zone_revision"], media_time, media_time)).fetchone()
                if crossing_clip:
                    event["clip"] = crossing_clip["id"]
                    event["crossing_offset_seconds"] = round(max(0.0, media_time - crossing_clip["start_media_time"]), 3)
            class_expression = "COALESCE(track_feedback.reviewed_class,tracks.class)"
            feedback_join = "LEFT JOIN track_feedback ON track_feedback.session=tracks.session " \
                "AND track_feedback.generation=tracks.generation AND track_feedback.track=tracks.track"
            count_condition = condition.replace("camera", "tracks.camera").replace("zone_revision", "tracks.zone_revision")
            counts = dict(db.execute(f"""SELECT {class_expression},COUNT(*) FROM tracks
                {feedback_join} WHERE {count_condition} AND {class_expression}!='false_positive'
                GROUP BY {class_expression}""", parameters))
            candidate_counts = dict(db.execute(f"""SELECT tracks.candidate_class,COUNT(*) FROM tracks
                LEFT JOIN track_feedback ON track_feedback.session=tracks.session
                    AND track_feedback.generation=tracks.generation AND track_feedback.track=tracks.track
                WHERE {count_condition} AND tracks.class='vehicle' AND tracks.class_status='uncertain'
                    AND tracks.candidate_class IS NOT NULL AND track_feedback.track IS NULL
                GROUP BY tracks.candidate_class""", parameters))
            older = db.execute("SELECT COUNT(*) FROM tracks WHERE camera=? AND zone_revision!=?", (camera, revision)).fetchone()[0]
            last = db.execute("SELECT observed_at FROM samples WHERE camera=? ORDER BY julianday(observed_at) DESC LIMIT 1", (camera,)).fetchone()
            feedback_rows = list(db.execute("SELECT session,generation,track,original_class,reviewed_class,reviewed_at,prediction_class FROM track_feedback WHERE camera=?", (camera,)))
        feedback_by_track = {(row[0], row[1], row[2]): row[3:] for row in feedback_rows}
        for event in [*events, *reviewed_events]:
            event["bbox"] = json.loads(event["bbox"])
            if event["class_status"] != "uncertain":
                event["candidate_class"] = None
            feedback = feedback_by_track.get((event["session"], event["generation"], event["track"]))
            event["effective_class"] = feedback[1] if feedback else event["class"]
            event["feedback"] = ({"original_class": feedback[0], "reviewed_class": feedback[1],
                                   "reviewed_at": feedback[2], "model_prediction": feedback[3]} if feedback else None)
        recent_review_keys = {(event["session"], event["generation"], event["track"]) for event in events}
        reviewed_events = [event for event in reviewed_events
                           if (event["session"], event["generation"], event["track"]) not in recent_review_keys]
        matching_labels = sum(row[6] is not None and row[4] == row[6] for row in feedback_rows)
        false_positives = sum(row[4] == "false_positive" for row in feedback_rows)
        scored_predictions = sum(row[6] is not None and row[4] not in {"vehicle", "false_positive"}
                                 for row in feedback_rows)
        model_abstentions = sum(row[6] is None and row[4] not in {"vehicle", "false_positive"}
                                for row in feedback_rows)
        evaluated = scored_predictions + false_positives
        class_or_detection_errors = evaluated - matching_labels
        return {"camera_id": camera, "data_origin": "camera_video_model_observation",
                "directional_zone_enabled": bool(analysis_zone.get("enabled")),
                "zone_revision": revision, "includes_earlier_analysis": include_legacy, "earlier_tracks": older,
                "count_semantics": "Unique session tracks; not calibrated road flow or distinct physical vehicles across sessions.",
                "review_summary": {"reviewed_detections": len(feedback_rows),
                    "scored_predictions": scored_predictions, "matching_labels": matching_labels,
                    "class_or_detection_errors": class_or_detection_errors,
                    "model_abstentions": model_abstentions, "false_positives": false_positives,
                    "agreement_rate": matching_labels / evaluated if evaluated else None,
                    "applies_to_track_counts": True,
                    "basis": "Specific model labels are compared with reviewed video labels. Generic model abstentions and reviews with unclear type are kept separate; this selected sample is not a random accuracy estimate."},
                "unique_tracks": counts, "candidate_tracks": candidate_counts,
                "last_observed_at": last[0] if last else None,
                "events": events, "reviewed_events": reviewed_events, "clips": clips}

    def review_track(self, camera, session, generation, track, reviewed_class):
        """Save an operator label without rewriting the model's original observation."""
        reviewed_at = datetime.now(timezone.utc).isoformat()
        with closing(self.connect()) as db, db:
            row = db.execute("SELECT class,candidate_class,class_status FROM tracks WHERE camera=? AND session=? AND generation=? AND track=?",
                             (camera, session, generation, track)).fetchone()
            if not row:
                return None
            original_class = row[0]
            prediction_class = row[1] if row[2] == "uncertain" else row[0]
            if prediction_class not in {"car", "truck", "bus", "motorcycle", "bicycle", "pedestrian", "rider"}:
                prediction_class = None
            db.execute("""INSERT INTO track_feedback(session,generation,track,camera,original_class,reviewed_class,reviewed_at,prediction_class)
                VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(session,generation,track) DO UPDATE SET
                original_class=excluded.original_class,reviewed_class=excluded.reviewed_class,
                reviewed_at=excluded.reviewed_at,prediction_class=excluded.prediction_class""",
                (session, generation, track, camera, original_class, reviewed_class, reviewed_at, prediction_class))
        return {"camera_id": camera, "session": session, "generation": generation, "track": track,
                "original_class": original_class, "model_prediction": prediction_class,
                "reviewed_class": reviewed_class, "reviewed_at": reviewed_at,
                "applies_to_track_counts": True}

    def clip_path(self, clip):
        with closing(self.connect()) as db:
            row = db.execute("SELECT state FROM clips WHERE id=?", (clip,)).fetchone()
        if not row or row[0] != "ready":
            return None
        return next((path for directory in self.clip_directories
                     if (path := directory / f"{clip}.mp4").is_file()), None)

    def clip_history(self, camera, limit=30, before=None, include_earlier_zones=False):
        """Return a stable page of ready clips, optionally spanning older road-zone revisions."""
        zone = self.zone(camera)
        revision = zone["revision"]
        with closing(self.connect()) as db:
            db.row_factory = sqlite3.Row
            query = "SELECT * FROM clips WHERE camera=? AND state='ready'"
            parameters = [camera]
            if not include_earlier_zones:
                query += " AND zone_revision=?"
                parameters.append(revision)
            if before:
                query += " AND (julianday(created_at)<julianday(?) OR (julianday(created_at)=julianday(?) AND id<?))"
                parameters.extend((before["created_at"], before["created_at"], before["id"]))
            query += " ORDER BY julianday(created_at) DESC,id DESC LIMIT ?"
            parameters.append(limit + 1)
            rows = [dict(row) for row in db.execute(query, parameters)]
            has_more = len(rows) > limit
            rows = rows[:limit]
            for clip in rows:
                clip["_cursor_created_at"] = clip["created_at"]
                start_sample = None
                if clip["start_sequence"] is not None:
                    start_sample = db.execute("""SELECT observed_at FROM samples
                        WHERE session=? AND sequence=? AND zone_revision=?""",
                        (clip["session"], clip["start_sequence"], clip["zone_revision"])).fetchone()
                if not start_sample and clip["generation"] is not None:
                    start_sample = db.execute("""SELECT observed_at FROM samples
                        WHERE session=? AND generation=? AND zone_revision=? AND ABS(media_time-?)<=.25
                        ORDER BY ABS(media_time-?) LIMIT 1""",
                        (clip["session"], clip["generation"], clip["zone_revision"],
                         clip["start_media_time"], clip["start_media_time"])).fetchone()
                if start_sample:
                    clip["created_at"] = start_sample[0]
        next_cursor = ({"created_at": rows[-1]["_cursor_created_at"], "id": rows[-1]["id"]}
                       if rows and has_more else None)
        for clip in rows:
            clip.pop("_cursor_created_at", None)
        return {"camera_id": camera, "zone_revision": revision,
                "includes_earlier_zones": bool(include_earlier_zones), "clips": rows,
                "has_more": has_more, "next_cursor": next_cursor}

    def summary(self, camera, since):
        from datetime import timedelta
        import statistics
        now = datetime.now(timezone.utc)
        live_window_start = (now - timedelta(seconds=2)).isoformat()
        crossing_window_start = (now - timedelta(seconds=60)).isoformat()
        continuity_window_start = (now - timedelta(minutes=15)).isoformat()
        chart_window_start = (now - timedelta(minutes=30)).isoformat()
        analysis_zone = self.zone(camera)
        revision = analysis_zone["revision"]
        with closing(self.connect()) as db:
            class_expression = "COALESCE(track_feedback.reviewed_class,tracks.class)"
            feedback_join = "LEFT JOIN track_feedback ON track_feedback.session=tracks.session " \
                "AND track_feedback.generation=tracks.generation AND track_feedback.track=tracks.track"
            class_counts_filter = f"{class_expression} NOT IN ('pedestrian','false_positive')"
            count_filter = f"{class_expression} NOT IN ('pedestrian','rider','false_positive')"
            counts = dict(db.execute(f"SELECT {class_expression},COUNT(*) FROM tracks {feedback_join} WHERE tracks.camera=? AND tracks.zone_revision=? AND tracks.counted=1 AND {class_counts_filter} AND julianday(tracks.crossed_at)>=julianday(?) GROUP BY {class_expression}", (camera, revision, since))) if analysis_zone.get("enabled") else {}
            # Keep the live badge independent from the longer monitoring-history
            # range. `since` is used for cumulative crossings, while this value
            # represents tracks that were actually updated in the last 2 seconds.
            observed = db.execute("SELECT COUNT(*) FROM tracks WHERE camera=? AND zone_revision=? AND julianday(last_seen)>=julianday(?)", (camera, revision, live_window_start)).fetchone()[0]
            crossing_counts = dict(db.execute(f"SELECT {class_expression},COUNT(*) FROM tracks {feedback_join} WHERE tracks.camera=? AND tracks.zone_revision=? AND tracks.counted=1 AND {count_filter} AND julianday(tracks.crossed_at)>=julianday(?) GROUP BY {class_expression}", (camera, revision, crossing_window_start))) if analysis_zone.get("enabled") else {}
            quality_row = db.execute(f"""SELECT COUNT(*),
                SUM(CASE WHEN (julianday(tracks.last_seen)-julianday(tracks.first_seen))*86400 < 2 THEN 1 ELSE 0 END),
                AVG(tracks.observations)
                FROM tracks {feedback_join}
                WHERE tracks.camera=? AND tracks.zone_revision=? AND tracks.counted=1
                AND {count_filter} AND julianday(tracks.crossed_at)>=julianday(?)""",
                (camera, revision, crossing_window_start)).fetchone() if analysis_zone.get("enabled") else (0, 0, None)
            bins = list(db.execute(f"SELECT strftime('%Y-%m-%dT%H:%M',tracks.crossed_at),{class_expression},COUNT(*) FROM tracks {feedback_join} WHERE tracks.camera=? AND tracks.zone_revision=? AND tracks.counted=1 AND {class_counts_filter} AND julianday(tracks.crossed_at)>=julianday(?) GROUP BY strftime('%Y-%m-%dT%H:%M',tracks.crossed_at),{class_expression} ORDER BY 1", (camera, revision, since))) if analysis_zone.get("enabled") else []
            sample_bins = list(db.execute("SELECT strftime('%Y-%m-%dT%H:%M',observed_at),COUNT(*) FROM samples WHERE camera=? AND zone_revision=? AND julianday(observed_at)>=julianday(?) GROUP BY strftime('%Y-%m-%dT%H:%M',observed_at)", (camera, revision, chart_window_start))) if analysis_zone.get("enabled") else []
            rows = list(db.execute("SELECT observed_at,traffic FROM samples WHERE camera=? AND zone_revision=? AND julianday(observed_at)>=julianday(?) ORDER BY julianday(observed_at) DESC LIMIT 120", (camera, revision, (now - timedelta(seconds=60)).isoformat()))) if analysis_zone.get("enabled") else []
            continuity_rows = list(db.execute("SELECT session,observed_at FROM samples WHERE camera=? AND zone_revision=? AND julianday(observed_at)>=julianday(?) ORDER BY julianday(observed_at)", (camera, revision, continuity_window_start))) if analysis_zone.get("enabled") else []
            crossing_evidence_rows = list(db.execute("""SELECT tracks.clip,clips.state,COUNT(*) AS crossings,
                    SUM(CASE WHEN tracks.clip IS NULL AND EXISTS (
                        SELECT 1 FROM evidence_pauses pauses
                        WHERE pauses.camera=tracks.camera
                            AND julianday(tracks.crossed_at)>=julianday(pauses.started_at)
                            AND (pauses.ended_at IS NULL OR julianday(tracks.crossed_at)<=julianday(pauses.ended_at))
                    ) THEN 1 ELSE 0 END) AS paused_crossings
                FROM tracks
                LEFT JOIN track_feedback ON track_feedback.session=tracks.session
                    AND track_feedback.generation=tracks.generation AND track_feedback.track=tracks.track
                LEFT JOIN clips ON clips.id=tracks.clip
                WHERE tracks.camera=? AND tracks.zone_revision=? AND tracks.counted=1
                    AND julianday(tracks.crossed_at)>=julianday(?)
                    AND COALESCE(track_feedback.reviewed_class,tracks.class) NOT IN ('pedestrian','rider','false_positive')
                GROUP BY tracks.clip,clips.state""",
                (camera, revision, continuity_window_start))) if analysis_zone.get("enabled") else []
            ready_clips = db.execute("SELECT COUNT(*) FROM clips WHERE camera=? AND state='ready'", (camera,)).fetchone()[0]
            recording_clips = db.execute("SELECT COUNT(*) FROM clips WHERE camera=? AND state='recording'", (camera,)).fetchone()[0]
            interrupted_clips = db.execute("SELECT COUNT(*) FROM clips WHERE camera=? AND state='interrupted'", (camera,)).fetchone()[0]
            short_clips = db.execute("SELECT COUNT(*) FROM clips WHERE camera=? AND state='short'", (camera,)).fetchone()[0]
            unavailable_clips = db.execute("SELECT COUNT(*) FROM clips WHERE camera=? AND state='unavailable'", (camera,)).fetchone()[0]
            evidence_pauses = list(db.execute("SELECT started_at,ended_at,reason FROM evidence_pauses WHERE camera=? ORDER BY id DESC LIMIT 10", (camera,)))
        minute_bins = {}
        for minute, kind, count in bins:
            entry = minute_bins.setdefault(minute, {"minute": minute + ":00+00:00", "total": 0, "classes": {}, "video_samples": 0})
            if kind != "rider":
                entry["total"] += count
            entry["classes"][kind] = count
        for minute, sample_count in sample_bins:
            entry = minute_bins.setdefault(minute, {"minute": minute + ":00+00:00", "total": 0, "classes": {}, "video_samples": 0})
            entry["video_samples"] = sample_count
        counted_tracks, brief_tracks, average_observations = quality_row
        track_quality = {
            "counted_track_count": counted_tracks or 0,
            "brief_track_count": brief_tracks or 0,
            "brief_track_percent": round(brief_tracks * 100 / counted_tracks, 1) if counted_tracks else None,
            "average_observations": round(average_observations, 1) if average_observations is not None else None,
        }
        measured = [(stamp, json.loads(payload)) for stamp, payload in rows if json.loads(payload).get("analysis_available")]
        continuity_times = [datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
                            for _, stamp in continuity_rows]
        continuity_gaps = [max(0.0, later - earlier)
                           for earlier, later in zip(continuity_times, continuity_times[1:])]
        long_pauses = [gap for gap in continuity_gaps if gap > 2.0]
        pause_details = [
            {"from": earlier_stamp, "to": later_stamp, "duration_seconds": round(gap, 1),
             "session_changed": earlier_session != later_session, "in_progress": False}
            for (earlier_session, earlier_stamp), (later_session, later_stamp), gap
            in zip(continuity_rows, continuity_rows[1:], continuity_gaps) if gap > 2.0
        ][-10:]
        latest_sample_age = max(0.0, now.timestamp() - continuity_times[-1]) if continuity_times else None
        if latest_sample_age is not None and latest_sample_age > 2.0:
            pause_details.append({"from": continuity_rows[-1][1], "to": now.isoformat(),
                "duration_seconds": round(latest_sample_age, 1), "session_changed": False,
                "in_progress": True})
        continuity_start = now.timestamp() - 900
        unobserved_time = sum(gap - 2.0 for gap in long_pauses)
        if continuity_times:
            unobserved_time += max(0.0, continuity_times[0] - continuity_start - 2.0)
            unobserved_time += max(0.0, now.timestamp() - continuity_times[-1] - 2.0)
        continuity = {
            "window_seconds": 900,
            "sample_count": len(continuity_rows),
            "session_count": len({session for session, _ in continuity_rows}),
            "long_pause_count": len(long_pauses),
            "longest_pause_seconds": round(max(long_pauses), 1) if long_pauses else 0.0,
            "recent_pauses": pause_details,
            "coverage_percent": round(max(0.0, 900.0 - unobserved_time) * 100 / 900.0, 1),
            "latest_sample_age_seconds": round(latest_sample_age, 1) if latest_sample_age is not None else None,
        }
        estimate = {"level": "unknown", "label": "Collecting observations", "sample_count": len(measured),
                    "visibility": "low_light" if any(item.get("visibility") == "low_light" for _, item in measured) else "standard",
                    "image_coverage_percent": None, "slow_fraction": None, "score": None,
                    "track_crossings_last_minute": sum(crossing_counts.values()),
                    "updated_at": measured[0][0] if measured else None, "basis": "Image coverage and tracked movement; no calibrated road speed."}
        if not analysis_zone.get("enabled"):
            estimate.update(label="Direction zone required", sample_count=0, updated_at=None,
                basis="A camera-specific road polygon and travel direction must be enabled before full-scene detections can be counted or attributed to a road.")
        fresh = bool(analysis_zone.get("enabled") and measured) and (now - datetime.fromisoformat(measured[0][0])).total_seconds() <= 5
        if not analysis_zone.get("enabled"):
            pass
        elif not fresh:
            estimate["label"] = "No recent estimate"
        elif len(measured) >= 8:
            crowd = statistics.mean(item.get("object_count", 0) for _, item in measured)
            coverage = statistics.mean(item.get("image_coverage", 0) for _, item in measured)
            slow_values = [item["slow_fraction"] for _, item in measured
                           if item.get("object_count", 0)
                           and isinstance(item.get("slow_fraction"), (int, float))
                           and math.isfinite(item["slow_fraction"])]
            slow = statistics.mean(slow_values) if slow_values else None
            estimate.update(image_coverage_percent=round(coverage * 100, 1),
                            slow_fraction=round(slow, 3) if slow is not None else None,
                            movement_sample_count=len(slow_values))
            low_light = estimate["visibility"] == "low_light"
            coverage_floor = LOW_LIGHT_ROAD_COVERAGE_FLOOR if low_light else STANDARD_ROAD_COVERAGE_FLOOR
            # Night glare and low contrast reduce the share of a road that can
            # be observed reliably. Preserve vehicle flow, but withhold a road
            # condition until the camera covers a larger portion of its zone.
            if coverage < coverage_floor:
                estimate.update(evidence_quality="sparse", label="Sparse road coverage")
                if crowd >= 1:
                    estimate["label"] = "Vehicle movement · sparse view"
                elif estimate["track_crossings_last_minute"] >= 3:
                    estimate.update(label="Inbound vehicle flow · congestion unknown",
                        basis="Inbound track crossings are confirmed, but sparse image coverage is insufficient to estimate congestion.")
            elif crowd >= 3 and slow is not None and slow >= .6:
                estimate.update(level="slow", label="Possible queue", score=.8)
            elif crowd >= 3 and slow is not None and slow >= .4:
                estimate.update(level="building", label="Traffic slowing", score=.5)
            elif crowd >= 1 and slow is not None:
                estimate.update(level="moving", label="Traffic moving", score=.15)
            elif crowd >= 1:
                estimate.update(evidence_quality="motion_unavailable",
                    label="Vehicle movement · motion unavailable",
                    basis="Vehicles are visible, but no recent track motion could be measured; congestion is withheld.")
        video_bytes = self._video_bytes()
        free_disk_bytes = shutil.disk_usage(self.clips).free
        storage_block_reason = (evidence_capacity_block_reason(self, free_disk_bytes, video_bytes)
                                if self.record_video else "")
        evidence_linkage = {"window_seconds": 900, "counted_crossings": 0,
            "playable_clip_crossings": 0, "recording_clip_crossings": 0,
            "paused_clip_crossings": 0, "no_clip_crossings": 0, "unavailable_clip_crossings": 0,
            "playable_percent": None}
        for clip_id, clip_state, crossing_count, paused_crossings in crossing_evidence_rows:
            evidence_linkage["counted_crossings"] += crossing_count
            if clip_id is None:
                evidence_linkage["paused_clip_crossings"] += paused_crossings or 0
                evidence_linkage["no_clip_crossings"] += crossing_count - (paused_crossings or 0)
            elif clip_state == "recording":
                evidence_linkage["recording_clip_crossings"] += crossing_count
            elif clip_state == "ready" and self.clip_path(clip_id):
                evidence_linkage["playable_clip_crossings"] += crossing_count
            else:
                evidence_linkage["unavailable_clip_crossings"] += crossing_count
        if evidence_linkage["counted_crossings"]:
            evidence_linkage["playable_percent"] = round(
                evidence_linkage["playable_clip_crossings"] * 100 / evidence_linkage["counted_crossings"], 1)
        recording_pause_history = []
        for start, end, reason in reversed(evidence_pauses):
            timing_conflict = False
            if end:
                try:
                    timing_conflict = _iso_timestamp(end) < _iso_timestamp(start)
                except (TypeError, ValueError):
                    timing_conflict = True
            pause = {"started_at": start,
                "ended_at": None if timing_conflict else end,
                "reason": reason, "in_progress": end is None}
            if timing_conflict:
                pause["timestamp_conflict"] = True
            recording_pause_history.append(pause)
        return {"camera_id": camera, "since": since, "zone_revision": revision,
            "road_coverage_policy_version": ROAD_COVERAGE_POLICY_VERSION,
            "directional_zone_enabled": bool(analysis_zone.get("enabled")),
            "total_passed": sum(count for kind, count in counts.items() if kind != "rider"), "classes": counts, "tracked_in_window": observed,
            "minutes": [minute_bins[key] for key in sorted(minute_bins)][-120:],
            "minute_video_coverage": True, "minute_timeline_sorted": True,
            "traffic_estimate": estimate,
            "video_continuity": continuity,
            "track_quality": track_quality,
            "video_evidence_linkage": evidence_linkage,
            "video_evidence": {"enabled": self.record_video, "ready_clips": ready_clips,
                               "external_clip_storage": self.clips != self.legacy_clips,
                               "recording_clips": recording_clips, "interrupted_clips": interrupted_clips,
                               "short_clips": short_clips, "unavailable_clips": unavailable_clips,
                               "bytes_used": video_bytes,
                               "max_bytes": self.max_video_bytes,
                               "encoding_crf": evidence_h264_crf(video_bytes, self.max_video_bytes,
                                   free_disk_bytes, self.min_free_bytes),
                               "free_disk_bytes": free_disk_bytes,
                               "minimum_free_bytes": self.min_free_bytes,
                               "storage_block_reason": storage_block_reason,
                               "recent_recording_pauses": recording_pause_history},
            "count_basis": "One approaching crossing is counted per track ID. Rider tracks are shown separately and excluded from passage totals because a rider box can overlap a bicycle or motorcycle box; review the clip to assign its mode. Counts are model estimates, not confirmed distinct vehicles; missed tracks can undercount and identity splits can overcount."}


class EvidenceRecorder:
    """Bounded asynchronous H.264 evidence encoding and observation writes."""
    def __init__(self, store, camera, session, fps, model):
        import queue
        import threading
        self.store, self.camera, self.session = store, camera, session
        self.fps, self.model = fps, model
        self.queue = queue.Queue(maxsize=45)
        # Keep durable analysis independent from the much heavier H.264 encoder.
        # A busy clip queue must not make fresh road measurements appear stale.
        self.observation_queue = queue.Queue(maxsize=120)
        self.observation_stop = threading.Event()
        self.observation_error = ""
        self.observation_dropped = 0
        self.last_saved_media_time = -10.0
        self.last_saved_ids = set()
        self.last_saved_crossed = set()
        self.current_clip = None
        self.evidence_fps = None
        self._recent_encoded_media_times = deque(maxlen=120)
        self.observation_thread = threading.Thread(target=self._save_observations, daemon=True,
                                                   name=f"observations-{camera}")
        self.observation_thread.start()
        self.stop = threading.Event()
        self.restart_requested = threading.Event()
        self.restart_drained = threading.Event()
        self.error = ""
        self.skipped_frames = 0
        self.sampled_frames = 0
        self.last_queued_media_time = None
        self.last_generation = None
        self.thread = threading.Thread(target=self.run, daemon=True, name=f"evidence-{camera}")
        self.thread.start()

    def request_restart_drain(self):
        """Stop opening new clips and finalize the current clip before restart."""
        self.restart_requested.set()
        self.store.evidence_pause_changed(self.camera, self.session, RESTART_DRAIN_PAUSE_REASON)

    def cancel_restart_drain(self):
        self.restart_drained.clear()
        self.restart_requested.clear()

    @property
    def restart_drain_ready(self):
        return self.restart_drained.is_set()

    def submit(self, frame, metrics):
        import queue
        observed = metrics.get("observed_detections", metrics.get("detections", []))
        generation = metrics.get("generation", 0)
        ids = {(generation, box["id"]) for box in observed}
        crossed = {(generation, box["id"]) for box in observed if box.get("counted")}
        media_time = float(metrics.get("media_time_seconds", 0.0))
        if (media_time - self.last_saved_media_time >= .5 or ids - self.last_saved_ids
                or crossed - self.last_saved_crossed or media_time < self.last_saved_media_time):
            self.last_saved_media_time = media_time
            self.last_saved_ids = ids
            self.last_saved_crossed = crossed
            try:
                self.observation_queue.put_nowait((metrics, self.current_clip))
            except queue.Full:
                # Favor fresh road conditions over a stale backlog. The UI status
                # reports this explicitly until the independent writer catches up.
                try:
                    self.observation_queue.get_nowait()
                    self.observation_queue.task_done()
                    self.observation_dropped += 1
                    self.observation_queue.put_nowait((metrics, self.current_clip))
                except queue.Empty:
                    self.observation_dropped += 1
                except queue.Full:
                    self.observation_dropped += 1
                self.observation_error = OBSERVATION_QUEUE_WARNING
        media_time = float(metrics.get("media_time_seconds", 0.0))
        generation = metrics.get("generation")
        if generation != self.last_generation or (
            self.last_queued_media_time is not None and media_time < self.last_queued_media_time
        ):
            self.last_queued_media_time = None
            self.last_generation = generation
        store = getattr(self, "store", None)
        video_bytes = store._video_bytes() if callable(getattr(store, "_video_bytes", None)) else None
        max_video_bytes = getattr(store, "max_video_bytes", None)
        interval = evidence_frame_interval(self.fps, self.queue.qsize(), video_bytes, max_video_bytes)
        if (self.last_queued_media_time is not None
                and media_time - self.last_queued_media_time + 1e-6 < interval):
            self.sampled_frames += 1
            return
        self.last_queued_media_time = media_time
        try:
            self.queue.put_nowait((frame, metrics))
        except queue.Full:
            self.skipped_frames += 1
            self.error = EVIDENCE_QUEUE_WARNING

    def run(self):
        import av
        from collections import deque
        from fractions import Fraction
        import logging
        import queue
        import uuid
        container = stream = None
        clip = None
        start = last = last_written = 0
        clip_revision = 0
        video_writer_error = ""
        video_retry_after = 0.0
        video_failures = 0
        pre_roll = deque()
        pre_roll_context = None
        storage_gate = EvidenceStorageGate(self.store)
        storage_full = storage_gate.blocked
        self.store.evidence_pause_changed(self.camera, self.session, storage_gate.reason)

        def finish():
            nonlocal container, clip, storage_full
            if container is not None:
                for packet in stream.encode():
                    container.mux(packet)
                container.close()
                self.store.clip_finished(clip, max(1 / self.fps, last_written - start))
                container = None
                clip = None
                self.current_clip = None
                self.evidence_fps = None
                self._recent_encoded_media_times.clear()
                storage_full = storage_gate.refresh(force=True)

        def write_frame(frame, media_time):
            nonlocal last_written
            video = av.VideoFrame.from_ndarray(frame, format="bgr24")
            video.pts = round((media_time - start) * 90000)
            video.time_base = Fraction(1, 90000)
            for packet in stream.encode(video):
                container.mux(packet)
            last_written = media_time
            if (self._recent_encoded_media_times
                    and media_time <= self._recent_encoded_media_times[-1]):
                self._recent_encoded_media_times.clear()
            self._recent_encoded_media_times.append(media_time)
            self.evidence_fps = measured_evidence_fps(self._recent_encoded_media_times)

        def fail_video_writer(error):
            nonlocal container, stream, clip, video_writer_error, video_retry_after, video_failures
            import logging
            logger = logging.getLogger("flowsense.evidence")
            logger.exception("Camera evidence encoder failed", exc_info=error)
            if container is not None:
                try:
                    container.close()
                except Exception:
                    logger.warning("Could not close the failed camera evidence container.", exc_info=True)
            if clip is not None:
                self.store.clip_failed(clip, last_written - start)
            container = stream = clip = None
            self.current_clip = None
            pre_roll.clear()
            video_failures += 1
            video_retry_after = time.monotonic() + EVIDENCE_WRITER_RETRY_SECONDS * min(8, 2 ** (video_failures - 1))
            video_writer_error = "Video evidence paused: the MP4 writer failed and will retry automatically."
            self.error = video_writer_error

        try:
            while not self.stop.is_set() or not self.queue.empty():
                try:
                    frame, metrics = self.queue.get(timeout=.1)
                except queue.Empty:
                    if self.restart_requested.is_set() and container is None:
                        pre_roll.clear()
                        self.restart_drained.set()
                    continue
                if self.error == EVIDENCE_QUEUE_WARNING and self.queue.qsize() < 8:
                    self.error = ""
                last = metrics["media_time_seconds"]
                revision = metrics.get("analysis_zone", {}).get("revision", 0)
                context = (metrics.get("generation"), revision)
                if pre_roll_context != context or (pre_roll and last < pre_roll[-1][1]["media_time_seconds"]):
                    pre_roll.clear()
                pre_roll_context = context
                while pre_roll and last - pre_roll[0][1]["media_time_seconds"] > EVIDENCE_PREROLL_SECONDS:
                    pre_roll.popleft()
                observed = metrics.get("observed_detections", metrics["detections"])
                ids = {(metrics["generation"], box["id"]) for box in observed}
                crossed = {(metrics["generation"], box["id"]) for box in observed if box.get("counted")}
                try:
                    storage_full = storage_gate.refresh()
                    if storage_full:
                        # Finalize an open MP4 immediately at the configured
                        # capacity boundary; the observation path stays alive.
                        if container is not None:
                            finish()
                    elif container is not None and (last - start >= 10 or last < start or clip_revision != revision):
                        finish()
                    if (ids and container is None and not storage_full and self.store.record_video
                            and not self.restart_requested.is_set()
                            and time.monotonic() >= video_retry_after):
                        buffered = list(pre_roll)
                        clip = uuid.uuid4().hex
                        clip_revision = revision
                        start = buffered[0][1]["media_time_seconds"] if buffered else last
                        container = av.open(str(self.store.clips / f"{clip}.mp4"), "w", options={"movflags": "+faststart"})
                        stream = container.add_stream("libx264", rate=round(self.fps))
                        stream.width, stream.height = frame.shape[1] // 2 * 2, frame.shape[0] // 2 * 2
                        stream.pix_fmt = "yuv420p"
                        # Keep full-resolution clips. Recorded frame cadence adapts
                        # only under queue pressure; live video and analysis continue
                        # at their own rates. A representative night clip measured
                        # about 47% smaller than ultrafast at the same CRF.
                        free_disk_bytes = shutil.disk_usage(self.store.clips).free
                        encoding_crf = evidence_h264_crf(self.store._video_bytes(), self.store.max_video_bytes,
                            free_disk_bytes, self.store.min_free_bytes)
                        stream.options = {"preset": EVIDENCE_H264_PRESET, "crf": str(encoding_crf)}
                        start_metrics = buffered[0][1] if buffered else metrics
                        self.store.clip_started(clip, self.camera, self.session, start,
                            revision, start_metrics.get("observed_at"), start_metrics.get("generation"),
                            start_metrics.get("sequence"))
                        self.current_clip = clip
                        self._recent_encoded_media_times.clear()
                        self.evidence_fps = None
                        pre_roll.clear()
                        for prior_frame, prior_metrics in buffered:
                            write_frame(prior_frame, prior_metrics["media_time_seconds"])
                        video_writer_error = ""
                        video_failures = 0
                        video_retry_after = 0.0
                    if container is not None:
                        write_frame(frame, last)
                    elif self.store.record_video and not storage_full:
                        pre_roll.append((frame, metrics))
                    if self.restart_requested.is_set():
                        pre_roll.clear()
                        if container is not None and last_written - start >= MIN_PLAYABLE_CLIP_SECONDS:
                            finish()
                        if container is None:
                            self.restart_drained.set()
                except Exception as error:
                    fail_video_writer(error)
                pause_reason = storage_gate.reason if storage_full else video_writer_error
                if self.restart_requested.is_set() and not pause_reason:
                    pause_reason = RESTART_DRAIN_PAUSE_REASON
                self.store.evidence_pause_changed(self.camera, self.session, pause_reason,
                                                  metrics.get("observed_at"))
                if storage_full:
                    self.error = storage_gate.reason
                elif video_writer_error:
                    self.error = video_writer_error
                elif self.error.startswith("Video evidence paused:"):
                    self.error = ""
        except Exception:
            self.error = "Could not save camera observations or video evidence."
            try:
                self.store.evidence_pause_changed(self.camera, self.session,
                    "Video evidence paused: the recorder stopped after an unexpected persistence error.")
            except Exception:
                pass
            logging.getLogger("flowsense.evidence").exception(self.error)
        finally:
            try:
                finish()
            except Exception as error:
                self.error = "Could not finalize video evidence."
                try:
                    self.store.clip_failed(clip, last_written - start)
                    self.store.evidence_pause_changed(self.camera, self.session,
                        "Video evidence paused: the MP4 container could not be finalized.")
                except Exception:
                    pass

    def _save_observations(self):
        import logging
        import queue
        while not self.observation_stop.is_set() or not self.observation_queue.empty():
            try:
                metrics, clip = self.observation_queue.get(timeout=.1)
            except queue.Empty:
                continue
            try:
                self.store.save(self.camera, self.session, metrics.get("model", self.model), metrics, clip)
                if self.observation_queue.qsize() < 20:
                    self.observation_error = ""
            except Exception:
                self.observation_error = OBSERVATION_QUEUE_WARNING
                logging.getLogger("flowsense.evidence").exception(
                    "Could not save camera analysis observations")
            finally:
                self.observation_queue.task_done()

    def close(self):
        self.stop.set()
        self.thread.join(10)
        self.observation_stop.set()
        self.observation_thread.join(10)

    @property
    def status_error(self):
        return self.observation_error or self.error
