# Continuous video and vehicle tracking

Implemented and verified locally on October 20, 2026 (America/Bogota).

The current implementation supersedes the no-recording policy below: it uses
YOLO26s and saves track observations plus short H.264 evidence clips. See
[current detection and persistence implementation](DETECTION_PERSISTENCE_PLAN.md).

Detection was subsequently corrected with detail crops, class-aware filtering and
an aligned 0.6-second processing buffer. See [detection corrections](DETECTION_CORRECTIONS.md).
The transport benchmarks below describe the earlier single-pass detector and are
historical; their latency figures do not describe the corrected buffered detector.

## What changed

Camera detail, the observation desk and opt-in camera previews now display real
WebRTC video with vehicle detection and tracking drawn onto the outgoing media.
They do not poll JPEGs, use MJPEG as browser playback, or return to photos when a
source fails. Preview playback is limited to one selected preview at a time and
stops when scrolled away. Hidden tabs release video subscriptions.

The camera catalog and maps request video-capable sources only. The stored catalog
currently has 86 registrations, of which 71 have video links; this does not certify
71 working streams. Image-only records and legacy observation endpoints remain
available internally for compatibility with existing evidence and cases.

Connected sources must decode consecutive video frames before registration.
JPEG/PNG still-image connections are rejected. RTSP, HTTP video/HLS and webcams
use the persistent video path. Recorded inputs are labeled as recorded playback,
paced and stopped at end-of-file, rather than substituted for unavailable cameras.

All new UI text, validation messages and controls are English. Camera pages now
identify themselves as camera video even when other modules use presentation mode.

## Runtime design

- One native capture and compositor per active camera. A separate inference thread
  reads only the most recent image. One shared detector lock protects model access.
- Latest-only input, analysis and output slots prevent a growing work queue. The
  output limit is 30 FPS; lower-rate sources retain their own frame rate.
- Both HLS and files are paced using the reported source FPS. This matters because
  HLS decoding can otherwise consume an entire segment in a short burst and look
  like periodically changing photos. Outgoing timestamps are monotonic.
- Inference uses the installed YOLO ONNX model. The existing tracker assigns IDs;
  sparse optical flow moves boxes from the actual inference image to the current
  displayed image. Analysis older than one second expires. Reconnection resets
  tracking rather than applying boxes from a different source generation.
- Boxes, IDs and primary counts are rendered into the same encoded video. Class
  and confidence settings apply to both boxes and counts and are shared by viewers
  of that camera. The sidebar is explicitly latest telemetry, with sample age;
  it can lead browser playback and is not presented as exact playout synchronization.
- Playback pause, loss of advancement, source outages and inference failures clear
  live sidebar counts. Detection failures allow otherwise available video to play
  with unavailable counts. Live sources retry automatically with exponential
  backoff capped at 30 seconds; sustained healthy playback resets the retry
  counter. Recorded files stop at end-of-file and do not retry as live feeds.
  Session status exposes the reconnect attempt and the next retry delay.
- Four camera sessions and twelve viewer connections are admitted at most. Closing
  native captures retain their capacity slot until cleanup finishes. Source open
  and read timeouts are bounded; native read cleanup may take up to its timeout.
- Explicit leave, peer failure, heartbeat expiry, idle cleanup and application
  shutdown reclaim sessions. The idle grace period is three seconds. Viewer status
  polling refreshes a heartbeat; an abandoned viewer expires after about 35–45 seconds.
- The legacy perception start endpoint now schedules processing instead of merely
  registering an idle pipeline. Stop and shutdown cancel and await those tasks.

Browser video uses aiortc/PyAV with local ICE candidates. No separate FFmpeg
executable is needed by this runtime path. Remote deployment requires an appropriate
ICE/STUN/TURN configuration and network testing; it is not validated by local tests.

## Evidence and review

The photo timeline and `Save frame` action were removed from active camera viewing.
`Export session metadata` provides session ID, media time, source generation,
sequence, current analysis and diagnostics. `Open evidence review` records a manual
review with session ID and media time. These fields survive case storage and CSV
export. Existing cases retain their original image evidence references.

The active monitoring recorder saves timestamped track observations in SQLite and
short, replayable H.264 MP4 segments while tracks are visible. Segments retain the
source frame dimensions. They normally retain the source cadence; if the bounded
encoder queue grows, only recorded-video sampling steps down to 12, 8, then 6 FPS
to let the writer catch up. Live playback and detector cadence remain independent.
The live detection panel also reports model candidate observations by class outside
the enabled inbound zone over the same rolling window; these candidates remain
excluded from tracking and passage counts so operators can diagnose lane boundaries
without treating opposing traffic as measured flow.
The saved camera history exposes `candidate_tracks` separately from confirmed class
totals. It aggregates unique, unreviewed tracks whose saved class remains `vehicle`
but whose temporal classifier suggests a specific class. The UI labels these as
suggestions and removes each from the pending tally after operator review. Older
running APIs provide a preview from the latest 500 events until restarted; the
full current-zone aggregate requires the updated API process.

Runtime checks on October 21, 2026, confirmed the active camera API had not loaded
the aggregate implementation. A read-only query through the current source found
1,366 pending car suggestions and 5 pending truck suggestions in I-110 road-zone
revision 2. The API process still returns only the latest 500 tracks and omits
`candidate_tracks`; the browser preview consequently showed 16 car suggestions.
The aggregate is implemented and regression-tested. The local launcher now detects
this process/source mismatch and warns that a restart is needed, including the
number of clips currently recording. It does not restart the API automatically.
Keep the recorder running until its session can be closed cleanly; a forced process
stop could leave the current MP4 incomplete.
Video review keeps the three newest unconfirmed detections visible and places up to
nine additional detections from the latest playable clips in a collapsed review list.
Each item seeks its saved MP4 evidence and accepts an operator label without
overwriting the original model prediction.
The queue stays bounded and still reports if it must skip a frame. New clips use
x264 `veryfast` at CRF 28 below 85% quota use, CRF 31 from 85%, and CRF 34 from
95%. This increases compression only for stored evidence; live video and
inference keep their source resolution and cadence. A representative existing
10-second clip was 42% smaller when recoded at CRF 34 than at CRF 28. This is a
single-clip storage comparison, not a ground-truth scene quality metric. The
earlier codec comparison found `veryfast` at CRF 28 was 47.2% smaller than
`ultrafast` at the same CRF, with 150/150 frames preserved and mean PSNR 37.15 dB
against the already compressed source. Existing clips are not rewritten. Recording stops at the configured
6 GB default clip cap or when free disk space reaches the 1 GB reserve; SQLite observations
continue to be saved when video recording is capped. After an unclean shutdown,
unfinished MP4s are retained and marked interrupted on the next startup; the UI
does not present them as playable or as active recordings.

Deployments can set `VIDEO_EVIDENCE_MAX_BYTES` and `VIDEO_EVIDENCE_MIN_FREE_BYTES`
to configure the clip quota and minimum free-disk reserve. The defaults are 6 GB
and 1 GB. The recorder pauses at either limit, resumes automatically when space
returns, and never deletes clips or observations to make room.

When the operating-system volume is below the free-space reserve, changing clip
compression or sampling cannot safely resume MP4 recording. Attach or mount a
separate volume, then set `VIDEO_EVIDENCE_DIR` to a directory on that volume and
raise `VIDEO_EVIDENCE_MAX_BYTES` only to a quota that fits its available space.
Keep `VIDEO_EVIDENCE_MIN_FREE_BYTES` as the safety margin for that volume. Set
these environment variables before starting the API with `scripts/run_flowsense.ps1`.
The SQLite observation database stays in the configured data directory; new clips
use the external directory, and clips already in the local `data/clips` directory
remain readable and count toward the combined quota. The recorder does not move
or delete existing evidence. Verify `external_clip_storage`, free space, quota,
and a newly playable clip in the camera evidence panel after startup.

Speed and lane occupancy remain uncalibrated, and instantaneous counts are not
cumulative traffic flow.

The per-minute crossing timeline carries saved video-sample coverage. Minutes
with observed video and no counted crossings remain zero; minutes without saved
video are shown as unknown gaps, not as empty roads.

The camera summary reports how many counted track IDs were observed for less than
two seconds. This is a review cue for possible brief visibility or fragmented
tracking; it is not an automatic false-positive label.

## Verification results

Automated checks:

- Backend: **184 passed** (`python -m pytest tests/ -q`).
- Frontend: **35 passed** (`npm test`).
- Production frontend build and lint passed.
- New behavior tests cover actual encoded WebRTC reception by two viewers sharing
  one capture; moving boxes; slow/failed inference; still-image rejection; segment
  pacing; source reconnection; stale analysis; admission limits; malformed offers;
  replacement-session cleanup; video-only discovery; session review metadata; and
  actual scheduling/cancellation of the legacy perception endpoint.

Two five-minute tests used a synthetic 1280 × 720, 25 FPS file with the installed
YOLO model and real encoded WebRTC delivery to aiortc receivers:

| Concurrent sessions | Received FPS per camera | Largest delivery gap | Approximate local decoded-frame lag, p95 |
| --- | --- | --- | --- |
| 1 | 24.87 | 0.182 s | 0.08 s |
| 4 | 14.49–14.51 | 0.287 s | 0.32–0.36 s |

Neither run had a timestamp regression. The four-session run maintained continuous
video but did **not** maintain 25 received FPS per camera at 720p. Its server outputs
were about 25 FPS while downstream encoded reception was about 14.5 FPS. Browser
controls now distinguish measured rendered FPS from server output FPS instead of
claiming that a server processing rate is the user's delivered frame rate.

These are workstation measurements, not guaranteed service levels. The lag estimate
uses a source sequence embedded into the synthetic video. It is not a measurement
of public-provider delay or browser painting. Synthetic rectangles do not validate
vehicle detection accuracy.

Real browser verification used Caltrans `caltrans-d7-cctv-1031`, I-110 / 1st St:

- Actual advancing 1280 × 720 video, approximately 15 rendered FPS, matching the
  source's reported 15 FPS. The installed detector produced real vehicle boxes.
- Pause/resume, reconnect, confidence adjustment and video-session review opened
  correctly. Pausing removed live counts and the `Live` label.
- The observation desk played the same source as a video session with tracking.
- Camera detail contained zero image elements; its 640-pixel browser view had no
  horizontal overflow. Map tiles and icons elsewhere remain normal map assets.
- Visual evidence is saved locally at `output/continuous-video/live-camera.png`.
  The confidence threshold was lowered to 20% during this visual check. The default
  is 35%; night glare and image quality limit detection accuracy.

Public video availability is verified for that session, not the entire catalog.
Four simultaneous public cameras in the browser, variable-frame-rate file timing,
occlusion accuracy metrics and remote network deployment remain unverified.

## Run and reproduce

On Windows, use the existing launcher:

```powershell
.\scripts\run_flowsense.ps1 -Setup
.\scripts\run_flowsense.ps1
```

Open [the camera catalog](http://127.0.0.1:3002/cameras). The Los Angeles API uses port 8004. For an existing environment,
`-Setup` installs aiortc/PyAV in addition to the existing dependencies. The launcher
now reports missing continuous-video dependencies directly.

To reproduce the capacity measurements from the repository root:

```powershell
.\.venv\Scripts\python.exe -m scripts.verify_continuous_video --seconds 300 --cameras 1
.\.venv\Scripts\python.exe -m scripts.verify_continuous_video --seconds 300 --cameras 4
```

The script generates an explicitly synthetic local fixture and writes machine-readable
reports under `output/continuous-video/`. The generated video, screenshots and reports
are local ignored artifacts. They are not public-camera recordings.

## Main implementation files

- `src/services/video_service.py`: shared capture, inference, composition, WebRTC
  tracks, viewer lifecycle and admission.
- `src/api/routes/video.py`: offer/answer, viewer heartbeat/status, shared filters
  and explicit leave endpoints.
- `frontend/src/product/LiveCameraPlayer.tsx`: media playback, recovery, measured
  rendered FPS, controls and analysis settings.
- `frontend/src/product/CameraEvidence.tsx`, `ObservationDesk.tsx`: video-only
  camera surfaces and session review.
- `tests/test_continuous_video.py`, `scripts/verify_continuous_video.py`: behavior
  checks and reproducible transport measurements.

## Encoded evidence cadence (2026-10-21)

The camera panel now reports MP4 encoder FPS measured from source timestamps of
frames successfully written to the current clip. This is distinct from the
sampling ceiling selected by the recorder and from the browser's live rendered
FPS. A newly resumed 1280x720 clip contained 75 decodable frames over 9.87
seconds (7.55 FPS), while the previous panel displayed the 12 FPS sampling cap.
The evidence-frame policy version is now 2 so the launcher can identify a
runtime that still reports the cap as if it were the written cadence. Encoded
FPS is unavailable when no clip is actively being written.

## Near-quota video retention (2026-10-21)

A fresh camera summary showed 5.75 GB of a 6 GB clip quota in use. In the
preceding 15-minute window, only 57% of counted crossings linked to a playable
clip, while multiple evidence pauses had occurred near the disk safety reserve.
To retain more future motion evidence without deleting saved clips, the recorder
now lowers the evidence cadence to 10 FPS at 75% quota and 6 FPS at 90%, and
uses H.264 CRF 37 at the 90% threshold (or when disk headroom approaches the
reserve). Live playback and detection cadence remain independent.

A temporary re-encode of one real 1280x720, 75-frame camera clip reduced its
size from 747,568 bytes at the current CRF 34 to 511,923 bytes at CRF 37 (31.5%
smaller); PSNR against the already-compressed source was 30.32 dB. This is a
single-clip storage comparison, not a ground-truth visual-quality evaluation.
The evidence-frame policy version is now 3 so the launcher identifies runtimes
that have not loaded the new near-quota behavior. Existing clips are untouched.

## Detection clip context (2026-10-21)

Detection-triggered MP4 clips now retain up to one second of sampled video before
the first observed track, increased from half a second. This gives reviewers more
approach context when the model first detects a vehicle after it enters the frame.
The additional context uses the existing clip quota and does not alter live video,
inference cadence, saved clips, or the ten-second segment limit. Evidence-frame
policy version 4 lets the launcher distinguish runtimes with the updated pre-roll.

## WebRTC missing-track recovery

The browser frame watchdog starts with the visible camera view, before the HTML
video element is playing. It checks media-track delivery independently from the
element's paused state, so a connection that never delivers a track retries
instead of waiting indefinitely in `Connecting`. Autoplay rejection is tracked
separately: with no track, recovery continues; with a delivered track, the UI
waits for the user's play gesture instead of reconnecting repeatedly. A deliberate
user pause and a hidden page suspend the watchdog.
