"""Class-independent ByteTrack IDs, road-zone membership and temporal labels."""
from collections import deque
import cv2
import numpy as np
import supervision as sv
from scipy.optimize import linear_sum_assignment
from trackers import ByteTrackTracker
from src.perception.tracker import _iou

ROAD_CLASSES = ("car", "bus", "truck")


class FlowAssistedIoU:
    """Help ByteTrack associate real detections across sparse nighttime updates.

    Optical flow only supplies matching affinity. It never creates a model box
    or a database observation. Inconsistent glare/features are rejected.
    """
    def __init__(self, base, projections):
        self.base, self.projections = base, projections

    def compute(self, predicted, detected):
        scores = self.base.compute(predicted, detected)
        if not len(predicted) or not len(detected):
            return scores
        if not self.projections:
            return scores
        projection_boxes = np.asarray([
            (old[0], old[1], old[0] + old[2], old[1] + old[3])
            for old, _ in self.projections
        ], dtype=float)
        overlap = np.zeros((len(predicted), len(projection_boxes)), dtype=float)
        for row, box in enumerate(predicted):
            for column, projected in enumerate(projection_boxes):
                overlap[row, column] = _iou(
                    (box[0], box[1], box[2] - box[0], box[3] - box[1]),
                    (projected[0], projected[1], projected[2] - projected[0], projected[3] - projected[1]),
                )
        rows, columns = linear_sum_assignment(overlap, maximize=True)
        for row, column in zip(rows, columns):
            if overlap[row, column] < .2:
                continue
            x, y, w, h = self.projections[column][1]
            affinity = self.base.compute(np.array([[x, y, x+w, y+h]]), detected)
            scores[row] = np.maximum(scores[row], affinity[0])
        return scores


def flow_projections(tracker, previous, current, scale):
    projections = []
    for track in tracker.tracks:
        x1, y1, x2, y2 = track.get_state_bbox()
        left, top = max(0, int(x1*scale)), max(0, int(y1*scale))
        right, bottom = min(previous.shape[1], int(x2*scale)), min(previous.shape[0], int(y2*scale))
        roi = previous[top:bottom, left:right]
        if min(roi.shape, default=0) < 5:
            continue
        points = cv2.goodFeaturesToTrack(roi, maxCorners=20, qualityLevel=.03, minDistance=3)
        if points is None or len(points) < 3:
            continue
        points += np.array([left, top], np.float32)
        moved, valid, _ = cv2.calcOpticalFlowPyrLK(previous, current, points, None, winSize=(25,25), maxLevel=4)
        if moved is None:
            continue
        returned, reverse, _ = cv2.calcOpticalFlowPyrLK(current, previous, moved, None, winSize=(25,25), maxLevel=4)
        if returned is None:
            continue
        good = valid.ravel().astype(bool) & reverse.ravel().astype(bool) & (np.linalg.norm((returned-points).reshape(-1,2),axis=1) < 1.5)
        if good.sum() < 3:
            continue
        shifts = (moved-points).reshape(-1,2)[good]
        delta = np.median(shifts,axis=0)
        coherent = np.linalg.norm(shifts-delta,axis=1) < 3
        if coherent.sum() < 3 or coherent.mean() < .6:
            continue
        dx, dy = delta / scale
        if np.hypot(dx,dy) > 2*np.hypot(x2-x1,y2-y1):
            continue
        projections.append(((x1,y1,x2-x1,y2-y1),(x1+dx,y1+dy,x2-x1,y2-y1)))
    return projections


def in_road_zone(bbox, shape, profile):
    if not profile.get("enabled"):
        return True
    height, width = shape[:2]
    x, y, w, h = bbox
    polygon = np.asarray(profile["polygon"], np.float32)
    # The bottom-center remains the primary road-contact anchor.
    anchor = ((x + w / 2) / width, (y + h) / height)
    distance = cv2.pointPolygonTest(polygon, anchor, True)
    # Small distant night vehicles occupy only a handful of pixels. Allow a
    # narrow edge margin so detector jitter does not drop them at the road
    # boundary, while keeping objects clearly in the opposing lanes excluded.
    edge_tolerance = min(.012, max(.003, 2.0 / max(width, height)))
    return distance >= -edge_tolerance


def crossed_counting_segment(previous, current, segment, direction=None):
    """Return true only for a finite gate crossing in the configured direction."""
    if not isinstance(segment, (list, tuple)) or len(segment) != 2:
        return False
    try:
        start, end = (np.asarray(point, dtype=float) for point in segment)
        previous, current = np.asarray(previous, dtype=float), np.asarray(current, dtype=float)
    except (TypeError, ValueError):
        return False
    if any(point.shape != (2,) or not np.isfinite(point).all()
           for point in (start, end, previous, current)):
        return False
    motion, gate = current - previous, end - start
    if direction is not None:
        try:
            direction = np.asarray(direction, dtype=float)
        except (TypeError, ValueError):
            return False
        if direction.shape != (2,) or not np.isfinite(direction).all() or np.linalg.norm(direction) < 1e-9:
            return False
        if float(np.dot(motion, direction)) <= 0:
            return False
    denominator = float(motion[0] * gate[1] - motion[1] * gate[0])
    if abs(denominator) < 1e-9:
        return False
    offset = start - previous
    motion_fraction = float((offset[0] * gate[1] - offset[1] * gate[0]) / denominator)
    gate_fraction = float((offset[0] * motion[1] - offset[1] * motion[0]) / denominator)
    return 0 <= motion_fraction <= 1 and 0 <= gate_fraction <= 1


def remove_duplicate_vehicle_detections(detections):
    """Drop near-identical road boxes emitted by separate detector anchors.

    IoU alone misses a tight box nested in a larger low-light box. Require
    near-total containment, close centers and a bounded size ratio so distinct
    vehicles travelling in line remain separate.
    """
    ranked = sorted(enumerate(detections), key=lambda item: item[1].confidence, reverse=True)
    kept = []
    suppressed = set()
    for index, candidate in ranked:
        if candidate.class_name not in ROAD_CLASSES:
            kept.append((index, candidate))
            continue
        x, y, width, height = candidate.bbox
        area = max(1, width * height)
        center_x, center_y = x + width / 2, y + height / 2
        duplicate = False
        for _, prior in kept:
            if prior.class_name not in ROAD_CLASSES:
                continue
            px, py, pwidth, pheight = prior.bbox
            parea = max(1, pwidth * pheight)
            intersection = max(0, min(x + width, px + pwidth) - max(x, px)) * max(
                0, min(y + height, py + pheight) - max(y, py)
            )
            containment = intersection / min(area, parea)
            size_ratio = max(area, parea) / min(area, parea)
            center_distance_x = abs(center_x - (px + pwidth / 2))
            center_distance_y = abs(center_y - (py + pheight / 2))
            if (containment >= .92 and size_ratio <= 3.25
                    and center_distance_x <= .4 * min(width, pwidth)
                    and center_distance_y <= .4 * min(height, pheight)):
                duplicate = True
                break
        if duplicate:
            suppressed.add(index)
        else:
            kept.append((index, candidate))
    return [candidate for _, candidate in sorted(kept)], len(suppressed)


def retain_repeated_low_light_candidates(candidates, previous, instant, minimum=.10,
                                         tracker_threshold=.15, minimum_iou=.15,
                                         maximum_gap=.75):
    """Admit weak night detections only after the same class repeats in time.

    The first weak hit remains diagnostic evidence. A second detector update
    must overlap the prior box, preventing isolated glare from starting a track.
    """
    retained = [item for item in candidates if item.confidence >= tracker_threshold]
    weak = [item for item in candidates if minimum <= item.confidence < tracker_threshold]
    recent_previous = [
        (index, entry) for index, entry in enumerate(previous)
        if 0 <= instant - entry[1] <= maximum_gap
    ]
    next_history = []
    used_previous = set()
    for detection in weak:
        matches = [
            (index, entry, _iou(entry[0].bbox, detection.bbox))
            for index, entry in recent_previous
            if index not in used_previous
            and entry[0].class_name == detection.class_name
        ]
        match = max(matches, key=lambda item: item[2], default=None)
        if match and match[2] >= minimum_iou:
            index, entry, _ = match
            used_previous.add(index)
            hits = entry[2] + 1
            mean_confidence = (entry[3] * entry[2] + detection.confidence) / hits
            previous_detection, previous_instant = entry[0], entry[1]
        else:
            hits = 1
            mean_confidence = detection.confidence
            previous_detection, previous_instant = None, None
        next_history.append((detection, instant, hits, mean_confidence,
                             previous_detection, previous_instant))
        if hits >= 2 and mean_confidence >= minimum + .01:
            retained.append(detection)
    # A detector miss is not a new observation, but it also must not erase a
    # still-fresh weak hit. Preserve unmatched evidence only for the bounded
    # matching window so a later real detection can confirm it.
    next_history.extend(entry for index, entry in recent_previous if index not in used_previous)
    return retained, next_history


class ClassConsensus:
    """Leave ambiguity explicit; a published specific class never flickers."""
    def __init__(self, low_light=False):
        self.observations = deque(maxlen=8)
        self.label = "vehicle"
        self.candidate = None
        self.locked = False
        self.low_light = low_light

    @staticmethod
    def _supports_large_vehicle_class(name, bbox, frame_shape):
        """Require enough pixels and a plausible road-view shape to name a bus/truck.

        Distant compressed boxes still remain tracked as ``vehicle``. Repeated
        copies of the same few pixels cannot make an implausible shape reliable.
        The thresholds scale with the decoded frame size and deliberately gate
        only the more easily confused large-vehicle classes.
        """
        if name not in {"bus", "truck"} or bbox is None or frame_shape is None:
            return True
        width, height = bbox[2], bbox[3]
        frame_height, frame_width = frame_shape[:2]
        if width <= 0 or height <= 0 or frame_width <= 0 or frame_height <= 0:
            return False
        if name == "bus":
            return (width >= frame_width * .05 and height >= frame_height * .04
                    and width / height >= 1.1)
        return (width >= frame_width * .045 and height >= frame_height * .04
                and width / height >= 1.05)

    def update(self, detection, frame_shape=None):
        if detection.class_name not in ROAD_CLASSES:
            self.label, self.candidate, self.locked = detection.class_name, None, True
            return self.label
        scores = detection.class_scores or {detection.class_name: detection.confidence}
        # Abstain on every unsupported large-vehicle hypothesis before temporal
        # averaging. The consensus winner can differ from this frame's top
        # class, so gating only detection.class_name would still allow a
        # small/implausible bus score to win over several updates.
        values = np.array([
            scores.get(name, 0) if self._supports_large_vehicle_class(name, detection.bbox, frame_shape) else 0
            for name in ROAD_CLASSES
        ], float)
        if not values.any():
            self.candidate = None
            return self.label
        self.observations.append(values)
        if len(self.observations) < 2:
            return self.label

        # Expose an early class hint in the live overlay without changing the
        # persistent class or crossing count before the stricter consensus.
        provisional = np.asarray(self.observations)[-4:]
        provisional_means = provisional.mean(axis=0)
        provisional_order = np.argsort(provisional_means)
        provisional_winner, provisional_runner = int(provisional_order[-1]), int(provisional_order[-2])
        provisional_name = ROAD_CLASSES[provisional_winner]
        provisional_support = int(np.count_nonzero(np.argmax(provisional, axis=1) == provisional_winner))
        provisional_share = provisional_means[provisional_winner] / max(.001, provisional_means.sum())
        provisional_floor = (.10 if self.low_light else .12) if provisional_name == "car" else .50
        provisional_share_floor = .50 if provisional_name == "car" else .72
        provisional_margin = .05 if provisional_name == "car" else .18
        required_support = (max(2, int(np.ceil(.6 * len(provisional)))) if provisional_name == "car"
                            else max(4, int(np.ceil(.8 * len(provisional)))))
        if (provisional_support >= required_support and provisional_means[provisional_winner] >= provisional_floor
                and provisional_share >= provisional_share_floor
                and provisional_means[provisional_winner] - provisional_means[provisional_runner] >= provisional_margin):
            self.candidate = provisional_name
        elif len(provisional) >= 4:
            self.candidate = None

        # Ignore isolated contradictory predictions but keep collecting class
        # evidence: the first consensus can be wrong on compressed night video.
        if self.locked:
            # Provisional hints are useful while a type is uncertain, but they
            # must not linger beside an already-confirmed class.
            self.candidate = None
            if len(self.observations) < 6:
                return self.label
            recent = np.asarray(self.observations)[-6:]
            means = recent.mean(axis=0)
            order = np.argsort(means)
            winner, runner = int(order[-1]), int(order[-2])
            challenger = ROAD_CLASSES[winner]
            support = int(np.count_nonzero(np.argmax(recent, axis=1) == winner))
            share = means[winner] / max(.001, means.sum())
            floor = (.20 if self.low_light else .28) if challenger == "car" else .55
            margin = (.12 if self.low_light else .10) if challenger == "car" else .25
            if (challenger != self.label and support >= 5 and share >= .75
                    and means[winner] >= floor and means[winner] - means[runner] >= margin):
                self.label = challenger
            self.candidate = None
            return self.label

        recent = np.asarray(self.observations)
        means = recent.mean(axis=0)
        order = np.argsort(means)
        winner, runner = int(order[-1]), int(order[-2])
        name = ROAD_CLASSES[winner]
        support = int(np.count_nonzero(np.argmax(recent, axis=1) == winner))
        share = means[winner] / max(.001, means.sum())
        floor = (.20 if self.low_light else .28) if name == "car" else .55
        margin = (.12 if self.low_light else .10) if name == "car" else .25
        required = (3 if self.low_light else 2) if name == "car" else 3
        required_share = (.70 if self.low_light else .60) if name == "car" else .72
        # A strong car consensus may finish after two independent video
        # observations. This recovers short distant-car tracks that leave the
        # frame before a third model update, while keeping bus/truck labels on
        # the stricter three-observation path.
        if (self.low_light and len(recent) == 2 and name == "car" and support == 2
                and share >= .80 and means[winner] >= .35
                and means[winner] - means[runner] >= .20):
            self.label, self.candidate, self.locked = name, None, True
            return self.label
        if support >= required and support / len(recent) >= .75 and share >= required_share and means[winner] >= floor and means[winner] - means[runner] >= margin:
            self.label, self.candidate, self.locked = name, None, True
        return self.label


class RoadTracker:
    def __init__(self, fps=15):
        self.trackers = {}
        self.states = {}
        self.next_id = 1
        self.fps = fps
        self.previous_candidates = {}
        self.previous_weak_candidates = {}
        self.previous_gray, self.previous_instant = None, None
        self.suppressed_candidates = 0

    @staticmethod
    def association_is_plausible(previous_bbox, current_bbox, elapsed_seconds):
        """Reject a tracker ID that jumps to a distant or radically different box."""
        try:
            previous = np.asarray(previous_bbox, dtype=float)
            current = np.asarray(current_bbox, dtype=float)
            elapsed = float(elapsed_seconds)
        except (TypeError, ValueError):
            return False
        if (previous.shape != (4,) or current.shape != (4,) or not np.isfinite(previous).all()
                or not np.isfinite(current).all() or not np.isfinite(elapsed) or elapsed < 0
                or np.any(previous[2:] <= 0) or np.any(current[2:] <= 0)):
            return False
        previous_center = previous[:2] + previous[2:] / 2
        current_center = current[:2] + current[2:] / 2
        diagonal = max(float(np.hypot(*previous[2:])), float(np.hypot(*current[2:])))
        maximum_shift = max(24.0, diagonal * (.45 + 1.5 * min(elapsed, 2.0)))
        previous_area = float(previous[2] * previous[3])
        current_area = float(current[2] * current[3])
        scale_ratio = max(previous_area, current_area) / min(previous_area, current_area)
        maximum_scale_ratio = 2.5 + 1.5 * min(elapsed, 2.0)
        return (float(np.linalg.norm(current_center - previous_center)) <= maximum_shift
                and scale_ratio <= maximum_scale_ratio)

    def update(self, detections, frame, instant, profile):
        scale = min(1.,640/frame.shape[1])
        gray = cv2.resize(cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),None,fx=scale,fy=scale) if profile.get("low_light") else None
        detections = [d for d in detections if in_road_zone(d.bbox, frame.shape, profile)]
        detections, self.suppressed_candidates = remove_duplicate_vehicle_detections(detections)
        groups = {"road", "pedestrian", "rider", "bicycle", "motorcycle"}
        outputs = []
        for group in sorted(groups):
            candidates = [d for d in detections if ("road" if d.class_name in ROAD_CLASSES else d.class_name) == group]
            activation_threshold = .10 if profile.get("low_light") else .30
            current_weak = []
            if profile.get("low_light"):
                prior_weak_time, prior_weak = self.previous_weak_candidates.get(group, (instant, []))
                if instant - prior_weak_time > .75:
                    prior_weak = []
                candidates, current_weak = retain_repeated_low_light_candidates(
                    candidates, prior_weak, instant, tracker_threshold=.15)
                self.previous_weak_candidates[group] = (instant, current_weak)
            else:
                self.previous_weak_candidates[group] = (instant, [])
            if group not in self.trackers:
                self.trackers[group] = ByteTrackTracker(frame_rate=self.fps, lost_track_buffer=45,
                    track_activation_threshold=.30, high_conf_det_threshold=.30,
                    minimum_consecutive_frames=1, minimum_iou_threshold=.05)
            # Weak nighttime evidence can recover an existing identity. Actual
            # direction and repeated observations still gate display and counting.
            self.trackers[group].track_activation_threshold = activation_threshold
            self.trackers[group].high_conf_det_threshold = activation_threshold
            tracker = self.trackers[group]
            base_iou = tracker.iou.base if isinstance(tracker.iou, FlowAssistedIoU) else tracker.iou
            tracker.iou = base_iou
            if gray is not None and self.previous_gray is not None and gray.shape == self.previous_gray.shape and 0 < instant-self.previous_instant <= .8:
                tracker.iou = FlowAssistedIoU(base_iou, flow_projections(tracker,self.previous_gray,gray,scale))
            boxes = np.asarray([(x, y, x + w, y + h) for d in candidates for x, y, w, h in [d.bbox]], np.float32).reshape(-1, 4)
            objects = sv.Detections(xyxy=boxes,
                confidence=np.array([d.confidence for d in candidates], np.float32),
                class_id=np.zeros(len(candidates), dtype=int),
                data={"source_index": np.arange(len(candidates))})
            tracked = self.trackers[group].update(objects, timestamp=instant)
            initial_used = set()
            current_candidates = [(detection, None, None) for detection in candidates]
            prior_time, prior = self.previous_candidates.get(group, (instant, []))
            updated_states = set()
            for index, tracker_id in enumerate(tracked.tracker_id):
                if tracker_id < 0:
                    continue
                detection_index = int(tracked.data["source_index"][index])
                detection = candidates[detection_index]
                key = (group, int(tracker_id))
                x, y, w, h = detection.bbox
                point = np.array(((x + w / 2) / frame.shape[1], (y + h) / frame.shape[0]))
                state = self.states.get(key)
                rejected_state = None
                if state is not None and not self.association_is_plausible(
                        state.get("bbox"), detection.bbox, instant - state["instant"]):
                    rejected_state = state
                    self.states.pop(key, None)
                    state = None
                if state is None:
                    matches = [(i, item, _iou(item[0].bbox, detection.bbox)) for i, item in enumerate(prior)
                               if i not in initial_used and (rejected_state is None or item[2] is not rejected_state)
                               and instant - prior_time <= .75]
                    initial = max(matches, key=lambda item: item[2], default=None)
                    if initial and initial[2] >= .15:
                        initial_used.add(initial[0])
                        previous_detection, _, previous_state = initial[1]
                        if previous_state is not None:
                            state = previous_state
                            state["tracker_key"] = key
                        else:
                            classifier = ClassConsensus(low_light=profile.get("low_light", False))
                            classifier.update(previous_detection, frame.shape)
                            previous_box = previous_detection.bbox
                            origin = np.array(((previous_box[0] + previous_box[2] / 2) / frame.shape[1],
                                               (previous_box[1] + previous_box[3]) / frame.shape[0]))
                            state = {"id": self.next_id, "classifier": classifier, "origin": origin,
                                     "last": origin, "instant": prior_time, "seen": prior_time,
                                     "bbox": previous_detection.bbox,
                                     "approaching": False, "score": previous_detection.confidence, "hits": 1,
                                     "crossing_pending": None,
                                     "trail": deque(maxlen=20), "counted": False, "crossing_instant": None,
                                     "tracker_key": key}
                            self.next_id += 1
                    else:
                        weak_seed = next((entry for entry in current_weak
                                          if entry[0] is detection and entry[2] >= 2), None)
                        if weak_seed:
                            _, _, weak_hits, mean_confidence, previous_detection, previous_instant = weak_seed
                            classifier = ClassConsensus(low_light=True)
                            classifier.update(previous_detection, frame.shape)
                            previous_box = previous_detection.bbox
                            previous_point = np.array(((previous_box[0] + previous_box[2] / 2) / frame.shape[1],
                                                       (previous_box[1] + previous_box[3]) / frame.shape[0]))
                            state = {"id": self.next_id, "classifier": classifier,
                                     "origin": previous_point, "last": previous_point,
                                     "instant": previous_instant, "seen": previous_instant,
                                     "bbox": previous_box, "approaching": False,
                                     "score": mean_confidence, "hits": weak_hits - 1,
                                     "crossing_pending": None, "trail": deque(maxlen=20),
                                     "counted": False, "crossing_instant": None, "tracker_key": key}
                        else:
                            state = {"id": self.next_id, "classifier": ClassConsensus(low_light=profile.get("low_light", False)),
                                     "origin": point, "last": point, "instant": instant, "seen": instant,
                                     "bbox": detection.bbox,
                                     "approaching": False, "score": detection.confidence, "hits": 0,
                                     "crossing_pending": None,
                                     "trail": deque(maxlen=20), "counted": False, "crossing_instant": None,
                                     "tracker_key": key}
                        self.next_id += 1
                    self.states[key] = state
                else:
                    for previous_index, item in enumerate(prior):
                        if item[1] == key and item[2] is state:
                            initial_used.add(previous_index)
                            break
                # Direction eligibility can delay persistence for a few real
                # detector hits. Keep the actual first observation so history
                # does not understate how long the tracker followed the object.
                state.setdefault("first_seen_instant", state.get("instant", instant))
                if state.get("tracker_key", key) != key or id(state) in updated_states:
                    continue
                updated_states.add(id(state))
                current_candidates[detection_index] = (detection, key, state)
                state["classifier"].low_light = bool(profile.get("low_light", False))
                label = state["classifier"].update(detection, frame.shape)
                state["hits"] += 1
                elapsed = max(.001, instant - state["instant"])
                velocity = (point - state["last"]) * np.array((frame.shape[1], frame.shape[0])) / elapsed
                direction = np.array(profile.get("direction", (0, 1)), float)
                direction /= max(.001, np.linalg.norm(direction))
                movement = point - state["origin"]
                progress = float(np.dot(movement, direction))
                magnitude = float(np.linalg.norm(movement))
                minimum = profile.get("minimum_motion", .008)
                if progress >= minimum and progress >= .55 * magnitude:
                    state["approaching"] = True
                # Reverse motion is excluded even if a prior ID was accepted.
                allowed = not profile.get("enabled") or (state["approaching"] and progress >= -minimum)
                # Inbound filtering intentionally delays attribution until
                # direction is clear. Still surface a repeated in-zone object
                # as a provisional live box so the operator can see what the
                # detector is finding while motion evidence accumulates.
                direction_checking = bool(profile.get("enabled") and not state["approaching"])
                provisional = bool(direction_checking
                                   and profile.get("low_light") and state["hits"] >= 2
                                   and state["score"] >= .10 and magnitude >= minimum * .25
                                   and progress >= -minimum)
                # Surface a repeated weak night-time object in the live view
                # after two real detector hits. Persistence and counting keep
                # their stricter three-hit / .30-confidence confirmation.
                if profile.get("low_light") and max(state["score"], detection.confidence) < .20 and state["hits"] < 2:
                    allowed = False
                gate_segment = profile.get("counting_line")
                if gate_segment:
                    crossed_gate = crossed_counting_segment(state["last"], point, gate_segment, direction)
                else:
                    # Preserve legacy camera profiles that store a horizontal line.
                    gate = profile.get("counting_line_y", .64)
                    crossed_gate = state["last"][1] < gate <= point[1]
                if (profile.get("enabled") and allowed and not state["counted"]
                        and crossed_gate and elapsed < 1.5):
                    # A single weak detection crossing the line is often a
                    # headlight or pavement reflection at night. Remember the
                    # crossing, then count only after the same moving object
                    # is supported by multiple real detector updates.
                    state["crossing_pending"] = instant
                confirmation_hits = 3 if profile.get("low_light") else 2
                confirmation_confidence = .30 if profile.get("low_light") else .25
                if (allowed and not state["counted"] and state.get("crossing_pending") is not None
                        and instant - state["crossing_pending"] <= 1.5
                        and state["hits"] >= confirmation_hits
                        and state["score"] >= confirmation_confidence
                        and progress >= minimum and progress >= .55 * magnitude):
                    state["counted"] = True
                    state["crossing_instant"] = state["crossing_pending"]
                    state["crossing_pending"] = None
                elif (state.get("crossing_pending") is not None
                      and instant - state["crossing_pending"] > 1.5):
                    state["crossing_pending"] = None
                state["score"] = max(detection.confidence, state["score"] * np.exp(-elapsed / 2))
                state["last"], state["instant"], state["seen"] = point, instant, instant
                state["bbox"] = detection.bbox
                state["trail"].append((int(x + w / 2), int(y + h)))
                if allowed or provisional:
                    direction_status = "checking" if provisional else "confirmed"
                    outputs.append({"id": state["id"], "class": label, "confidence": detection.confidence,
                        "track_confidence": float(state["score"]), "bbox": detection.bbox,
                        "observation_hits": state["hits"],
                        "track_age_seconds": max(0.0, instant - state["first_seen_instant"]),
                        "low_light": bool(profile.get("low_light")),
                        "velocity": tuple(velocity), "predicted": False, "direction": "approaching" if profile.get("enabled") else "unrestricted",
                        "class_status": "stable" if state["classifier"].locked else "uncertain",
                        "candidate_class": state["classifier"].candidate,
                        "counted": state["counted"], "crossing_instant": state["crossing_instant"],
                        "direction_status": direction_status,
                        "direction": ("checking" if direction_status == "checking" else
                                      "approaching" if profile.get("enabled") else "unrestricted"),
                        "motion_lengths_per_second": float(np.linalg.norm(velocity) / max(w, h, 1)),
                        "trail": list(state["trail"])})
            self.previous_candidates[group] = (instant, current_candidates)
        self.states = {key: state for key, state in self.states.items()
                       if instant - state["seen"] <= 2 and state.get("tracker_key", key) == key}
        self.previous_gray, self.previous_instant = gray, instant
        return outputs
