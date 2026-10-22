# Road-domain detection and continuous nighttime tracking

Verified on October 21, 2026. This supersedes the runtime/model selection in
`NIGHT_DETECTION_DIAGNOSIS.md`; that document remains an earlier diagnostic record.

## What changed

The earlier COCO YOLO11s profile analyzed two views of each dark frame. On this
machine it took about 324 ms per inference call, before an additional fixed
80 ms sleep. Sparse detections and long gaps made identities and annotations
disappear even when vehicles were visible.

Low-light scenes now use **YOLO11n fine-tuned on BDD100K road scenes**, exported
locally to ONNX and executed with OpenCV DNN. The upstream model and its training
description are available in the author's
[model card](https://huggingface.co/dronefreak/bdd100k-yolo11n).

- With an active road zone, inference uses the zone's rectangular crop plus a
  480-by-480 view of its far end. This spends model resolution on the approaching
  carriageway instead of the opposing road. Without an enabled zone, the model
  still receives the full frame. A 960-pixel version and a separate three-class
  model were tested earlier; neither improved tracking continuity enough to
  replace the selected model.
  CLAHE increased standalone box counts but did not improve the paced-video
  continuity check; original pixels remain the selected detector input.
- The analysis loop is capped at 10 Hz instead of adding a fixed 80 ms pause
  after every inference. Continuous source playback remains independent at 15 FPS
  for this camera. Processing more cameras shares available inference capacity.
- The BDD100K class schema is explicit: source IDs 2/3/4 mean car/truck/bus;
  source IDs 6/7 mean motorcycle/bicycle. It is different from COCO. Tensor shape
  validation rejects an incompatible class schema rather than silently changing
  the labels. Non-road targets and the separate rider category are excluded.
- Nighttime car labels normally need three consistent real observations, a
  dominant class share and separation from bus/truck scores. A high-confidence
  exception confirms a car after two observations only when both votes agree,
  mean car score is at least 0.35, car share is at least 0.80, and its lead over
  the next class is at least 0.20. This recovers short distant-car tracks without
  relaxing bus/truck confirmation. Ambiguous evidence remains pending.
- Short model gaps can retain a mature track for at most 0.5 seconds using real
  image features. Forward/backward consistency, feature support, coherent movement
  and agreement with the track's motion reject stationary or inconsistent ghosts.
  No velocity-only extrapolation is allowed for the extended interval. This does
  not create model hits or counting-line crossings.
- ByteTrack ID changes now inherit the prior logical track state for up to 0.75
  seconds when detections overlap. The vehicle keeps its stable displayed ID,
  class evidence, approach state and crossing flag instead of starting a fresh
  count. Unmatched detector candidates remain available for one frame so a car
  first seen before tracker activation still contributes to the night profile's
  three-observation rule.
- Near-identical road-vehicle boxes are consolidated before tracking when at
  least 92% of the smaller box is covered, their centers closely align, and the
  area ratio is no more than 3.25. This targets nested duplicate boxes while
  leaving visibly adjacent cars as separate detections. It is a geometric
  safeguard, not ground-truth proof that every remaining pair is a distinct car.
- The diagnostic API metrics include `analysis_pipeline`: raw candidates,
  candidates inside the road zone, incoming tracks, aligned/confirmed tracks and
  displayed tracks, plus nested duplicate candidates removed. A model miss can
  now be distinguished from a later filter.

## Fresh inbound-crop check

On October 21, 2026, the full-frame and inbound-crop BDD paths were compared on
the same 180-frame nighttime clip, sampling the same 30 frames at 0.4-second
intervals with the same model, road zone and tracker. In-zone model candidates
increased from 55 to 86, inbound track observations from 10 to 21, and samples
with tracks above the configured low-light confidence threshold from 10 to 14.
Peak simultaneous tracks increased from one to three. Mean inference time was
55 ms for the full-frame pass and 96 ms for the inbound crops in the repeatable
run, close to the 100 ms target for the 10 Hz analysis loop. Threshold-eligible
tracks are not independently confirmed detections.

Reproduce the paired comparison with the locally available source clip and
model:

```powershell
.venv/Scripts/python.exe -m scripts.compare_night_road_crops
```

The command writes `output/detection-audit/night-road-crop-comparison.json`.

## Isolated API verification

The current source was also started as an isolated Los Angeles API on port 8003
with a separate temporary `DATA_PROCESSED_DIR`; the existing port 8002 process
and its database were left untouched. A real monitoring request ran against
camera 1031 for about one minute. Its history endpoint returned 39 tracks, all
from `bdd-yolo11n.onnx`, all marked `approaching` in zone revision 2, with 25
counting-line crossings recorded. The final recent-window summary had 1.7% image
coverage and correctly remained `unknown`; low observed coverage is not enough
to establish road congestion or a clear road. The compact API evidence is saved
at `output/detection-audit/night-crop-api-smoke-20261021.json`.

A subsequent 25-second live check using the crop path produced visible tracks
in 87 of 123 status polls, with at most two simultaneous objects. No displayed
box was outside the configured polygon or marked in the wrong direction, and
stable track classes did not flip. The check displayed `car` and uncertain
`vehicle` classes; it did not validate bus or truck recognition. The fixed-clip
comparison is stronger evidence for the crop change; neither check measures
precision or recall because these source frames have no independent labels.

## Camera-specific counting gates

Road-zone calibration also supports a finite, oriented counting segment. Draw
two endpoints across the inbound lanes in the live-video editor; a track counts
only when its observed motion intersects that segment toward the configured
travel direction and passes the existing class-confirmation checks. Reverse
crossings and motion beyond the finite gate endpoints are excluded. This works for angled,
horizontal, and vertical camera views and avoids counting a track that crosses
the infinite extension of a gate outside its endpoints. Existing profiles keep
their stored horizontal `counting_line_y` behavior until an operator draws a
camera-specific segment. Each saved edit still starts a new zone revision, so
historical counts are not silently reinterpreted.

Daytime continues to use the existing YOLOv8s road-crop pipeline. The inbound road
zone, direction checks, unique crossing counter, SQLite history and night-visibility
notice remain active. Measurements are still local camera estimates, not calibrated
road speeds or travel times.

## Same-video, paced comparison

`scripts/verify_tracking_continuity.py` ran the same 12-second source video twice
through native capture, tracking and the actual compositor. Both runs used the
current road zone and tracking/display safeguards. Only detector selection and
resulting processing cadence differed. Each run was warmed before playback.

| Measurement | Previous COCO detector | Selected road detector |
| --- | ---: | ---: |
| Output samples captured | 178 | 179 |
| Samples with displayed detections | 42 | 124 |
| Maximum simultaneous displayed objects | 1 | 4 |
| Measured inference updates/second | 3.1 | 9.6 |
| Measured output FPS | 15.1 | 15.1 |

## Fresh live check after track-continuity repair

On October 21, 2026, `scripts/verify_live_detection.py --seconds 20` inspected
the active `caltrans-d7-cctv-1031` source using the current model, road zone and
tracker. It captured 98 status samples, including 93 distinct analyzed frames;
37 frames had visible detections and the peak was three simultaneous objects.
The current stream produced `car` and uncertain `vehicle` labels. The audit
reported zero boxes outside the configured zone, zero wrong-direction boxes,
zero stable-class changes, and six nested duplicate vehicle boxes removed across
six analyzed frames. An inspected annotated frame showed two adjacent cars
retained as separate tracks.

This is evidence that the nighttime path is active and that its direction,
duplicate-filtering and class-stability checks ran. It does not measure precision
or recall: the source has no manually labeled ground-truth frames, and this
20-second interval did not contain verified buses or trucks. Review the saved
`output/detection-audit/duplicate-suppression-live/live-detection-annotated.png`
and JSON report when assessing this sample.

The polling collector missed one/two of the 180 source frames; it does not repeat
the final frozen frame to inflate the result. Annotated H.264 MP4 replays contain
all 180 original source frames at 15 FPS and use only captured compositor boxes.
The replays were decoded successfully. Source frames without a captured observation
are left unannotated. Specific class labels did not flip in the captured tracks.

These figures measure output continuity, not precision/recall. There is no manually
labeled ground truth for this camera. Blurred, occluded or distant vehicles can
still be missed; identities can fragment and affect counts. Validation concerns
camera 1031. Full-catalog accuracy and four-camera throughput were not measured.

## Verification and artifacts

- Full backend suite: 163 passed.
- Frontend production build, lint and 35 tests passed.
- New regression checks cover BDD/COCO label separation, incompatible tensor shapes,
  repeated nighttime class evidence, ambiguity, verified motion across a short
  model gap, rejection of static ghosts, nested duplicate boxes, ByteTrack ID
  restart handoff and letterbox coordinate preservation.
- Browser observation confirmed live playback around 15 rendered FPS and 8.8
  detection updates/second using the selected model.
- A separate final 40-second live run produced analysis in 197/197 samples and
  displayed detections in 114/197 samples, with up to four simultaneous objects.
  Polygon/direction flags and stable-class-flip checks passed. These checks do not
  independently establish object identity/class accuracy.

Artifacts under `output/detection-audit/continuity-comparison/`:

- `report.json`: paired source observations and per-stage diagnostics.
- `legacy_coco.mp4` and `road_domain.mp4`: genuine paced-source annotations.
- `legacy_coco.png` and `road_domain.png`: individual observed peak samples.

The separate final live report is under `output/detection-audit/road-domain-final-live/`.

## Road links for active cameras

Every observed-road map refresh now checks the current video sessions and resolves
an approximate OpenStreetMap segment from each active camera's catalog route and
direction. This covers every live or recorded session currently being analyzed;
it does not start streams for the whole catalog. Linked active roads with no
recent traffic sample are drawn gray and labeled as collecting or lacking a
recent estimate. A segment is colored for traffic only when fresh camera samples
support an estimate. The camera-to-road match remains approximate and does not
change route weights or imply calibrated travel times.

Cached links are tied to the camera's current coordinates, route and travel
direction as well as the graph version. If catalog metadata changes or becomes
incomplete, the prior link is invalidated; detections remain unattributed until a
valid route and direction match is available. This prevents an old road
association from surviving a camera-catalog correction.

Direction matching uses the directed road geometry's local tangent at its point
nearest the camera. Endpoint-to-endpoint headings can misclassify a curved
freeway segment, even when the road directly beside the camera follows the
catalog direction. Changing this matching rule increments the cached-link
version so old associations are recalculated on the next road-map refresh.

The October 21, 2026 runtime check found 71 video cameras with route and
direction metadata, 63 matched road segments, and two reviewed analysis zones;
the other 69 sources cannot contribute directional counts yet. A 20-second
full-scene review of camera `caltrans-d7-1030` analyzed 90 samples and detected
objects in 89. Track scale changes separated 39 vehicles approaching the camera
from 20 moving away. The saved lower-carriageway zone retained all 39 approaching
tracks for at least 80% of their observations; the direction and counting-line
gates produced no crossing for the receding tracks. A subsequent 25-second
shared-service check saved 54 tracks, all marked approaching. Its latest 130
counted tracks had playable MP4 evidence (100%). The view remained sparse at
5.9% image coverage, so congestion stayed unknown. This is camera-local evidence,
not labeled ground truth or a calibrated corridor-wide measurement. The full-scene
audit also recorded two stable-class transitions, so bus/truck accuracy remains
unverified. Inactive associations remain gray and explicitly report that the feed
is inactive; the map does not treat a static road link as a traffic measurement.
The API refreshes active-session estimates as video sessions change.
The observed map reports linked-road and current-estimate totals. It distinguishes
an inactive association from an active feed with recent samples that still lack
enough image coverage for a traffic estimate.

An active source without an enabled camera-specific road polygon and direction
can still provide full-scene video and object detections, but it cannot create
counting-line crossings or a traffic estimate for its linked road. The map labels
that state **Direction zone required** and leaves the segment uncolored. This
prevents detections from both carriageways being attributed to one road direction.

Reproduce:

```powershell
.venv/Scripts/python.exe -m scripts.verify_tracking_continuity --video output/detection-audit/night-source.mp4
```

## Model setup and provenance

`models/bdd-yolo11n.json` records the pinned Hugging Face revision, checkpoint and
ONNX checksums, class schema, export tooling and upstream license information.
The checkpoint is downloaded from the model registry, checksum-verified and loaded
with PyTorch's restricted weights-only loader and explicitly approved installed
model classes. No repository Python code is fetched or executed.

```powershell
.venv-model-tools/Scripts/python.exe scripts/prepare_road_model.py
```

The Windows launcher prepares the model when absent. `-Setup` can create the
isolated export environment using `requirements-model-tools.txt`. Torch and
Ultralytics are export-time dependencies, not production inference dependencies.
Model weights are ignored by Git; the manifest and reproducible exporter are kept.

Configuration defaults:

| Setting | Default |
| --- | --- |
| `VIDEO_LOW_LIGHT_MODEL_PATH` | `models/bdd-yolo11n.onnx` |
| `VIDEO_LOW_LIGHT_PROFILE` | `bdd100k` |
| `VIDEO_LOW_LIGHT_INPUT_SIZE` | `640` |

The legacy `coco` profile remains available for compatible COCO exports. Model
path, input dimensions and class profile must agree. Missing night-model files
produce an explicit fallback notice in the detection settings.
