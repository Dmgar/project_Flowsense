# Frontend improvements

## Scope

This release updates the FlowSense React frontend and its user-facing guidance. It preserves the existing API and playback contracts. It does not include local databases, generated regional graphs, server logs, or backend changes.

## What changed

- Applied the supplied FlowSense logo variants to light, dark, print, mobile, app-icon, and playback-QA contexts. The brand guide records asset hashes, contrast guidance, and the limits of the supplied rights evidence.
- Refined navigation, page hierarchy, spacing, typography, controls, responsive layouts, and light/dark theme contrast across the workspace.
- Improved first-visit onboarding and the guided tour, including a spotlight on the current page control, a scrollable explanation, navigation and keyboard help, and a high-contrast **KEY POINT** on all 13 steps.
- Added clearer loading, unavailable, retry, review, reporting, map, chart, and camera-source guidance. Labels distinguish missing information from measured zero and explain evidence limits.
- Added frontend legal pages for terms, privacy, cookies, and refunds, plus an implementation review describing the U.S. baseline and unresolved operator/provider questions. These pages are informational product content, not a legal opinion.
- Improved keyboard focus, status announcements, reduced-motion handling, touch targets, and mobile navigation behavior.

## Verification

Verification was run after fast-forwarding local `main` to `origin/main` at `e815db6`.

- `frontend`: `npm test` — 197 passed, 0 failed.
- `frontend`: `npm run build` — passed.
- `frontend`: `npm run lint` — exit 0; two warnings remain in `JourneyWelcome.tsx` and `LiveCameraPlayer.tsx`.
- `scripts.verify_los_angeles_integration` — passed for its local integration scenario.
- Full backend `pytest`: 369 passed, 1 failed. The failing two-viewer WebRTC test did not receive the expected frames on this Windows host; an isolated rerun reproduced the ICE/network connectivity failure. No backend code is part of this frontend release.

## Local files kept out of the release

Generated regional graphs, SQLite databases, server logs, and unrelated backend edits remain local and are not included in the frontend commit.
