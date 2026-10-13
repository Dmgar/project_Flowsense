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
    def _preprocess(frame: np.ndarray) -> tuple[np.ndarray, int, int, float, int, int]:
        """
        Letterbox-resize and normalise a BGR frame for YOLOv8 input.

        Returns
        -------
        blob : np.ndarray
            (1, 3, 640, 640) float32 tensor, values in [0, 1].
        pad_x, pad_y : int
            Padding offsets applied along X and Y axes.
        scale : float
            Scale factor used for letterboxing.
        orig_w, orig_h : int
            Original frame width and height for coordinate clamping.
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

        return blob, pad_x, pad_y, scale, w, h

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
    # Post-processing (Vectorized NMS + vehicle filter)
    # ------------------------------------------------------------------

    def _postprocess(
        self,
        raw_output: np.ndarray,
        *args,
        orig_w: Optional[int] = None,
        orig_h: Optional[int] = None,
        **kwargs,
    ) -> List[Detection]:
        """
        Applies vectorized NMS and filters detections to vehicle classes.

        YOLOv8 raw output shape: (1, 84, N) where N is the number of anchors.
        Rows 0-3: cx, cy, w, h
        Rows 4-83: class confidences (COCO 80 classes)
        """
        # Parse arguments supporting modern (raw, pad_x, pad_y, scale)
        # and legacy (raw, scale_x, scale_y, pad_x, pad_y, scale)
        if len(args) == 5:
            pad_x = int(args[2])
            pad_y = int(args[3])
            scale = float(args[4])
        elif len(args) == 3:
            pad_x = int(args[0])
            pad_y = int(args[1])
            scale = float(args[2])
        else:
            pad_x = int(kwargs.get("pad_x", args[0] if len(args) > 0 else 0))
            pad_y = int(kwargs.get("pad_y", args[1] if len(args) > 1 else 0))
            scale = float(kwargs.get("scale", args[2] if len(args) > 2 else 1.0))

        if scale <= 0.0:
            scale = 1.0

        # Squeeze batch dimension and transpose to (N, 84)
        output = raw_output.squeeze(0)
        if output.ndim == 2 and output.shape[0] == 84:
            output = output.T  # (8400, 84)

        if output.ndim != 2 or len(output) == 0:
            return []

        # 1. Vectorized class scores, predictions, and confidences
        class_scores = output[:, 4:]  # (N, 80)
        class_ids = np.argmax(class_scores, axis=1)  # (N,)
        confidences = class_scores[np.arange(len(output)), class_ids]  # (N,)

        # 2. Vectorized boolean mask for confidence and vehicle class filtering
        vehicle_class_keys = list(VEHICLE_CLASS_IDS.keys())
        mask = (confidences >= self.confidence_threshold) & np.isin(class_ids, vehicle_class_keys)

        if not np.any(mask):
            return []

        # Filter candidates
        cand_output = output[mask]
        cand_conf = confidences[mask]
        cand_class_ids = class_ids[mask]

        # 3. Vectorized coordinate transformation
        cx = cand_output[:, 0]
        cy = cand_output[:, 1]
        w = cand_output[:, 2]
        h = cand_output[:, 3]

        x1 = (cx - w / 2.0 - pad_x) / scale
        y1 = (cy - h / 2.0 - pad_y) / scale
        bw = w / scale
        bh = h / scale

        # Optional clamp to image boundaries
        if orig_w is not None and orig_h is not None and orig_w > 0 and orig_h > 0:
            x1 = np.clip(x1, 0, orig_w - 1)
            y1 = np.clip(y1, 0, orig_h - 1)
            bw = np.clip(bw, 1, orig_w - x1)
            bh = np.clip(bh, 1, orig_h - y1)

        boxes = np.column_stack([
            np.round(x1).astype(int),
            np.round(y1).astype(int),
            np.round(bw).astype(int),
            np.round(bh).astype(int),
        ]).tolist()

        conf_list = cand_conf.astype(float).tolist()
        class_id_list = cand_class_ids.astype(int).tolist()

        # OpenCV NMS
        indices = cv2.dnn.NMSBoxes(boxes, conf_list, self.confidence_threshold, self.nms_threshold)

        detections: List[Detection] = []
        if len(indices) > 0:
            for idx in indices.flatten():
                detections.append(
                    Detection(
                        bbox=tuple(boxes[idx]),
                        class_id=class_id_list[idx],
                        class_name=VEHICLE_CLASS_IDS[class_id_list[idx]],
                        confidence=round(conf_list[idx], 3),
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
        blob, pad_x, pad_y, scale, orig_w, orig_h = self._preprocess(frame)

        if self.backend == "opencv_dnn":
            raw = self._infer_opencv(blob)
        else:
            raw = self._infer_onnxruntime(blob)

        return self._postprocess(raw, pad_x=pad_x, pad_y=pad_y, scale=scale, orig_w=orig_w, orig_h=orig_h)
