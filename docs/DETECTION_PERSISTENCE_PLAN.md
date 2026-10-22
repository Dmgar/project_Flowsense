# Continuous detection and durable observations

The current detector/tracker and directional calibration supersede the YOLO26s
configuration below. See [approaching-road tracking](DIRECTIONAL_TRACKING.md).

## Acceptance criteria

1. Compare the current detector with an official newer model on identical real
   night-camera inputs. Enable a replacement only after inspecting its output.
2. Keep video moving independently of inference. Use two confidence levels:
   reliable observations start tracks; weaker spatially consistent observations
   can maintain an existing track. Do not require every update to exceed the
   initial classification threshold.
3. Save observed tracks and timestamped samples in SQLite, including camera,
   session, class, confidence, source media time and model identity. IDs are
   unique within a session, not identities across cameras or restarts.
4. Save bounded video evidence for detected objects and expose history/replay in
   the camera page. Never substitute still images for the live video.
5. Reload the application and verify saved observations remain accessible.
   Distinguish unique track counts from instantaneous occupancy and actual flow.
6. Identify street-data provenance. No camera coverage means unavailable observed
   traffic, not a measured empty street. Do not derive calibrated speed,
   congestion or incidents automatically from an uncalibrated vehicle count.

## Validation

Run regression checks for temporal association, duplicate events, persistence
after reopening SQLite, evidence replay, and API validation. Exercise the actual
public video, inspect boxes on matching video frames and verify saved data using
the history API. Report accuracy limits separately from successful storage and
transport checks.

## Implemented locally

- Video inference now uses the official YOLO26s model, exported to ONNX with a
  640-pixel input and the conventional 84-channel detection output. OpenCV runs
  inference; Torch/Ultralytics are confined to an isolated export environment.
  The export recipe and SHA-256 are in `scripts/prepare_video_model.py` and
  `models/video-model.json`.
- The tracker prioritizes stronger matches, starts IDs at 30%, and allows weaker
  matching predictions (down to the detector's 10% candidate floor) to maintain
  an established ID. A decaying track score controls display; the label still
  exposes the current model score. Weak unmatched candidates cannot start IDs.
- Detail crops preserve small-object pixels and reject truncated internal-edge
  detections. Interpolation, bounded optical flow and independent video capture
  remain enabled. A stronger first observation need not wait for two hits.
- `data/processed/video_<city>/observations.sqlite3` stores timestamped samples
  and session-scoped tracks. Writes are idempotent per sample and use SQLite
  transactions. The server capture timestamp is distinct from provider time.
- A bounded worker queue encodes short H.264 MP4 evidence segments. Recording
  starts on displayed detections and finishes a segment within approximately
  ten seconds, or at session close. Ready clips support browser playback and
  range requests. At a 2 GB video cap, metadata saving continues and the UI
  reports that video storage is full. No history is silently deleted.
- The camera page lists saved tracks, scores and model identity, supports recent
  JSON export, and plays finalized evidence clips. Data survives page reloads
  and backend restarts. Analysis runs while the camera player is connected;
  this change does not start all catalog cameras in the background.
- Graph GeoJSON explicitly separates routing inputs from saved camera tracks.
  Simulator updates are marked `simulation`; missing inputs are `unavailable`.
  Camera counts are not automatically mapped to road congestion or speed.

## Reproduce model setup

```powershell
python -m venv .venv-model-tools
.\.venv-model-tools\Scripts\python.exe -m pip install -r requirements-model-tools.txt
.\.venv-model-tools\Scripts\python.exe scripts/prepare_video_model.py
```

`scripts/run_flowsense.ps1` prepares the model when it is missing. The video model
can be configured with `VIDEO_MODEL_PATH`; the older perception API retains its
separate `PERCEPTION_MODEL_PATH`. See the official
[YOLO26 documentation](https://docs.ultralytics.com/models/yolo26/) and
[tracking confidence documentation](https://docs.ultralytics.com/modes/track).
The implementation uses a confidence-prioritized version of the existing
tracker; it does not claim to include the full ByteTrack Kalman implementation.

## Verified results and remaining limits

On the same I-110 / 1st St live night source, a 45-second actual-model check
produced car and truck classifications, with up to five simultaneous displayed
objects. Of 220 sampled status readings, 206 contained analysis and 39 contained
visible detections. Empty readings do not demonstrate an empty road. This is a
functional detection check, not human-labeled precision/recall.

A subsequent live server check found 87 saved session tracks (79 classified as
car, 7 as truck and 1 as bus), including prior local runs. These are model labels,
not independently confirmed vehicle identities. Twelve finalized evidence clips
were available; a clip returned HTTP 200 / `video/mp4` and decoded in the browser
at 1280 pixels wide with advancing playback time. Reopening the database in a
separate Python process returned the same totals as the API. These numbers are a
point-in-time verification, not fixed demo data.

Regression validation: 131 backend tests, 35 frontend tests, production build and
frontend lint. Coverage includes weak-hit recovery without new weak IDs,
duplicate-write suppression, reopened-database persistence, real H.264 encoding
with changing decoded images, and history/clip API validation.

Night glare, occlusion and tiny objects still cause misses and incorrect labels.
Unique session IDs can fragment or count the same physical vehicle again after
reconnection. Lane-specific flow and speed require separate calibration and
crossing rules. A crash can lose the unfinished MP4 tail; finalized clips and
committed SQLite rows remain durable. No synthetic detection records are injected
into the live observation history to make the detector appear successful.
