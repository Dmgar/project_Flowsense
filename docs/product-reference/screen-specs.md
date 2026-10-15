# Screen Specs

Each screen below maps one generated image to a buildable frontend view.

## Shared App Shell

Use this app shell across all operational screens:

- Left navigation: Overview, Live Map, Cameras, Corridors, City Hotspots, Pedestrian Flow, Risk Signals, Emergency Corridor, Reports, Settings.
- Top bar: search, district filter, time range, system status, user menu.
- Main content: map, table, video, or analytics depending on route.
- Right panel: selected detail, insights, evidence, or action workflow.
- Visual style: dark civic-tech operations UI, high contrast text, cyan active states, green healthy states, amber review states, red severe states.

---

## 01 Live City Map

Image: `assets/01-live-city-map.png`

### Purpose

This is the platform home screen. It gives city operators a citywide view of traffic flow, camera coverage, corridor status, and current mobility signals.

### Primary User

Mobility operations manager.

### Primary Question

What is happening in the city right now, and where should I look first?

### Main UI Regions

- Left navigation.
- Full map canvas with road segment coloring.
- Layer toggles for vehicles, pedestrians, freight, cameras, incidents, and congestion.
- Mobility signals side panel.
- Summary metric cards.
- Camera and corridor markers.

### Core Components

- `AppShell`
- `CityMap`
- `MapLayerToggle`
- `RoadSegmentOverlay`
- `CameraMarker`
- `SignalMarker`
- `MetricCard`
- `MobilitySignalPanel`
- `TimeRangeSelector`

### Data Needed

- Road segments with geometry and congestion score.
- Camera locations and health.
- Latest vehicle counts by class.
- Pedestrian density by zone.
- Freight share by corridor.
- Active hotspots and risk signals.

### Interactions

- Toggle layers on and off.
- Click a camera marker to open Camera Evidence.
- Click a road segment to open Corridor Analytics.
- Click a signal card to open City Hotspots or Incident & Risk Signals.
- Change time range.

### States

- Normal city status.
- Degraded camera coverage.
- High congestion corridor.
- Active incident/risk signals.
- Empty data or no cameras in district.

### Acceptance Criteria

- User can identify the highest-priority mobility signals within 10 seconds.
- Clicking a camera, corridor, or alert routes to the right detail view.
- Layer toggles visibly change the map state.

---

## 02 Camera Evidence

Image: `assets/02-camera-evidence.png`

### Purpose

Shows the evidence behind a selected camera: video feed, detection overlays, counts, class mix, lane occupancy, timeline, and camera health.

### Primary User

Traffic analyst or operator reviewing evidence.

### Primary Question

What is this camera seeing, and can I trust the detection signal?

### Main UI Regions

- Camera header with location, status, weather, and timestamp.
- Large video panel with detection overlays.
- Detected movement metrics panel.
- Vehicle mix chart.
- Lane occupancy bars.
- Speed, pedestrian flow, and heavy vehicle share cards.
- Timeline scrubber with event markers.
- Camera health section.

### Core Components

- `CameraPlayer`
- `DetectionOverlayCanvas`
- `ObjectLabel`
- `TimelineScrubber`
- `VehicleMixChart`
- `LaneOccupancyMeter`
- `CameraHealthCard`
- `EvidenceSnapshotStrip`

### Data Needed

- Camera metadata.
- Video frame or stream URL.
- Bounding boxes by object class.
- Confidence score per detection.
- Aggregate counts by class.
- Lane occupancy.
- Average speed.
- Timeline events.
- Camera health and uptime.

### Interactions

- Play/pause video.
- Scrub through last N minutes.
- Toggle overlay classes.
- Open camera on map.
- Expand video.
- Export evidence snapshot.

### States

- Live camera.
- Archived playback.
- Low confidence detections.
- Camera offline.
- Privacy blur enabled.

### Acceptance Criteria

- Detection overlays align with video frame.
- Counts and charts reflect the selected time window.
- UI clearly indicates privacy-safe aggregation and blur.

---

## 03 Corridor Analytics

Image: `assets/03-corridor-analytics.png`

### Purpose

Diagnoses one road corridor over time: congestion, average speed, vehicle mix, truck pressure, pedestrian crossings, queue length, and baseline comparison.

### Primary User

Traffic operations analyst.

### Primary Question

Why is this corridor under pressure, and what changed against baseline?

### Main UI Regions

- Corridor header and time range.
- Corridor map strip with colored segments.
- KPI cards.
- Trend charts.
- Vehicle mix comparison.
- Right insight drawer with "What changed" and suggested next check.

### Core Components

- `CorridorMapStrip`
- `SegmentTooltip`
- `KpiCard`
- `TrendLineChart`
- `StackedMixBar`
- `InsightDrawer`
- `BaselineToggle`

### Data Needed

- Corridor ID and geometry.
- Segment-level congestion score.
- Average speed by time bucket.
- Vehicle class mix.
- Truck pressure index.
- Pedestrian crossing volume.
- Queue length estimate.
- Baseline values.

### Interactions

- Select a segment.
- Toggle baseline comparison.
- Change date range.
- Open signal analytics or camera evidence.
- Export corridor report.

### States

- Normal vs elevated congestion.
- Baseline comparison on/off.
- Partial camera coverage.
- No baseline available.

### Acceptance Criteria

- User can see which segment is causing the corridor issue.
- Charts distinguish current period from baseline.
- Insight drawer recommends a concrete next check, not an automatic decision.

---

## 04 City Hotspots

Image: `assets/04-city-hotspots.png`

### Purpose

Ranks citywide mobility issues so teams can prioritize review and action.

### Primary User

Mobility operations manager.

### Primary Question

Which city problems should we review first today?

### Main UI Regions

- Filters for district, issue type, severity, and date.
- Ranked table of hotspots.
- Selected hotspot detail drawer.
- Map snippet.
- Evidence thumbnails.
- Supporting signals.
- Suggested next check.
- Pilot KPI card.

### Core Components

- `HotspotTable`
- `SeverityBadge`
- `ConfidenceMeter`
- `Sparkline`
- `IssueTypeIcon`
- `DetailDrawer`
- `OwnerPill`
- `OpenCaseButton`

### Data Needed

- Hotspot ID.
- Location and district.
- Issue type.
- Severity.
- Evidence metric.
- Impact vs typical.
- Confidence score.
- Suggested action.
- Owner/team.
- Pilot KPI target.

### Interactions

- Sort by impact, confidence, severity, or age.
- Filter issue types.
- Select a row to open detail.
- Open case.
- Generate report.
- Assign owner.

### States

- New issue.
- Under review.
- Assigned.
- Resolved.
- Low confidence.

### Acceptance Criteria

- Table is scannable and operational, not decorative.
- Every suggested action is framed as a review or next check.
- Selected row and detail drawer stay in sync.

---

## 05 Emergency Corridor

Image: `assets/05-emergency-corridor.png`

### Purpose

Shows road intelligence for an emergency route: route reliability, delay risk, camera-confirmed checkpoints, bottlenecks, and backup corridor.

### Primary User

Emergency operations liaison or traffic operator.

### Primary Question

Which corridor is most reliable right now, and where are the road risks?

### Main UI Regions

- Incident header.
- Route map.
- Primary and backup route overlays.
- Blocked or unavailable segments.
- Corridor checkpoint strip.
- Road intelligence panel.
- Decision support note.

### Core Components

- `RouteMap`
- `RouteReliabilityCard`
- `CheckpointStrip`
- `CameraConfirmationCard`
- `DelayRiskCard`
- `BackupRoutePanel`
- `DecisionSupportNotice`

### Data Needed

- Origin and destination.
- Candidate routes.
- Segment congestion and closure state.
- ETA range.
- Route reliability score.
- Camera confirmation along route.
- Delay reason and risk.

### Interactions

- Switch primary/backup route.
- Open checkpoint camera.
- Inspect bottleneck segment.
- Send suggested traffic ops action.

### States

- Primary route clear.
- Primary route degraded.
- Backup route available.
- Camera confirmation missing.
- Road closure.

### Acceptance Criteria

- UI says decision support, not dispatch control.
- ETA is shown as a range or confidence, not exact certainty.
- Backup route is visible and understandable.

---

## 06 Pedestrian Flow

Image: `assets/06-pedestrian-flow.png`

### Purpose

Monitors pedestrian demand, crossing load, crowding, wait time, and near-conflict patterns around intersections.

### Primary User

Road safety analyst or city mobility planner.

### Primary Question

Where are pedestrians under pressure, and where should we improve crossing safety?

### Main UI Regions

- Map heat layer.
- Crosswalk flow arrows.
- School zone and event markers.
- Pedestrian signals panel.
- Volume by hour chart.
- Crossing compliance chart.
- Vehicle-turn conflict trend.
- Camera evidence preview.

### Core Components

- `PedestrianHeatmap`
- `CrosswalkFlowArrow`
- `ContextMarker`
- `PedestrianMetricCard`
- `ConflictTrendChart`
- `CameraPreview`

### Data Needed

- Pedestrian counts by crossing.
- Density estimates by zone.
- Wait time estimate.
- Near-conflict count.
- Event context.
- School zone schedule.
- Vehicle turn conflicts.

### Interactions

- Switch mode between vehicle, pedestrian, cyclist, transit.
- Select intersection.
- Open camera evidence.
- Filter by time window.
- Inspect conflict trends.

### States

- Normal crossing demand.
- Event surge.
- School-zone active.
- High crowding.
- Elevated near-conflicts.

### Acceptance Criteria

- UI stays aggregate and privacy-safe.
- User can identify when and where pedestrian pressure peaks.
- Near-conflict trends are not presented as confirmed crashes.

---

## 07 Platform Flow Storyboard

Image: `assets/07-platform-flow-storyboard.png`

### Purpose

Explains the end-to-end product system from camera input to action and reporting.

### Primary User

Frontend developer, hackathon judge, or product reviewer.

### Primary Question

How does the platform turn camera video into usable city decisions?

### Main UI Regions

- Horizontal data pipeline.
- Application modes.
- Reusable UI component panel.
- Key data object notes.
- Developer notes.

### Core Components

- `PipelineStepCard`
- `ApplicationModeCard`
- `ReusableComponentReference`
- `DataObjectList`

### Data Needed

This screen can be static in the hackathon build, but it should match the actual data model.

### Interactions

- Optional: click a pipeline step to navigate to a corresponding platform view.
- Optional: click application mode to open the live screen.

### Acceptance Criteria

- Pipeline matches actual frontend route structure.
- Labels stay concise and implementation-oriented.

---

## 08 Incident & Risk Signals

Image: `assets/08-incident-risk-signals.png`

### Purpose

Flags abnormal mobility signals for human review: stopped vehicles, lane blockages, sudden congestion spikes, wrong-way movement, near-miss patterns, curb misuse, motorcycle weaving, and event crowding surges.

### Primary User

City operations reviewer or traffic safety analyst.

### Primary Question

Which abnormal mobility signals need review, and what evidence supports them?

### Main UI Regions

- Filters for district, signal type, severity, confidence, and review status.
- Map with risk signal markers.
- Signal queue table.
- Selected signal detail panel.
- Camera evidence thumbnails.
- Video timeline.
- Trajectory sketch.
- Supporting metrics.
- Possible causes.
- Recommended review.
- Review action buttons.
- Trend cards.

### Core Components

- `RiskSignalMap`
- `SignalQueueTable`
- `SignalTypeBadge`
- `ReviewStatusBadge`
- `EvidenceThumbnailGrid`
- `VideoTimeline`
- `TrajectorySketch`
- `SupportingMetricsPanel`
- `ReviewActionBar`
- `FalsePositiveReviewCard`

### Data Needed

- Signal ID.
- Signal type.
- Location and segment.
- Severity.
- Confidence.
- Evidence references.
- Duration.
- Review status.
- First detected timestamp.
- Supporting metrics.
- Possible causes.
- Recommended review steps.

### Interactions

- Filter by signal type, confidence, severity, or status.
- Select a signal.
- Play evidence timeline.
- Assign review.
- Mark resolved.
- Link to camera evidence.
- Link to hotspot or corridor detail.

### States

- Human review required.
- Under review.
- Confirmed operational issue.
- Resolved.
- Dismissed as false positive.
- Low confidence.

### Acceptance Criteria

- The UI never says accident confirmed unless a human review status confirms it.
- The detail panel explains evidence and possible causes.
- Review workflow is clear and auditable.
