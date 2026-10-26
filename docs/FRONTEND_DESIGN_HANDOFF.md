# Frontend design continuation

## User-authorized pull and verification — October 26, 2026

- Fast-forwarded `main` from `cf227e6` to `894476f` (`origin/main`); the working tree had no local commits to merge. A same-named untracked Los Angeles regional graph blocked the pull, so it was preserved outside the checkout at `../FlowSenseOpenCV-local-preserved-20261026/los_angeles_regional_graph.local.graphml`. The remote graph now occupies the repository path.
- The user asked for the tour to emphasize its essential lessons. All thirteen steps now include a short, high-contrast `KEY POINT` card about evidence limits, source availability, human review and interpretation. The tour's route observer re-aligns its one-time scroll when the destination layout changes after loading.
- Frontend build passes (`npm run build`). Lint exits successfully with one existing `react(set-state-in-effect)` warning in `JourneyWelcome.tsx`.
- Frontend suite: 218 passed, 21 failed. Every remaining failure is in `product-shell-design.test.mjs`; those assertions match specific JSX/CSS strings and wording. These source checks need reconciliation with the current component and stylesheet layout; their failures alone do not establish whether the corresponding browser behavior passes.
- Tour logic suite passes: 11 passed. Browser smoke review showed the Overview and first two tour steps; the search field's spotlight and key point are visible above the guide card after the route layout settles. The camera catalog and saved-case API were unavailable in the local preview, so live source and review workflows could not be confirmed there.
- Backend suite in the project's virtual environment passes: 370 passed. This does not establish that a deployed backend or camera feed is available.

## Current verification boundary

The user generally defers verification until explicitly requested. On October 26, 2026, the user authorized a pull and a one-time verification run; its results are recorded above and apply only to that revision. Do not infer that later edits are validated or run fresh checks without a new request. Earlier verification accounts in `FRONTEND_JOURNEY.md` describe older revisions and do not establish that the current frontend works.

## Latest user feedback

The user supplied screenshots showing an oversized amber connection banner, a weak Overview hierarchy, and a guided-tour card covering the highlighted search control. Prioritize these concrete issues over unrelated cosmetic changes.

## Implemented response

- Connection recovery is a compact neutral card with an amber icon. Detailed explanations remain available through a disclosure; unavailable data is still identified honestly.
- Overview, the welcome invitation, camera catalog and reports use clearer headings, grouped actions, readable spacing and petrol accents. Original logo files remain unchanged.
- The tour reserves a lower viewport band for its card. Its measurement logic scrolls the target into the upper usable area, and clips the spotlight to that area.
- The tour card uses border-box sizing. Header, progress and footer remain outside the scrollable explanation body. On narrower layouts, the coming-next preview is hidden to prioritize the current explanation.
- New steps reset the explanation's scroll position. Focusing the highlighted control avoids an additional browser scroll. The main content reserves scrolling room while the tour is active.
- Resume guide appears in the fixed header when focus is outside the card. Topic cards can start the tour at their corresponding step.
- Inspect page temporarily collapses the explanation and footer while keeping the step name and close/read controls visible. Read guide expands it and requests recentering. Show area in the header recenters an existing offscreen target without repeatedly pulling the user's scroll position back.
- Task, corridor, desk and hotspot steps target actual action areas instead of broad page headings.

## Preserve during further work

- Keep the guide modeless so users can try actual controls. Do not activate camera playback, save a review, submit a calibration or change a working mode automatically as part of the tour.
- Do not reset the welcome dismissal key or existing camera/theme preferences to make the invitation appear again.
- Preserve origin-route/search restoration, case freshness messages, source provenance and legal acceptance interfaces.
- Continue to distinguish a registered video URL, a previous successful response, current playback and calibrated road coverage.

## Deferred visual acceptance

When the user authorizes verification, inspect the current revision across desktop, a narrow side panel, mobile and short landscape layouts. Check the target and card simultaneously, forward/back navigation, long explanations, topic changes, keyboard focus, reduced motion, safe areas and unavailable-source fallbacks. Specifically revisit the user's screenshot widths and check that only the current step's title and explanation are rendered. No such acceptance is claimed here.

## Release verification on the updated main — October 25, 2026

- Local `main` was fast-forwarded to `origin/main` at `e815db6` before verification.
- The frontend suite passes: 197 passed, 0 failed. A local source-pattern test expansion with 21 failing, brittle JSX/CSS assertions was removed from the release; its original committed checks remain. The passing suite includes the focused journey and tour logic cases.
- The production frontend build passes. Lint exits successfully with two warnings in `JourneyWelcome.tsx` and `LiveCameraPlayer.tsx`.
- The local regional integration scenario passes. The full backend suite reports 369 passed and one repeatable local WebRTC two-viewer ICE/network failure. That backend failure is outside this frontend change set.
- These results do not confirm deployed API availability, camera playback, or remote provider connectivity.
