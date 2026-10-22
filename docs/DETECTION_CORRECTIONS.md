# Video road-user detection corrections

Implemented locally on October 20, 2026.

This document records the earlier rejected configurations. The current YOLO26s
detector, two-level track confidence, durable observations and video evidence
are documented in [the current implementation](DETECTION_PERSISTENCE_PLAN.md).

## Correction after visual rejection

The user's night-camera screenshot demonstrated that the 20% configuration below
was not acceptable: weak classifications, partial boxes and missed vehicles were
still visible. Increased output counts were not evidence of improved accuracy.

The current policy supersedes that configuration:

- Default display confidence is 45%; the UI allows 35–95%.
- Require two distinct model observations of the same class/ID within 0.8 seconds.
  Interpolated boxes do not count as extra observations.
- Reject detections touching internal crop boundaries, so confident fragments
  cannot replace a complete vehicle box from an overlapping view.
- Validate optical-flow points in both directions before using their displacement.
- Explain experimental detection quality in the visible camera panel, including
  missed and incorrect labels in night glare. Counts refer only to shown boxes.
- Abstain on a specific bus or truck label when the predicted crop is too small
  or has an implausible road-view shape. Keep the object and trajectory visible
  as an unclassified vehicle so repeated predictions over the same few pixels
  do not turn into a confident large-vehicle assertion.

YOLOv8 small and medium models were compared on the same three diagnostic inputs.
They also missed vehicles and produced uncertain classifications. The medium
model took approximately 2.5 seconds per detailed inference on this CPU, exceeding
the current playback-buffer budget, so it was not enabled. Model size alone did
not resolve this source's low-light accuracy.

These changes reject specific failure modes; they do not establish production
accuracy on this camera. Source-specific, independently labeled video evaluation
and an adapted detector are still required to establish precision and recall.

## Reading provisional live labels

A percentage on a provisional video box is the detector's confidence that an
object is present in that frame. It is not the probability that the object is a
car, truck, or bus. The overlay now labels that value as `detection`; a trailing
`?` continues to mark an unconfirmed type. History retains the generic Vehicle
class until repeated observations support a specific type.

When detections cluster in a small part of the image, overlay labels are placed
in available slots that avoid both earlier labels and other vehicle boxes.
Higher-confidence and larger tracks receive placement priority. The fallback in
a completely crowded image chooses the least-obstructed slot so every detection
remains visible.

After applying the policy, a 30-second check of the actual source returned 147
readings with analysis and zero with visible confirmed detections. This is a
failed functional acceptance check for the requested detection experience, not
a successful accuracy fix. A further comparison of five current input images
found only two nano-model predictions above 35% (39.0% and 39.2%). The small model
also produced mostly weak predictions, at approximately 0.6 seconds per detailed
inference. The source-specific accuracy issue remains unresolved.

## Observed problem

The previous continuous-video implementation could show moving traffic with no
boxes. The default 35% confidence filter discarded many night-camera predictions;
whole-image resizing lost small distant vehicles; and failed optical-flow points
could erase fresh detections. A permissive centroid-matching gate could associate
different small cars and leave displaced boxes when their locations were predicted.

## Changes

- Analyze the whole scene plus three overlapping detail crops on larger images,
  with coordinates mapped back into the displayed video. Merge duplicate vehicles
  while preserving separately detected riders/pedestrians.
- The initial 20% display threshold was rejected after visual review and replaced
  by the stricter policy above. Confidence remains visible.
- Apply class-aware suppression to detector output. Match tracking IDs within a
  class, bound displacement by object size, and reject incompatible size changes.
- Maintain a bounded 0.6-second playback buffer and a short detection history.
  Interpolate positions only between confirmed detections of the same track on
  both sides of the displayed frame, with limits on time and displacement.
- Do not keep drawing a long extrapolated trajectory after a model miss. Without
  a later confirmation, projection is limited to 120 ms. Source generations never
  share boxes. Recorded playback drains its buffered tail at end-of-file.
- Select the latest frame *after* acquiring shared model access, so waiting behind
  another camera does not automatically make an inference result stale.
- Display larger colored labels, confidence, track IDs and all six class counts
  directly inside the video. The sidebar distinguishes recognized objects from
  waiting/empty analysis; it no longer labels an empty result as active detection.

The UI still uses real WebRTC video. There is no image polling or photo fallback.
The processing buffer adds approximately 0.6 seconds before encoding/browser
playback; it does not remove delay already introduced by a public HLS provider.

The detail-crop approach follows the small-object rationale described in
[Ultralytics sliced-inference documentation](https://docs.ultralytics.com/guides/sahi-tiled-inference/),
implemented with the existing OpenCV ONNX model without adding SAHI or Torch.

## Historical real-image smoke check of every class

The installed model and corrected processing path were checked against labeled
real examples from [Ultralytics COCO128](https://docs.ultralytics.com/datasets/detect/coco128/).
Each class required a matching prediction with confidence at least 20% and IoU
at least 0.35 with the corresponding ground-truth box.

| Class | Confidence | Ground-truth IoU |
| --- | --- | --- |
| Pedestrian | 88.4% | 0.972 |
| Bicycle | 84.9% | 0.958 |
| Car | 63.7% | 0.962 |
| Motorcycle | 86.7% | 0.934 |
| Bus | 82.0% | 0.944 |
| Truck | 44.6% | 0.990 |

This is a class smoke check using COCO training examples, not a held-out accuracy
benchmark or evidence that every category appears in the public camera at once.
The machine-readable results are local at
`output/detection-audit/class-verification.json`.

## Historical live-camera checks and boundaries

The real I-110 / 1st St video produced car and truck detections after these changes.
Three captured diagnostic inputs improved from 1 / 0 / 0 visible detections with
the previous full-image/35% path to 2 / 2 / 1 with detail crops and a 20% filter.
These counts describe model output, not human-labeled recall.

Use `python -m scripts.verify_live_detection --seconds 30` to exercise the actual
model, tracker and compositor on the public source. It writes session measurements
and one annotated diagnostic image under `output/detection-audit/`. This does not
record a historical video archive or certify every detected object as correct.

Night glare, compression, occlusion and very small objects still limit accuracy.
The interface does not invent counts for absent categories. No claim is made that
every road user in every camera is detected.

The large-vehicle geometry gate scales with frame resolution. For a bus it
requires at least 5% of frame width, 4% of frame height and a width-to-height
ratio of 1.1; for a truck it requires 4.5% of frame width, 4% of frame height
and a ratio of 1.05. This is an abstention rule, not a vehicle-size classifier:
it may leave a real distant bus or truck as `vehicle` until its image contains
enough detail. An operator can review its saved clip and correct the history.
The thresholds were regression-tested against small ambiguous examples and
valid larger boxes; they have not been calibrated against a labeled sample from
every camera.

## Regression checks

New checks cover all six output classes; class-aware suppression; detail-crop
coordinate mapping and duplicate removal; fresh textureless boxes; rider/class ID
stability; shared inference timing; interpolation between confirmed locations;
expiration of unconfirmed boxes; rejection of jumps between small distant cars;
and alignment against the actual displayed video frame rather than latest capture.

The earlier five-minute transport results in `CONTINUOUS_VIDEO_DELIVERY.md` were
measured before this detail detector and processing buffer. They are historical
measurements and must not be quoted as current detector latency or capacity.

To reproduce the real-class smoke check, download the official dataset archive
linked in the [COCO128 configuration](https://github.com/ultralytics/ultralytics/blob/main/ultralytics/cfg/datasets/coco128.yaml)
to `output/detection-audit/coco128.zip`, then run:

```powershell
.\.venv\Scripts\python.exe -m scripts.verify_detection_classes
```

No dataset images, camera captures or model binaries are added to source control.

## Operator-reviewed corrections

When an operator reviews a saved clip, the selected label now becomes the
effective class for that saved track and its inbound crossing reports. The raw
detector class remains stored and visible as the original output. Marking a
track as a false positive removes that reviewed track from saved track totals
and crossing counts without deleting its clip or audit record.

Class agreement compares a specific detector label with the reviewed video
label. A generic `vehicle` result with no candidate is recorded as a model
abstention rather than a wrong class; selecting `vehicle, type unclear` also
does not score a specific class prediction. False-positive reviews are counted
as detection errors. These operator-selected examples remain a biased sample,
not an accuracy benchmark or automatic training set. Image-coverage estimates
continue to reflect the original frame analysis and are not recomputed from
manual track corrections.
