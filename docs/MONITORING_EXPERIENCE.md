# Continuous monitoring, passage history and observed road conditions

This document supersedes the display and recording defaults in the earlier
continuous-video and directional-tracking delivery notes. Project content is English.

## Delivered behavior

- Continuous video stays independent of inference. OpenCV runs YOLOv8s in standard
  light and BDD100K YOLO11n in low light, with occasional high-resolution detail
  inference on CUDA. ByteTrack associates road users across observations.
- Clear classes require repeated model evidence, with stricter confirmation in low
  light. Early class hints can appear as `Car? #ID`; history keeps the object as
  `Vehicle` until its type is confirmed. Bus and truck labels require stronger
  evidence so compressed night footage does not force a heavy-vehicle label.
- The main video has short labels and an unobtrusive inbound-monitoring badge.
  The polygon, direction arrow and counting line appear only in **Edit road zone**.
  The editor uses muted green and gold rather than a large cyan overlay.
- **Monitoring history** replaces the raw saved-detection panel and instantaneous
  class table. It shows cumulative passages, class totals and interactive minute bins.
  A vehicle contributes one passage when its tracked bottom-center crosses the
  horizontal counting line downward, inside the inbound polygon, with confirmed
  incoming motion. The current preset is specific to camera 1031's approaching road.
- Display filters do not change persisted measurements. Pending types count as
  passages and can subsequently be promoted to a specific class without a second count.
- The live pipeline diagnostic separates model candidates from road-zone hits. When
  candidates fall outside the inbound polygon, it reports their preliminary classes
  and recent-frame count. The zone editor overlays the latest inference frame's
  outside-zone candidates with dashed gold boxes so operators can inspect alignment
  without counting opposing-lane traffic as inbound. These provisional boxes are not
  persisted tracks or vehicle counts.
- Recent counted clips can be reviewed by an operator as a car, truck, bus, motorcycle,
  bicycle, person, unclear vehicle or false positive. Reviews are stored separately
  from model output, so the original observation and human label remain comparable.
  The agreement indicator describes only reviewed examples; it is not an unbiased
  precision estimate or automatic model retraining.
- The application tab retains its history start time across reloads. Totals cover
  crossings since that time for the current analysis-zone revision. Changing the zone
  starts a new measurement profile; old records remain in SQLite and the history API.
- Visiting a camera starts background monitoring in the app (up to four sources).
  Switching to the map keeps capture and inference active without a video viewer.
  A 15-second browser heartbeat renews a 60-second monitoring lease. Pausing background
  monitoring is remembered for the tab session; closing the app lets leases expire.
  Source failures, sleeping computers and closed apps produce gaps, not invented counts.

## Persistence and API

SQLite stores samples, track identities, class evidence, direction, zone revisions,
crossing timestamps and directional OSM associations. The Los Angeles database is
`data/processed/video_los_angeles/observations.sqlite3`.

- `GET /api/v1/mobility/video/cameras/{id}/summary?since=<timezone-aware ISO timestamp>`
- `POST /api/v1/mobility/video/cameras/{id}/monitoring` with `client_id`
- `DELETE /api/v1/mobility/video/cameras/{id}/monitoring/{client_id}`
- `PUT /api/v1/mobility/video/cameras/{id}/tracks/{session}/{generation}/{track}/feedback`
- `GET /api/v1/mobility/video/road-observations`

Operator labels are stored in the local `track_feedback` table and are returned with
history events. They do not rewrite track classes, counts, clips or traffic estimates.

The raw history and existing clip endpoints remain available. Automatic metadata
and detection-triggered short H.264 MP4 recording are enabled by default through
`VIDEO_RECORD_EVIDENCE=True`. Recording stops at the configured clip limit (6 GB by
default) or when free disk space falls below the 1 GB reserve; observation metadata continues to save.
Set `VIDEO_RECORD_EVIDENCE=False` to keep metadata only. Existing clips are preserved.

## Connection to roads

Association requires a matching catalog route, compatible cardinal direction and
an OSM motorway/trunk/primary segment within 200 meters. It does not select an
unrelated nearby road. Camera 1031 resolves to Harbor Freeway / I-110 Southbound.
Camera links are grouped by directed OSM segment before rendering, so overlapping
camera associations produce one road line. The map reports linked, active and usable
camera counts; a strict majority is needed when active camera estimates disagree.
Tied views remain unknown and are labeled as conflicting rather than being silently
overwritten by whichever camera happened to render last.

Fresh observations provide a local estimate from tracked movement and image coverage
over the previous minute: moving, slowing or possible queue. At least eight samples,
a sample no older than five seconds, and at least 8% mean image coverage are required
before assigning a road-condition level. Sparse detections are reported as movement
observed with sparse coverage and remain uncolored on the map. The map tooltip still
shows their sample count and measured image coverage so operators can distinguish weak
evidence from missing observations. Stale/missing data is unknown.
The observed map colors only the associated segment, with an explanatory tooltip.
Unobserved roads remain gray. These estimates do not change routing weights.

Image coverage is not calibrated road occupancy; apparent movement is not measured
km/h. The condition thresholds are transparent heuristics, not validated congestion
or travel-time estimates. See the distinction between traffic measures in the
[FHWA congestion guidance](https://ops.fhwa.dot.gov/congestion_report/appendixa.htm).

## Verification on October 20, 2026

- Backend: 145 tests passed, including durable one-crossing counting, two-hit car
  classification, stale-condition expiry, route/direction association, background
  monitoring without viewers, class promotion without duplicate passages, separate
  pedestrian records and summary-window validation.
- Frontend: production build, ESLint and 35 existing tests passed.
- A 45-second real-source run produced 220 samples, 201 with visible tracked detections,
  up to 11 simultaneous boxes, zero boxes outside the configured polygon, zero
  wrong-direction flags and zero stable-class flips. The earlier run had visible
  detections in 28 of 219 samples. The live intervals differ; this compares output
  continuity, not detector recall or classification accuracy.
- Two-pass ROI inference averaged 0.238 seconds on the same 12 source images versus
  0.489 seconds for the previous four-pass pipeline on this machine.
- Live browser checks confirmed advancing video, cumulative persisted passages,
  selectable minute bars and the directional road association.

Diagnostic artifacts are under `output/detection-audit/`, including
`live-detection.json` and `live-detection-annotated.png`.

## Remaining measurement limits

Small, overlapping or blurred cars can still be missed. Pending types are retained
honestly, and buses/trucks are not guaranteed to be perfectly distinguished. A
fragmented identity can overcount; a missed crossing can undercount. No human-labeled
precision/recall benchmark or calibrated speed study has been performed. The counter
starts when observation begins and does not reconstruct earlier traffic from video.
Other cameras need their own inbound polygon, direction and counting-line validation.
