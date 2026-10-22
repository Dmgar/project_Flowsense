# Continuous Video and Vehicle Detection — Approval Plan

Status: Approved by the user and implemented. This document records the approved
design; see [delivery and measured verification](CONTINUOUS_VIDEO_DELIVERY.md) for
the final behavior, results and remaining limits.

## Intended experience

Opening a camera immediately starts a real video session. Vehicles move continuously while tracking boxes and IDs follow them. Counts update from that same session. Camera details, the observation desk, catalog previews and map camera previews use video or an explicit connection state; they never display refreshed JPEGs as camera playback.

All new interface text, errors, documentation and controls will be in English.

## What the current code actually does

- `frontend/src/product/CameraEvidence.tsx` defaults to an image with detection and refreshes according to the camera interval, commonly 120 seconds. Video is an optional separate mode. Its own message states that counts refer to the analyzed image rather than the playing video.
- `frontend/src/product/ObservationDesk.tsx` and `CameraThumb` display snapshot images.
- `frontend/src/product/PublicVideoPlayer.tsx` already supports HLS playback and recovery, but failure returns the view to periodic images.
- `src/services/mobility_service.py` captures and caches individual images. Even RTSP/webcam connections currently read one frame and close the capture.
- `src/perception/pipeline.py` can process a video and annotate an OpenCV debug window, but does not publish that annotated video to the browser. Inference blocks its processing loop, intermediate tracking needs implementation, and file playback is not paced to source timestamps.
- `src/api/routes/perception.py` registers a pipeline on start without scheduling continuous processing.
- The checked-in catalog contains 86 cameras: 71 have video links and 15 have none. Six records contain an HLS status of 200. These are stored catalog values, not a fresh playback or availability check. An installed `models/yolov8n.onnx` file is present; model execution has not been tested for this plan.

## Recommended architecture

```text
Real video source: RTSP / HLS / webcam
                 |
      Persistent decoder + source timestamps
                 |
      Bounded recent-frame buffer
                 |
      Vehicle detector + per-camera tracker
                 |
      Annotated video compositor
                 |
      Encoded WebRTC media track
                 |
      Browser <video> player

Same processing session --> timestamped metrics --> live counters/status
```

Use Python `aiortc` and PyAV/FFmpeg alongside the existing FastAPI backend. Reuse the existing detector and improve the existing tracker. Draw boxes, IDs and compact class counts into the outgoing video so that annotations correspond to the displayed image. Browser rendering uses an actual media track, not JPEG polling, MJPEG, or a WebSocket slideshow.

WebRTC is the proposed browser delivery transport. HLS remains an input when provided by the source. Converting HLS to WebRTC cannot remove delay already introduced upstream. Verify Python/Windows wheels and codec support before committing dependency versions. Local deployment is the initial target; remote deployment requires a tested ICE/STUN/TURN configuration and transport access.

Technical basis: the [aiortc server example](https://github.com/aiortc/aiortc/blob/main/examples/server/server.py) demonstrates transforming received frames into a video track. [aiortc media helpers](https://aiortc.readthedocs.io/en/latest/helpers.html) document player and relay components. [FFmpeg protocol documentation](https://ffmpeg.org/ffmpeg-protocols.html) describes input transport and timeout options. These establish implementation building blocks, not measured performance for this project.

### Keep movement independent of inference speed

- Run decoding, inference and output scheduling outside the API event loop, with bounded queues. Start with one inference worker and measure before increasing concurrency.
- Pace output using media timestamps. Publish current video at the source rate when practical; target 20–30 FPS for sources providing it.
- Schedule detection initially at 5–10 updates/second when hardware permits. Update tracking between detections using motion prediction or optical flow, with timestamps, expiry and confidence decay. The current code does not yet implement this intermediate update.
- Discard stale queued work rather than building an increasing delay. Never apply late detections to a newer unrelated image. Reset tracking after reconnects or source discontinuities.
- Expire old boxes and mark analysis unavailable if inference stops. Video may continue with `Detection unavailable`; counters become unavailable rather than retaining old readings as current.
- Use one capture/inference session per camera and share its processed output across viewers. Bound relay buffers and admission to prevent four views from creating unlimited inference work.
- Include session ID, sequence, media time, inference age and monotonic processing timing in telemetry. Burn the primary count into the video; synchronize sidebar counts to playout where supported and show their sample age. Suppress stale or future counters instead of claiming exact synchronization from WebSocket arrival time.

## Video-only source policy

1. Probe for a decodable video track and advancing presentation timestamps. A video URL or HTTP 200 alone does not establish working playback.
2. Exclude image-only sources from video camera lists, map previews, favorites playback and the observation desk. Keep their registration records internally; old links display `Video not supported` and offer available video cameras.
3. Accept connected RTSP/HLS/webcam sources through the persistent video path. Reject still-image URLs for video registration. The first milestone uses existing registered sources and local test fixtures; it does not add arbitrary remote URL access.
4. Show `Connecting`, `Live`, `Buffering`, `Reconnecting`, `Video unavailable`, `Detection unavailable` or `Recorded playback` as appropriate.
5. On interruption, use bounded reconnect attempts and clear stale analysis. Cover or clear any retained last image once failure is declared. Never fall back to snapshots or leave a frozen scene marked `Live`.
6. Accept local video files for reproducible testing and optional recorded playback, clearly labeled `Recorded playback`. Never substitute a recording for a failed live camera.

## Interface changes

| Area | Proposed behavior |
| --- | --- |
| Camera detail | Annotated video by default; play/pause, reconnect, fullscreen, class filter and confidence controls |
| Counters | Current visible vehicles by class and active track IDs; no cumulative flow claim without a separate counting rule |
| Catalog/explorer | Video-capable sources only; bounded, muted visible previews; neutral unloaded tiles instead of image posters |
| Observation desk | Up to four actual video sessions, with measured capacity and explicit limits |
| Map previews and shared thumbnails | Reuse the same video component; start only the selected/visible preview |
| Evidence review | Session and media timestamps replace the photo timeline and `Save frame` action; export metadata remains available |

Apply class and confidence controls to the compositor and counts consistently. Because an annotated stream is shared, use shared camera analysis settings initially and identify them in the UI; independent per-viewer rendering/settings require an additional design. Preserve existing case records and historical evidence references. Do not silently convert old photo evidence into video evidence.

Video recording, retention and clip export are a separate feature. They are not required to deliver continuous live detection and will not be promised by this change.

## Implementation sequence and review gates

### 1. Prove one continuous annotated video

Validate runtime dependencies, model output and a selected video source. Implement the session manager, persistent decode, timestamp handling, inference, intermediate tracking, compositor and WebRTC negotiation. Make perception start/stop actually own background work and clean up failed tasks, peer connections and source handles.

Proposed API surface: create/join a camera video session; exchange WebRTC offer/answer; read session status/metrics; leave the session. Resolve camera IDs on the server. Stop idle sessions after a short grace period, reclaim resources at shutdown, and apply connection/decode timeouts. Keep the existing observation APIs compatible with stored cases while removing them from active video views.

Review gate: one camera plays continuously with moving tracked boxes and matching in-video counts. Show measured FPS, inference rate, dropped frames and delay before expanding scope.

### 2. Replace snapshot camera surfaces

Build a reusable `LiveCameraPlayer`, integrate camera detail, remove image/video toggles and snapshot fallback, then migrate the desk, explorer, catalog and map previews. Remove photo controls from active camera workflows. Audit API errors and UI copy for English.

Review gate: the user can open a camera, follow vehicles in motion, pause/resume and reconnect without encountering a photo mode.

### 3. Capacity, failure recovery and regression verification

Add source admission limits, visibility-aware subscriptions and resolution presets. Test four sessions if the measured hardware capacity supports them. Show an explicit capacity message when it does not. Verify repeated source switches, disconnects and reconnects leave no background sessions running.

Run appropriate backend tests plus `npm test`, `npm run build` and `npm run lint`. Add behavioral tests for session lifecycle, stale metadata, queue bounds and video-only failure states. Validate actual decoded playback in the browser separately from compilation.

## Acceptance criteria

- A moving test video advances continuously in a browser `<video>` with boxes following vehicles. No repeated `/snapshot` or `/observation` requests drive active playback.
- For a controlled 25/30 FPS source, initial target is at least 20 rendered FPS at 720p with one camera. Report achieved rates; reduce resolution or adjust the design if the target fails. Never duplicate still images to claim this rate.
- For a controlled local source, initial latency target is at most 1 second under normal load. Measure with a source-visible clock; report provider/HLS delay separately and do not promise subsecond public HLS playback.
- A five-minute single-camera run does not develop an increasing backlog. Record decode/output FPS, inference rate, queue age and dropped-frame count.
- A four-camera five-minute run reports per-camera results, API responsiveness and resource use. It passes only if the agreed stream preset stays continuous; otherwise capacity remains explicitly limited.
- Stable IDs are evaluated on a short traffic clip, including crossings and occlusion. Document ID switches and limitations rather than claiming perfect tracking.
- A source outage changes the state, clears stale detections, never triggers a photo fallback and recovers when the same source returns. An inference outage keeps available video playing with unavailable counts.
- Recorded playback is paced correctly, handles end-of-file explicitly and is visibly labeled. Pausing never leaves a misleading `Live` state.
- Initial viewport, fullscreen and responsive sizes show aligned annotations. All new visible strings and API failure messages are English.

## Decision to validate

Approve a video-only camera experience with WebRTC delivery, server-annotated vehicle tracking, honest source availability and no image fallback. Deliver one working camera for review first, then migrate all camera surfaces and validate multi-camera capacity. Source availability and hardware performance remain measurements to establish during implementation.
