# Implementation Plan

This is the suggested frontend build order for a hackathon team.

## Phase 1: App Skeleton

Build:

- Vite/React app shell.
- Left navigation.
- Top bar.
- Global mock data store.
- Shared design tokens.
- Basic routing.

Routes:

- `/overview`
- `/cameras/:cameraId`
- `/corridors/:corridorId`
- `/hotspots`
- `/pedestrians`
- `/risk-signals`
- `/emergency-corridor`

## Phase 2: Reusable Primitives

Build these before screen-specific work:

- `MetricCard`
- `StatusBadge`
- `SeverityBadge`
- `ConfidenceMeter`
- `DetailDrawer`
- `CityMap`
- `CameraMarker`
- `SignalMarker`
- `TrendLineChart`
- `DataTable`
- `CameraPlayer`
- `TimelineScrubber`

## Phase 3: Core Demo Screens

Implement these first because they tell the product story fastest:

1. Live City Map.
2. City Hotspots.
3. Camera Evidence.
4. Incident & Risk Signals.

These four screens are enough to show:

- the city view,
- prioritization,
- visual evidence,
- and human-reviewed action.

## Phase 4: Analytical Depth

Add:

- Corridor Analytics.
- Pedestrian Flow.
- Emergency Corridor.

These screens make the platform feel broader than a camera demo.

## Phase 5: Polish And Demo Path

Create a single guided demo path:

1. Start on Live City Map.
2. Click a high congestion corridor.
3. Show Corridor Analytics.
4. Return to City Hotspots.
5. Open a bottleneck case.
6. Open Camera Evidence.
7. Open Incident & Risk Signals.
8. Assign Review.
9. Show Emergency Corridor as an application mode.
10. End with Platform Storyboard or report export.

## Mock Data Strategy

Use deterministic mock data. Avoid random values changing on every render.

Recommended files:

- `src/data/cameras.ts`
- `src/data/segments.ts`
- `src/data/corridors.ts`
- `src/data/hotspots.ts`
- `src/data/riskSignals.ts`
- `src/data/pedestrianZones.ts`
- `src/data/emergencyCorridors.ts`

## Interaction Priorities

Must have:

- Navigation between screens.
- Click map marker to open detail.
- Select table row to update right drawer.
- Filter by type and severity.
- Play/pause or fake scrub camera evidence.
- Assign review and mark resolved with local UI state.

Nice to have:

- Animated map markers.
- Export report button.
- Baseline toggle.
- Responsive mobile layout.
- Toast notifications.

## Copy Rules

Use:

- "Signal detected"
- "Human review required"
- "Suggested next check"
- "Decision support"
- "Camera evidence"
- "Confidence"

Avoid:

- "Accident confirmed" unless review status confirms it.
- "Automatically controls traffic lights"
- "Tracks people"
- "Identifies drivers"
- "Guaranteed faster ambulance response"

## Done Definition

The frontend handoff is successfully implemented when:

- Every route opens without errors.
- The app has at least one realistic demo path.
- Screens share visual language and components.
- The data shown on maps, tables, cards, and drawers is internally consistent.
- Risk signals and emergency features include human-review guardrails.
