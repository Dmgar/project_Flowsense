# Approaching-road tracking and vehicle-type stability

## Current implementation

Python and OpenCV remain responsible for video decoding, ONNX detection, image
geometry, optical flow and annotation. The live camera now uses YOLOv8s with
Roboflow `trackers==2.6.1` ByteTrack: Kalman motion prediction, optimal assignment
and high/low-confidence association. This replaces the earlier custom greedy
tracker for video sessions. It does not add cloud inference or image polling.

The I-110 / 1st St preset is a normalized polygon around the approaching
carriageway. Detections must have their bottom-center road-contact anchor inside
that polygon. A track must demonstrate motion along the configured forward vector
before it is displayed or saved. The opposite carriageway is outside the preset;
opposing motion inside a polygon is also excluded. Initially stationary objects
cannot establish direction until they move. This can intentionally omit vehicles.

Use **Edit road zone** in the live player to redraw the polygon and select travel
direction on the actual moving video. Changes persist in SQLite and start a new
analysis generation/revision. Camera movement or a changed view requires a new
zone; the preset is not a calibration for other cameras.

An uncalibrated camera starts the editor with an empty polygon. Its first save is
disabled until the operator draws the inbound carriageway, selects its travel
direction on moving video, and enables the zone. This prevents the default
full-frame placeholder and downward direction from being saved as road geometry.
The editor can now suggest a direction from recent track trails that fall inside
the operator-drawn polygon. It requires at least three moving tracks and 65%
direction agreement within 30 degrees, draws the suggested arrow on the live
video, and leaves the operator responsible for reviewing and saving it. Opposing
flow, pedestrian tracks, stationary objects, or sparse evidence produce no
suggestion; the manual direction tool remains available. This assists direction
selection but does not discover the road polygon or prove which carriageway is
inbound. The browser reconstructs short trails from successive live track IDs
and box coordinates when the server does not provide trails, and clears them on
session or analysis-generation changes. These temporary UI trails are not saved
as traffic observations. For an already calibrated camera, the editor compares
the proposal with its saved vector and reports their angular difference. A large
difference is highlighted and calls out that saving starts a new analysis
revision, so a strong majority of tracks cannot silently replace the existing
road direction.
At the 2026-10-21 coverage check, 71 Caltrans video sources had route/direction
metadata, but only camera 1031 had a reviewed zone. The other 70 remain
unavailable for directional road estimates until individually calibrated; the
coverage queue prioritizes video feeds that were previously verified.

Car, bus and truck detections share a tracking group. A detector label change
therefore does not itself create another ID. Separate semantic groups prevent
pedestrians/bicycles from inheriting vehicle IDs. Class scores are averaged across
overlapping model views and accumulated across observations. A specific car label
requires at least three consistent observations, adequate score/margin and 72%
relative support. Bus/truck labels use a stricter score/margin. A published specific
label is held against isolated contradictory detections. The classifier keeps
collecting evidence after locking and corrects the track when at least five of
its last six detector observations strongly support another class. Uncertainty
is displayed as **vehicle ?**, not forced into car, bus or truck. This reduces
flicker and allows correction of a wrong initial label, but does not guarantee
semantic accuracy.

The live HUD, history and JSON distinguish uncertain types. Trails show motion;
the cyan polygon and arrow show analysis scope. Saved tracks can be promoted from
vehicle to a specific type without incrementing the unique-track total. Earlier
unrestricted records remain stored, but are excluded from current-zone totals by
default. **Include earlier analysis zones** makes them available explicitly.

Evidence recordings are split when zone revision changes. The default video cap
is 6 GB with a 1 GB free-disk reserve; deployments can configure both limits.
Increasing the cap does not delete or rewrite existing evidence. The recorder
still pauses when either the clip quota or free-disk reserve is reached.

## YOLOv8 / YOLO11 paired test

The requested comparison used 240 consecutive unannotated frames (16 seconds) from
this actual camera, sampled every fifth frame. All models used identical input,
zone, thresholds and ByteTrack/class-consensus rules. Results are local in
`output/detection-audit/paired-road-model-comparison.json`.

| Model | Raw in-zone predictions >=30% | Tracked observations | Session IDs | IDs ultimately labeled car |
| --- | ---: | ---: | ---: | ---: |
| YOLOv8s | 482 | 408 | 63 | 25 |
| YOLO11s | 369 | 350 | 51 | 13 |
| YOLO26s | 282 | 280 | 43 | 2 |

These are prediction statistics, not correctly detected physical vehicles or
precision/recall. IDs can fragment. The machine was shared with the live service;
inference timing is not a controlled hardware benchmark. The comparison preceded
the final cross-view averaging of class scores.

Visual inspection of the same timestamp showed YOLO11 calling a small road vehicle
`bus` at 40%, while YOLOv8 called it `truck` at 48%. Neither score passes the new
heavy-vehicle class-consensus floor. Another timestamp showed YOLO26 predicting
truck on a small white vehicle. The production choice is YOLOv8s for its more useful
car detections in this scene, with the zone and conservative temporal labeling;
this is not a claim that YOLOv8 is universally more accurate than YOLO11.

## Verification

- A subsequent 45-second real-source run with the selected YOLOv8s and final
  cross-view scores produced car and uncertain-vehicle tracks, with up to six
  simultaneous objects. It had 219 sampled readings, 178 with analysis and 28
  with visible detections. Fewer observations are expected when the opposite
  carriageway and unconfirmed direction are excluded; this does not prove recall.
- No rendered boxes were outside the configured polygon, no output was admitted
  without the approaching-direction flag, and no stable specific class flipped
  to another specific class during that run. Direction flags are the algorithm's
  result, not independent ground-truth annotations.
- A separate earlier run with YOLO26s showed a red bus becoming `bus` after the
  temporal evidence requirement, while adjacent uncertain vehicles remained
  generic. This is a visual smoke check, not a bus/truck accuracy benchmark.
- Tests exercise actual ByteTrack IDs across raw car/bus changes; ambiguous
  bus/truck evidence; direction rejection using opposing synthetic trajectories;
  bottom-center polygon membership; invalid zone geometry; revision persistence;
  and promotion from uncertain to specific class without double-counting history.

Run `python -m scripts.compare_road_models` after placing an unannotated source
segment at `output/detection-audit/approach-model-input.mp4`. Run
`python -m scripts.verify_live_detection --seconds 45` for the current live preset.
Its diagnostic history/MP4 files are isolated under `output/detection-audit/`.

## Primary technical references

- [Roboflow trackers / ByteTrack](https://github.com/roboflow/trackers)
- [Polygon-zone road-contact anchor](https://supervision.roboflow.com/latest/detection/tools/polygon_zone/)
- [Ultralytics tracking configuration](https://docs.ultralytics.com/modes/track)

The supplied Universidad Distrital PDF URL returned HTTP 403 during retrieval; its
contents were not used or represented as reviewed evidence.
