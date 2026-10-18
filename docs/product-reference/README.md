# FlowSense Frontend Handoff

Generated on 2026-10-13 for the OpenCV hackathon frontend developer.

This folder turns the generated UI references into a buildable frontend brief. The images are not implemented screens. They define product intent, information architecture, reusable components, data needs, and user flows.

## Product Definition

FlowSense is a city mobility intelligence platform. It turns camera-derived movement data into operational insight for traffic teams, city planners, safety teams, and emergency operators.

The product is not only an ambulance router and not only a vehicle detector. Detection is the input layer. The product value is the ability to see, prioritize, explain, and review mobility conditions across a city.

## Folder Contents

- `assets/`: generated UI reference images.
- `images/product-reference-01.jpeg` through `product-reference-08.jpeg`: original supplied references, ordered by original filename. Image contents are unchanged.
- `product-brief.md`: what the platform is, who uses it, and what it improves.
- `screen-specs.md`: detailed implementation brief for every generated screen.
- `component-system.md`: reusable frontend components and shared behavior.
- `data-contracts.md`: suggested data objects for frontend integration.
- `flow-schema.yaml`: structured screen and navigation schema.
- `user-flows.mmd`: Mermaid diagram for the main platform flow.
- `implementation-plan.md`: suggested build order for the frontend developer.

## Screen List

1. `01-live-city-map.png`: live city overview.
2. `02-camera-evidence.png`: selected camera evidence and detection review.
3. `03-corridor-analytics.png`: corridor-level analytics.
4. `04-city-hotspots.png`: ranked city issue queue.
5. `05-emergency-corridor.png`: emergency road intelligence mode.
6. `06-pedestrian-flow.png`: pedestrian movement and safety pressure.
7. `07-platform-flow-storyboard.png`: end-to-end product and data flow.
8. `08-incident-risk-signals.png`: abnormal mobility signal triage.

## Core Guardrails

- Use aggregate movement intelligence. Do not build facial recognition, license-plate identity, or individual tracking flows.
- Treat generated numbers as placeholder data until real telemetry exists.
- Present emergency routing as decision support for authorized operators, not automatic dispatch.
- Present incident detection as signal triage. The platform can flag abnormal signals, but a human confirms before operational action.
- Do not imply automatic traffic-light control unless an integration exists.

## Minimum Frontend Goal

For the hackathon, implement a clickable dashboard prototype with realistic mocked data:

- A persistent app shell with navigation.
- Live map overview with layers and metric cards.
- Camera evidence detail view.
- Corridor analytics detail view.
- City hotspot queue.
- Incident and risk signal queue.
- Pedestrian flow module.
- Emergency corridor mode.
