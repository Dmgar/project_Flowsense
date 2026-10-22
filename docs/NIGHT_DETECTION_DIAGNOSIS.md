# Nighttime detection diagnosis and mitigation

Current runtime update: see [road-domain detection and continuous tracking](ROAD_DOMAIN_TRACKING.md).
The findings below describe the earlier COCO model and its limitations before that update.

## Finding

Latest post-correction live check: analysis was available in 97/97 samples over
20 seconds, but displayed car detections appeared in only 7/97 samples, with one
simultaneous track at most. Nighttime recognition is still insufficient; working
video/inference must not be presented as reliable night vehicle detection.

Camera `caltrans-d7-cctv-1031` has working continuous video and inference, but
nighttime vehicle detection is substantially weaker than daytime detection.
The UI had all road-user categories enabled with a 30% track-confidence threshold.
The supplied screenshot contains recognizable cars; it is not an empty roadway.

Two failures compound each other: glare/compression and reduced vehicle detail
produce sparse, weak detections; large movement between inference updates breaks
box-overlap association, so incoming-direction confirmation often never succeeds.
The inbound polygon remains necessary to exclude the opposite carriageway.
Its left boundary also excluded part of the guardrail-side incoming lane: a
55%-confidence car box in the user's screenshot was rejected by the old polygon.
The corrected boundary admits that box while keeping the opposing roadway excluded.

## Changes

- Camera 1031's left road boundary was corrected, with analysis-zone revision 2
  applied to the running camera and the default preset. Earlier revision records
  remain saved separately; current-zone totals restart under the new geometry.
- An image-based low-light profile uses the existing locally exported YOLO11s
  ONNX model. Daytime retains YOLOv8s and its road crops. It does not assume that
  the server's local clock is the camera's timezone.
- Original full-frame context and a mild gamma-adjusted view are combined using
  NMS into one temporal observation. CLAHE and alternative crops were tested;
  they did not improve this source enough to select them.
- Narrow headlight/front fragments contained in a complete vehicle box are
  suppressed when their road-contact anchors agree, avoiding duplicate boxes
  from the original and enhanced views. Adjacent vehicles and riders are retained.
- ByteTrack receives optical-flow-assisted association. Forward/backward feature
  consistency, minimum feature support, coherent motion and displacement bounds
  constrain the affinity. Optical flow does not create model detections, counts
  or observations on its own. Reverse traffic still fails the direction filter.
- Weak night candidates may initialize at 15%, but weak incoming tracks need
  three actual observations before admission. The default night display threshold
  is 20%; an operator's explicitly changed filters are preserved. Daytime defaults
  remain 30%. Specific bus/truck class requirements remain conservative.
- The player reports **Low-light analysis** and the actual model name. SQLite
  samples retain the inference model and low-light visibility context. The road
  conditions panel explains that missed vehicles can understate traffic.
- If the optional night model is absent, the settings panel reports the fallback
  instead of presenting standard inference as the low-light profile.

## Same-video comparison

A real 12-second source segment (180 frames at 15 FPS) was captured and replayed.
Both pipelines analyzed the same 30 input frames at 0.4-second intervals, with
their respective old and corrected road profiles.

| Prediction measure | Previous pipeline | Low-light pipeline |
| --- | ---: | ---: |
| Model boxes in the road zone at confidence >= 30% | 8 | 28 |
| Incoming tracked observations | 3 | 14 |
| Samples with display-eligible tracks | 3 / 30 | 10 / 30 |
| Maximum simultaneous display-eligible tracks | 1 | 2 |
| Mean inference time on this run | 0.344 s | 0.319 s |

These are repeated observations, not unique vehicles or measured recall. The new
pipeline uses its documented night thresholds and association rules. This is a
paired continuity check, not an independently labeled accuracy benchmark.

A separate 30-second real-time run produced analysis in 146/146 samples, visible
detections in 19/146 samples and up to three simultaneous tracks. No displayed
boxes failed the configured polygon/direction flags, and stable class labels did
not flip. Those flags do not establish that every identity or class is correct.

**Nighttime detection remains incomplete.** Many visible vehicles are still missed;
these mitigations do not establish reliable night traffic volume or calibrated
congestion. A sparse detection interval must not be interpreted as a clear road.
Validation here concerns camera 1031, not every camera in the catalog.

## Latest live sample (2026-10-21)

A fresh 12-second live-source check recorded analysis in 59/59 samples and
detections in 48/59. It observed at most three simultaneous tracks and 75
inbound detection-box observations. All 75 were inside the configured zone and
approach direction; no stable class flips occurred. The sample produced `car`
and provisional `vehicle` labels, with no bus or truck detections. That does not
prove a bus or truck was present during the sample, and it does not establish
nighttime recall. The browser session returned to 15 rendered FPS and about 8
detection updates per second after a transient reconnect.

The report and annotated frame are saved at
[live-detection.json](../output/detection-audit/review-20261021-0728/live-detection.json)
and
[live-detection-annotated.png](../output/detection-audit/review-20261021-0728/live-detection-annotated.png).
Running the verifier without `--output` now creates a new timestamped folder so
it does not overwrite earlier camera evidence.

## Supplemental high-resolution inference (2026-10-21)

A paired 60-frame replay compared the current 640-pixel road model, a 960-pixel
replacement every third sample, and a fusion that always keeps the 640-pixel
results while adding deduplicated 960-pixel candidates every third sample. The
fusion produced 104 road boxes at confidence >= 20% and 64 at >= 30%, compared
with 95 and 54 for replacement. Tracker observations were 74 versus 68, with 19
track IDs and a peak of four tracks in both modes. Mean measured inference time
was 0.0571 seconds for fusion and 0.0575 seconds for replacement in this run.

The production night path now supplements every third 640-pixel inference with
the 960-pixel detector when CUDA is active, the inbound zone is enabled, and at
most one camera session is active. Base boxes remain intact; overlapping
supplemental boxes are deduplicated. CPU and multi-camera cases retain the base
path to bound inference load. This replay has no independent object labels, so
candidate and tracker gains do not establish recall or classification accuracy.

The updated backend was started alongside the prior local instance to preserve
its active recorder. Its browser player reached 15 rendered FPS and about 5
detection updates per second at 1280 x 720; the rolling display showed live road
hits and tracked vehicles. SQLite saved 16 tracks with the fused model
provenance during the validation window, including a stable inbound car track.
The same source produced car tracks with the base model between fusion samples.
This short live check confirms the new path executes and persists provenance;
it does not independently prove the additional boxes are true vehicles or that
nighttime recall is adequate.

## Reproduce and inspect

`python -m scripts.verify_night_detection --video <actual-source-video.mp4>`

`python -m scripts.verify_live_detection --seconds 30 --output output/detection-audit/night-live`

Local diagnostic outputs include `night-source.mp4`, `night-paired-report.json`,
`night-paired-baseline.jpg`, `night-paired-low_light.jpg` and the separate night-live
report/annotated image. The paired verifier now writes each run to its own timestamped
folder under `output/detection-audit/`; pass `--output-dir` to select an empty folder.
It refuses to overwrite a non-empty destination. The latest revision-2 runtime check
is `night-zone-final/live-detection.json` in that directory.

## Timestamped paired replay (2026-10-21)

The 180-frame nighttime clip was replayed at 30 evenly sampled points using the
previous baseline detector/zone and the current low-light pipeline/zone. The
baseline produced 8 in-zone boxes at confidence >= 30%, 3 track observations,
and a visible track in 3/30 samples. The low-light path produced 35 such boxes,
20 track observations, and a visible track in 13/30 samples. Its saved tracks
were 14 `car` and 5 provisional `vehicle`; neither path produced a bus or truck
label. This is evidence of more detections and continuity on this clip, not proof
that every box is a vehicle, that recall improved against ground truth, or that
the clip contained a bus or truck. The comparison also changes the analysis-zone
revision, so it evaluates the combined pipeline and zone change rather than an
isolated model swap. The report and annotated samples are preserved under
`output/detection-audit/recurring-20261021-night-quality-warmed/`.

Regression checks cover image-based low-light selection, one observation after
view merging, identity preservation across non-overlapping real detections,
empty-road behavior, reverse-direction rejection, repeated weak evidence and
explicit missing-model fallback. The full backend suite passed 152 tests; the
nine night regressions also pass after adding headlight-fragment and road-boundary checks.
Frontend build, lint and its 35 tests pass. Timing varies with other active video sessions.

## Model setup

The current workstation already has `models/yolo11s.onnx`. Its SHA-256 and export
command are recorded in `models/video-model-yolo11s.json`. The path is configurable
with `VIDEO_LOW_LIGHT_MODEL_PATH`. Model weights are ignored by Git.

On another workstation, use the isolated model-tools environment, with dependencies
from `requirements-model-tools.txt`, to export official Ultralytics weights:

`.venv-model-tools/Scripts/python.exe scripts/prepare_video_model.py --model yolo11s`

Torch/Ultralytics are export-time dependencies; production inference stays on
OpenCV DNN. Exporting a general COCO model does not make it a night-trained model.
A reliable deployment still needs camera-specific night footage with annotated
vehicles, measured precision/recall and suitable night-domain training/validation.
# Provisional low-light overlays

Repeated low-light tracks below the selected confidence threshold can now be
shown on the live video with dashed amber boxes and an explicit candidate label.
This is a display setting; it does not change saved tracks, crossing totals, or
road estimates. The camera's **Detection settings** control can hide these
candidates. The default is on so operators can see weak but repeated detections
without silently treating them as confirmed vehicle classes.


## Low-light road-condition coverage gate (2026-10-21)

A live I-110 southbound summary showed a low-light estimate with 15.1% mean
vehicle footprint and a `Traffic moving` label. The previous shared 8% coverage
floor allowed a whole-road condition from this partially visible nighttime view.
The estimator now requires 20% coverage for low-light samples before assigning a
road condition; the standard-light floor remains 8%. Below the applicable floor,
vehicle observations and confirmed crossings remain available, but the label is
`Vehicle movement · sparse view` and the road-level congestion value stays unknown.
This is a conservative evidence-coverage gate, not a calibration of recall or
road occupancy. The runtime needs a controlled API restart before it uses this
change; existing capture data and clips are unaffected by the code change.
