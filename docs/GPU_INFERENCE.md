# GPU inference

FlowSense uses ONNX Runtime for model inference and OpenCV for video capture,
image preparation, drawing and tracking. ONNX Runtime selects its NVIDIA CUDA
execution provider when the installed runtime and driver support it, then keeps
the CPU provider available for unsupported operations. If CUDA cannot initialize,
the detector logs the reason and retries on CPU.

The standard `requirements.txt` keeps a CPU-only ONNX Runtime installation for
portable setup. On Windows x64 with a supported NVIDIA GPU, install the optional
GPU distribution in the project virtual environment. The CPU and GPU distributions
share the `onnxruntime` import name, so replace the CPU package first:

```powershell
.venv\Scripts\python.exe -m pip uninstall -y onnxruntime
.venv\Scripts\python.exe -m pip install -r requirements-gpu.txt
```

The GPU requirements include the CUDA and cuDNN runtime packages. A compatible
NVIDIA driver is still required. Restart FlowSense after changing the runtime.
The Windows launcher selects this GPU package during `-Setup` when `nvidia-smi`
is available and restores CPU ONNX Runtime if CUDA installation fails.
Open a camera's evidence review and check **Session health → Inference engine**;
`CUDAExecutionProvider` confirms that inference is using the GPU, while
`CPUExecutionProvider` means the automatic fallback is active.

The camera player continues to report measured inference updates per second. GPU
acceleration can make higher-resolution or more frequent inference practical, but
it does not correct model misses, prove class accuracy, or replace labeled
camera-specific precision and recall evaluation.

## Low-light resolution selection

The 640-pixel BDD100K model remains the default for CPU-only and multi-camera
sessions. When a single low-light camera is active and both BDD models use CUDA,
FlowSense runs the optional 960-pixel export on every third analyzed frame to give
distant vehicles more image detail. It returns to 640 pixels for the other frames,
when another camera is monitored, when less than 2 GB of physical memory is
available, or when the high-resolution model is missing or unavailable.

A paired 60-frame sample from camera 1031 produced 88 versus 102 road candidates
at confidence 0.20 for 640 and 960 input respectively, with 65 versus 74 tracked
observations. Measured inference rates on the RTX 3050 were 14.0 and 6.4 updates
per second when running each size on every frame. At confidence 0.30 both models
produced 57 candidates. The selected one-in-three 960 cadence produced 92
candidates at confidence 0.20 and 82 tracked observations at 11.1 updates per
second; it produced 54 candidates at confidence 0.30. These unlabeled frames do
not prove greater recall or class accuracy. The adaptive profile keeps 640-pixel
analysis on the other frames and adds detail evidence without paying the
full-resolution cost each time.

## Daytime road-zone detail

For a single active camera with CUDA, an enabled directional road zone, and a
local `models/yolo11s-1280.onnx` file, the standard-light profile can add a
1280-pixel YOLO11s pass over one far-road crop on every third analyzed frame.
The 640-pixel model still runs on every update; the detail boxes are merged with its boxes, and model
identity reports both files. CPU-only, multi-camera, unzoned, or missing-model
sessions, and sessions with less than 2 GB of available physical memory, continue
with the base detector. If loading or running the detail model fails, the current
frame retains the base-model detections.

Regression tests verify this gating and that supplemental detections do not
replace existing boxes. The model loads with `CUDAExecutionProvider` and accepts
1280-pixel inputs. This is an inference-path check, not proof of higher real-road
recall or correct bus/truck labels; camera-specific labeled video is still
required to measure those outcomes.
