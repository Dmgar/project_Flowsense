"""Full-scene and overlapping-detail inference for small CCTV road users."""
import cv2
import numpy as np

from src.perception.models import Detection
from src.perception.tracker import _iou

LOW_LIGHT_DETAIL_GAMMA_LUT = np.round((np.arange(256) / 255.) ** .65 * 255).astype(np.uint8)


def is_low_light(frame):
    """Identify dark CCTV scenes from pixels, independent of server timezone."""
    gray = cv2.cvtColor(cv2.resize(frame, (256, 144)), cv2.COLOR_BGR2GRAY)
    return bool(np.median(gray) < 112 and np.percentile(gray, 10) < 65)


class DetectionBatch(list):
    """Carry the actual inference model/profile alongside its candidates."""
    def __init__(self, items, model_name, profile, execution_provider=None):
        super().__init__(items)
        self.model_name, self.profile = model_name, profile
        self.execution_provider = execution_provider


def detect_low_light(detector, frame):
    """Retain whole-vehicle context and combine original and mild gamma views.

    Enhancement is only a second view: original evidence is never replaced.
    Both views are one observation in time, not two tracking confirmations.
    """
    lut = np.round((np.arange(256) / 255.) ** .65 * 255).astype(np.uint8)
    merged = merge_detections([*detector.detect(frame), *detector.detect(cv2.LUT(frame, lut))],
                              threshold=detector.confidence_threshold)
    return reject_headlight_fragments(merged)


def reject_headlight_fragments(detections):
    """Reject a narrow nested vehicle box when a complete car supports it.

    Night glare can yield both a whole-car box and a separate front/headlight
    box; ordinary IoU NMS misses that containment. Preserve adjacent vehicles
    and riders, and require aligned road-contact anchors for suppression.
    """
    result = []
    for item in detections:
        x,y,w,h = item.bbox
        duplicate = False
        if item.class_name in ('car','bus','truck'):
            for parent in detections:
                if parent is item or parent.class_name not in ('car','bus','truck') or parent.confidence < .20:
                    continue
                px,py,pw,ph = parent.bbox
                intersection = max(0,min(x+w,px+pw)-max(x,px))*max(0,min(y+h,py+ph)-max(y,py))
                if pw >= 1.4*w and pw*ph >= 1.4*w*h and intersection/max(1,w*h) >= .85 and abs(y+h-py-ph) <= .2*ph:
                    duplicate = True
                    break
        if not duplicate:
            result.append(item)
    return result


def merge_detections(detections, threshold=.15, overlap=.5):
    """Merge tile duplicates, retaining people overlapping their bicycle/vehicle.

    Competing vehicle labels for the same box are suppressed together; a rider
    and a bicycle are separate objects and must not suppress one another.
    """
    result = []
    for people in (False, True):
        candidates = [item for item in detections if (item.class_name in {"pedestrian", "rider"}) == people]
        if not candidates:
            continue
        keep = cv2.dnn.NMSBoxes([item.bbox for item in candidates], [item.confidence for item in candidates], threshold, overlap)
        for index in np.asarray(keep).reshape(-1):
            winner = candidates[int(index)]
            views = [item for item in candidates if _iou(item.bbox, winner.bbox) >= overlap and item.class_scores]
            if views:
                keys = {key for item in views for key in item.class_scores}
                weights = np.array([item.confidence for item in views])
                scores = {key: float(np.average([item.class_scores.get(key, 0) for item in views], weights=weights)) for key in keys}
                winner = Detection(winner.bbox, winner.class_id, winner.class_name, winner.confidence, scores)
            result.append(winner)
    return sorted(result, key=lambda item: item.confidence, reverse=True)


class TrafficDetector:
    """Reuse one model; preserve full-scene coverage and examine three detail crops."""
    def __init__(self, detector, enable_crops=None):
        self.detector = detector
        provider = getattr(detector, "execution_provider", None)
        if enable_crops is not None:
            self.enable_crops = enable_crops
        else:
            self.enable_crops = provider == "CUDAExecutionProvider" or provider is None

    def detect(self, frame, zone=None, enhance_detail=False):
        if zone and zone.get("enabled"):
            return self.detect_road(frame, zone, enhance_detail=enhance_detail)
        detections = list(self.detector.detect(frame))
        height, width = frame.shape[:2]
        if not self.enable_crops or max(width, height) < 960:
            return detections
        side = min(640, height, width)
        if width >= height:
            regions = [(x, (height - side) // 2) for x in sorted({0, (width - side) // 2, width - side})]
        else:
            regions = [((width - side) // 2, y) for y in sorted({0, (height - side) // 2, height - side})]
        for x, y in regions:
            for item in self.detector.detect(frame[y:y + side, x:x + side]):
                bx, by, bw, bh = item.bbox
                # Internal crop boundaries can cut a car in half. A confident
                # fragment must not replace the complete box from another view.
                margin = 4
                if ((x > 0 and bx <= margin) or
                    (y > 0 and by <= margin) or
                    (x + side < width and bx + bw >= side - margin) or
                    (y + side < height and by + bh >= side - margin)):
                    continue
                detections.append(Detection((bx + x, by + y, bw, bh), item.class_id, item.class_name, item.confidence, item.class_scores))
        return merge_detections(detections, threshold=self.detector.confidence_threshold)

    def detect_road(self, frame, zone, enhance_detail=False):
        """Spend two passes on the monitored carriageway, including its far end."""
        height, width = frame.shape[:2]
        points = np.asarray(zone["polygon"]) * (width, height)
        left, top = np.maximum(0, points.min(axis=0).astype(int) - 16)
        right, bottom = np.minimum((width, height), points.max(axis=0).astype(int) + 16)
        apex = points[np.argsort(points[:, 1])[:2]].mean(axis=0)
        side = min(480, height, width)
        # The whole-zone crop preserves broad coverage but can shrink distant
        # cars to only a few model pixels. Rotate the second, detail crop along
        # the inbound road so the same inference pass periodically sees more
        # pixels from the far, middle, and near portions of a long corridor.
        # Keep the cursor on the per-session zone; the shared detector can serve
        # multiple cameras without making their crop schedules interfere.
        road_center = points.mean(axis=0)
        travel = road_center - apex
        cursor = int(zone.get("_detail_crop_cursor", 0)) % 3
        zone["_detail_crop_cursor"] = (cursor + 1) % 3
        center = apex + travel * (.9 * cursor)
        detail_x = int(np.clip(center[0] - side / 2, 0, width - side))
        detail_y = int(np.clip(center[1] - side / 4, 0, height - side))
        regions = [(int(left), int(top), int(right), int(bottom)),
                   (detail_x, detail_y, detail_x + side, detail_y + side)]
        detections = []
        for region_index, (x, y, x2, y2) in enumerate(regions):
            crop = frame[y:y2, x:x2]
            # Keep broad original-scene evidence and brighten the rotating
            # detail crop for dark small vehicles without another model pass.
            if enhance_detail and region_index == 1:
                crop = cv2.LUT(crop, LOW_LIGHT_DETAIL_GAMMA_LUT)
            for item in self.detector.detect(crop):
                bx, by, bw, bh = item.bbox
                if ((x > 0 and bx <= 3) or (y > 0 and by <= 3) or
                    (x2 < width and bx + bw >= x2 - x - 3) or (y2 < height and by + bh >= y2 - y - 3)):
                    continue
                detections.append(Detection((bx + x, by + y, bw, bh), item.class_id,
                    item.class_name, item.confidence, item.class_scores))
        return merge_detections(detections, threshold=self.detector.confidence_threshold)

    def detect_far_road(self, frame, zone):
        """Run a single high-detail pass where distant vehicles occupy few pixels."""
        height, width = frame.shape[:2]
        points = np.asarray(zone["polygon"]) * (width, height)
        apex = points[np.argsort(points[:, 1])[:2]].mean(axis=0)
        side = min(480, height, width)
        if side < 1:
            return []
        x = int(np.clip(apex[0] - side / 2, 0, width - side))
        y = int(np.clip(apex[1] - side / 4, 0, height - side))
        detections = []
        for item in self.detector.detect(frame[y:y + side, x:x + side]):
            bx, by, bw, bh = item.bbox
            if ((x > 0 and bx <= 3) or (y > 0 and by <= 3)
                    or (x + side < width and bx + bw >= side - 3)
                    or (y + side < height and by + bh >= side - 3)):
                continue
            detections.append(Detection((bx + x, by + y, bw, bh), item.class_id,
                item.class_name, item.confidence, item.class_scores))
        return merge_detections(detections, threshold=self.detector.confidence_threshold)
