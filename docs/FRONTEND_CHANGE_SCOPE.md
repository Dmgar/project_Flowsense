# Frontend change scope — commit `b0f6f8c`

This note explains what the large FlowSense update changed and what it left outside the release. The commit is on `main` and is titled `feat(frontend): improve onboarding and workspace UX`.

## Included in the commit

### Frontend experience

- Reworked the workspace shell, overview, navigation, search, screen layouts, maps, camera catalog, observation desk, review, and reporting surfaces.
- Added the first-visit guide invitation and the 13-step guided tour. The guide has a dark backdrop, a spotlight for the active page area, a prominent **KEY POINT** on each step, route-aware explanations, keyboard help, and responsive coachmark layout.
- Added clearer loading, empty, unavailable, retry, and error recovery states for frontend views.
- Improved theme contrast, FlowSense spacing and typography, responsive behavior, keyboard focus, touch targets, reduced-motion handling, and screen-reader labels/status announcements.
- Updated frontend API client error presentation and camera, search, chart, map, case, and evidence reading helpers. The API server routes and contracts were not changed in this commit.

### Branding and legal content

- Added the twelve supplied logo variants under `frontend/public/brand/` and updated the shared brand mark, app icons, and playback-QA page to choose suitable variants for light, dark, and print surfaces.
- Updated `docs/BRANDING.md` with asset and rights notes.
- Added frontend pages and written notices for terms, privacy, cookies, and refunds, plus `docs/legal/IMPLEMENTATION_REVIEW.md` with implementation caveats and launch questions. The documents do not establish legal compliance or ownership rights.

### Supporting files

- Added frontend helper modules and focused tests for tour/journey logic, search, camera connection state, map loading, observation desk selection, review outcomes, signal evidence, and related UI states.
- Updated `frontend/package-lock.json` and frontend HTML entry/icon references.
- Added `docs/FRONTEND_IMPROVEMENTS_2026-10-25.md` as the release summary.

## Deliberately excluded

No backend service, server API route, database, generated mobility graph, or camera data was included in `b0f6f8c`. In particular, that commit does not contain changes to:

- `src/api/routes/mobility.py`
- `src/services/mobility_service.py`
- `tests/test_mobility_product.py`
- `data/processed/manhattan_graph.graphml`
- Local SQLite databases, generated regional graphs, or backend logs

These paths may still appear as uncommitted local changes or files in the working tree. They were left in place and were not staged, committed, or pushed.

The local-only `frontend/data/` folder was also excluded; it contains generated databases and a graph rather than frontend source assets.

The local expansion of `frontend/tests/product-shell-design.test.mjs` with 21 exact-source-pattern assertions was not included. Those assertions failed against the current component/CSS structure; the file was restored to its committed version. The focused frontend suite that was included and run reported 197 passing tests.

## Verification recorded for the release

- `npm test`: 197 passed, 0 failed.
- `npm run build`: passed.
- `npm run lint`: exit 0 with two warnings, in `JourneyWelcome.tsx` and `LiveCameraPlayer.tsx`.
- Local regional integration scenario: passed.
- Full backend `pytest`: 369 passed, 1 failed. The failing two-viewer WebRTC test did not receive the expected frames on this Windows host; an isolated rerun reproduced a local ICE/network connectivity failure. Backend changes were excluded from the frontend commit.

These checks do not confirm deployed backend availability, remote camera playback, or provider permissions.
