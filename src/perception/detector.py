"""
Vehicle Detector using OpenCV 5 DNN module with ONNX-exported YOLOv8 models.

Supports two inference backends:
  - 'opencv_dnn': Pure OpenCV via cv2.dnn.readNetFromONNX (competition-aligned)
  - 'onnxruntime': ONNX Runtime InferenceSession (performance fallback)

The detector pre-processes frames, runs inference, applies NMS, and returns
a list of Detection objects filtered to vehicle classes only.
"""
import logging
from typing import List, Optional

import cv2
import numpy as np

from src.perception.models import Detection, VEHICLE_CLASS_IDS

logger = logging.getLogger("flowsense.perception.detector")

# YOLOv8 standard input size
_INPUT_SIZE = 640


class VehicleDetector:
    """
    Detects vehicles in video frames using a YOLOv8 ONNX model.

    Parameters
    ----------
    model_path : str
        Path to the ONNX model file (e.g., ``models/yolov8n.onnx``).
    confidence_threshold : float
        Minimum confidence to keep a detection.
    nms_threshold : float
        IoU threshold for Non-Maximum Suppression.
    backend : str
        Inference backend: ``"opencv_dnn"`` or ``"onnxruntime"``.
    """

    def __init__(
        self,
        model_path: str,
        confidence_threshold: float = 0.45,
        nms_threshold: float = 0.5,
        backend: str = "opencv_dnn",
    ):
        self.model_path = model_path
        self.confidence_threshold = confidence_threshold
        self.nms_threshold = nms_threshold
        self.backend = backend

        self._net: Optional[cv2.dnn.Net] = None
        self._ort_session = None  # onnxruntime.InferenceSession

        self._load_model()

    # ------------------------------------------------------------------
    # Model loading
    # ------------------------------------------------------------------

    def _load_model(self) -> None:
        if self.backend == "opencv_dnn":
            self._load_opencv_dnn()
        elif self.backend == "onnxruntime":
            self._load_onnxruntime()
        else:
            raise ValueError(f"Unknown backend '{self.backend}'. Use 'opencv_dnn' or 'onnxruntime'.")

    def _load_opencv_dnn(self) -> None:
        logger.info(f"Loading ONNX model via OpenCV DNN: {self.model_path}")
        self._net = cv2.dnn.readNetFromONNX(self.model_path)
        # Prefer CUDA if available, otherwise CPU
        self._net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self._net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        logger.info("OpenCV DNN model loaded successfully.")

    def _load_onnxruntime(self) -> None:
        try:
            import onnxruntime as ort  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "onnxruntime is required for the 'onnxruntime' backend. "
                "Install it with: pip install onnxruntime"
            ) from exc

        logger.info(f"Loading ONNX model via ONNX Runtime: {self.model_path}")
        self._ort_session = ort.InferenceSession(
            self.model_path,
            providers=["CPUExecutionProvider"],
        )
        logger.info("ONNX Runtime session created successfully.")

    # ------------------------------------------------------------------
    # Pre-processing
    # ------------------------------------------------------------------

    @staticmethod
    def _preprocess(frame: np.ndarray) -> tuple[np.ndarray, float, float, int, int, float]:
        """
        Letterbox-resize and normalise a BGR frame for YOLOv8 input.

        Returns
        -------
        blob : np.ndarray
            (1, 3, 640, 640) float32 tensor, values in [0, 1].
        scale_x, scale_y : float
            Ratios to map detections back to the original frame dimensions.
        pad_x, pad_y : int
            Padding offsets applied along X and Y axes.
        scale : float
            Scale factor used for letterboxing.
        """
        h, w = frame.shape[:2]
        scale = min(_INPUT_SIZE / w, _INPUT_SIZE / h)
        new_w, new_h = int(w * scale), int(h * scale)

        resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

        # Pad to square canvas
        canvas = np.full((_INPUT_SIZE, _INPUT_SIZE, 3), 114, dtype=np.uint8)
        pad_y, pad_x = (_INPUT_SIZE - new_h) // 2, (_INPUT_SIZE - new_w) // 2
        canvas[pad_y : pad_y + new_h, pad_x : pad_x + new_w] = resized

        blob = cv2.dnn.blobFromImage(canvas, scalefactor=1.0 / 255.0, size=(_INPUT_SIZE, _INPUT_SIZE), swapRB=True)

        # Mapping factors: from padded 640×640 back to original resolution
        scale_x = w / new_w
        scale_y = h / new_h

        return blob, scale_x, scale_y, pad_x, pad_y, scale

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def _infer_opencv(self, blob: np.ndarray) -> np.ndarray:
        self._net.setInput(blob)
        outputs = self._net.forward()
        return outputs  # shape: (1, 84, 8400) for YOLOv8

    def _infer_onnxruntime(self, blob: np.ndarray) -> np.ndarray:
        input_name = self._ort_session.get_inputs()[0].name
        outputs = self._ort_session.run(None, {input_name: blob})
        return outputs[0]

    # ------------------------------------------------------------------
    # Post-processing (NMS + vehicle filter)
    # ------------------------------------------------------------------

    def _postprocess(
        self,
        raw_output: np.ndarray,
        scale_x: float,
        scale_y: float,
        pad_x: int,
        pad_y: int,
        scale: float,
    ) -> List[Detection]:
        """
        Applies NMS and filters detections to vehicle classes.

        YOLOv8 raw output shape: (1, 84, N) where N is the number of anchors.
        Rows 0-3: cx, cy, w, h
        Rows 4-83: class confidences (COCO 80 classes)
        """
        # Squeeze batch dimension and transpose to (N, 84)
        output = raw_output.squeeze(0)
        if output.shape[0] == 84:
            output = output.T  # (8400, 84)

        boxes = []
        confidences = []
        class_ids = []

        for row in output:
            cx, cy, w, h = row[0], row[1], row[2], row[3]
            class_scores = row[4:]
            best_class_id = int(np.argmax(class_scores))
            best_conf = float(class_scores[best_class_id])

            # Filter by confidence and vehicle class
            if best_conf < self.confidence_threshold:
                continue
            if best_class_id not in VEHICLE_CLASS_IDS:
                continue

            # Convert from center-format to top-left-format and undo letterbox
            x1 = (cx - w / 2 - pad_x) / scale
            y1 = (cy - h / 2 - pad_y) / scale
            bw = w / scale
            bh = h / scale

            boxes.append([int(x1), int(y1), int(bw), int(bh)])
            confidences.append(best_conf)
            class_ids.append(best_class_id)

        if not boxes:
            return []

        # OpenCV NMS
        indices = cv2.dnn.NMSBoxes(boxes, confidences, self.confidence_threshold, self.nms_threshold)

        detections: List[Detection] = []
        if len(indices) > 0:
            for idx in indices.flatten():
                detections.append(
                    Detection(
                        bbox=tuple(boxes[idx]),
                        class_id=class_ids[idx],
                        class_name=VEHICLE_CLASS_IDS[class_ids[idx]],
                        confidence=round(confidences[idx], 3),
                    )
                )

        return detections

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect(self, frame: np.ndarray) -> List[Detection]:
        """
        Run full detection pipeline on a single BGR frame.

        Parameters
        ----------
        frame : np.ndarray
            Input image in BGR colour space (as returned by ``cv2.imread``).

        Returns
        -------
        List[Detection]
            Detected vehicles with bounding boxes mapped to original frame coordinates.
        """
        blob, scale_x, scale_y, pad_x, pad_y, scale = self._preprocess(frame)

        if self.backend == "opencv_dnn":
            raw = self._infer_opencv(blob)
        else:
            raw = self._infer_onnxruntime(blob)

        return self._postprocess(raw, scale_x, scale_y, pad_x, pad_y, scale)
