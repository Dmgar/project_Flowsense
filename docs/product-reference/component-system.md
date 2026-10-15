# Component System

This is a pragmatic component inventory for a hackathon frontend. Build reusable primitives first, then compose screens from them.

## Layout Components

### `AppShell`

Persistent shell with left navigation, top bar, and main content region.

Props:

- `activeRoute`
- `user`
- `systemStatus`
- `children`

### `TopBar`

Search, time range, district filter, status, notifications, and profile menu.

Props:

- `searchPlaceholder`
- `timeRange`
- `district`
- `systemStatus`
- `onSearch`
- `onTimeRangeChange`

### `SideNav`

Icon navigation for all modules.

Routes:

- `/overview`
- `/map`
- `/cameras/:cameraId`
- `/corridors/:corridorId`
- `/hotspots`
- `/pedestrians`
- `/risk-signals`
- `/emergency-corridor`
- `/reports`
- `/settings`

## Map Components

### `CityMap`

Shared map wrapper. Use Mapbox, Leaflet, or a simple static canvas for hackathon speed.

Props:

- `center`
- `zoom`
- `layers`
- `markers`
- `selectedId`

### `RoadSegmentOverlay`

Draws road segments by score.

Color rules:

- Green: normal flow.
- Amber: moderate congestion or review.
- Red: high congestion, blockage, or severe signal.
- Cyan: selected or recommended corridor.

### `CameraMarker`

Marker for camera location and health.

States:

- `online`
- `degraded`
- `offline`
- `selected`

### `SignalMarker`

Marker for hotspots and risk signals.

Props:

- `signalType`
- `severity`
- `confidence`
- `status`

## Evidence Components

### `CameraPlayer`

Video or image sequence panel.

Props:

- `streamUrl`
- `mode`: `live | playback`
- `timestamp`
- `overlays`
- `privacyBlurEnabled`

### `DetectionOverlayCanvas`

Draws bounding boxes and labels on top of video.

Props:

- `detections`
- `enabledClasses`
- `confidenceThreshold`

### `TimelineScrubber`

Scrubber with event markers.

Props:

- `duration`
- `currentTime`
- `events`
- `onSeek`

### `EvidenceThumbnailGrid`

Displays camera snapshots for quick review.

Props:

- `items`
- `selectedEvidenceId`
- `onSelect`

## Analytics Components

### `MetricCard`

Reusable KPI tile.

Props:

- `label`
- `value`
- `unit`
- `delta`
- `trend`
- `severity`

### `TrendLineChart`

Line chart for speed, congestion, crossings, or review time.

Props:

- `series`
- `baselineSeries`
- `xLabel`
- `yLabel`

### `StackedMixBar`

Vehicle or mode share comparison.

Props:

- `segments`
- `baselineSegments`

### `InsightDrawer`

Right-side narrative diagnostics.

Props:

- `title`
- `insights`
- `recommendedNextCheck`
- `actions`

## Tables And Queues

### `HotspotTable`

Ranked operational issue list.

Columns:

- Rank
- Location
- Issue type
- Severity
- Evidence
- Impact
- Confidence
- Suggested action
- Owner

### `SignalQueueTable`

Risk signal review queue.

Columns:

- Signal
- Location
- Severity
- Confidence
- Evidence
- Duration
- Status

### `StatusBadge`

Shared badge for workflow states.

Values:

- `new`
- `human_review_required`
- `under_review`
- `assigned`
- `confirmed`
- `resolved`
- `dismissed`

## Action Components

### `ReviewActionBar`

Actions for a selected hotspot or risk signal.

Buttons:

- `Assign Review`
- `Open Case`
- `Mark Resolved`
- `Dismiss`
- `Export Evidence`

### `ReportExport`

Export module for PDF/CSV.

Props:

- `reportType`
- `dateRange`
- `format`

## Visual Rules

- Radius: 8px or less.
- Do not nest cards inside cards.
- Use icons for nav, actions, and status.
- Keep dashboards dense but readable.
- Avoid decorative gradients or blobs.
- Use short labels. Long explanations belong in drawers or tooltips.
