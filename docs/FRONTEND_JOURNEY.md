# FlowSense guided journey

## Current revision notice

The user has deferred verification of the ongoing frontend changes. Earlier visual checks and test results below are historical and do not validate the current worktree. See [the current design handoff](FRONTEND_DESIGN_HANDOFF.md) for the latest screenshot-driven changes, layout decisions and deferred acceptance work. Recent user-requested visual refinements supersede older geometry descriptions below; original logo artwork and the brand palette remain the source of truth.

## Operator journey

The UI uses the supplied logo variants without redrawing or recoloring their artwork. Its theme roles follow the brandbook's Ink, Chalk, Graphite and Petrol palette. The product font stack now prefers the native Segoe UI face with system fallbacks and zero letter spacing; no font file is embedded.

All twelve supplied transparent PNG variants (horizontal/vertical combination mark, symbol and wordmark in Ink, white and Petrol) are copied byte-for-byte to `frontend/public/brand/`. The active header chooses Petrol artwork on light surfaces, white artwork on dark surfaces and Ink artwork for print.

Journey cards, welcome banners, next-check panels and coachmarks use the brandbook's 4 px panel radius, restrained borders and 4/8/16/24 px spacing steps. Active and keyboard-focus states use Petrol in light mode and the accessible pale Petrol link color in dark mode. The coachmark keeps an Ink surface in both themes so the spotlight and instructional copy remain distinct from the page beneath it. Citrine and Signal are not used as small text colors.

Overview offers four optional tasks: understand a road, find camera video, review an observation, or explore the region. Each opens an existing module and carries the current query. The 13-step guided tour covers every primary workspace view: Overview, Explore streets, Cameras, Corridors, Risk signals, Reports, City map, Observation desk, Hotspots, Pedestrian flow, Emergencies, Settings, and this evidence guide. Every step highlights a real route control or view, supports Back/Next/Skip/Close/Finish, and retains route-aware fallbacks when source data is unavailable. It never switches evidence modes automatically. In scenario mode every coachmark explains the illustrative provenance and offers an explicit return to observations.

The guide at `/storyboard` explains each stage and opens its real destination. Its 13 stages use two-digit numbering. When a card points to the guide already on screen, it scrolls to the evidence notes and moves keyboard focus there instead of appearing to do nothing. Next-check panels connect the explorer, observation desk, cameras, corridors, review queue, and reports. They describe a human next check, not a software decision.

## Interaction and retained context

The tour is optional, closable with Escape, Back/Next/Skip/Close/Finish controls, and reopenable from the persistent control and guide. Closing or finishing returns to the starting route and query. Screens remain mounted during the tour to retain local filters and selected cameras; hidden screens are inert and excluded from the accessibility tree. Saved preferences and evidence are not rewritten by tour navigation. Explicit operator changes, including switching to observations, remain in effect.

Coachmarks wait for the routed screen and real target. They use mutation, resize and scroll observation to track late mounts and layout changes, with animation-frame checks only while a target is loading, scrolling into view or settling. Stable placements do not trigger extra renders, and there is no recurring idle poll. They fall back after 4.5 seconds if no visible target can be found. Each ready step names an action to try, and each fallback explains which source or panel is unavailable without treating missing data as an empty queue or a verified condition. Case-review and reporting steps also read the actual case-list state: loading, unavailable, confirmed empty, refreshing, stale, or ready. They suppress review instructions when there are no current cases to act on. Mobile coachmarks use a bottom sheet, scrolling the target above the sheet. Reduced motion disables movement transitions and smooth scrolling. A focus action lets keyboard users reach the highlighted control. Because the coachmark is modeless, Tab and Shift+Tab follow the page's native focus order rather than trapping focus; Escape returns to the starting page. Screen readers receive the step heading, explanation, progress, and availability status. A full assistive-technology audit has not been performed.

The product-wide reduced-motion preference now shortens CSS transitions and animations to a single near-instant frame and disables smooth scrolling, including route changes and shared controls.

Client-side navigation updates the document title and moves focus to the new page heading; the polite, atomic page status announces the initial page or the main-content fallback. Tour navigation suppresses the page status because each coachmark announces its own step.

Route changes move focus to the destination page heading after the routed screen mounts, with a brand-token outline that remains visible in both themes. This prevents focus from remaining on a control inside the now-hidden guide screen. Guided-tour route changes retain coachmark focus, and closing the tour still restores focus to its original trigger; a delayed destination uses the main workspace as a fallback.

The mobile navigation footer uses a stacked layout so its three lines remain readable in the open drawer. The drawer closes after route selection and focus returns to its trigger; mobile filters expand inline without horizontal page overflow. Street search, exploration radius, map style and video filter survive moving to another route and returning during the page session. These exploration filters are intentionally not written to persistent browser preferences.

Global search exposes suggestions as listbox options and keeps the no-match announcement outside that option list. It supports arrow-key selection, Enter, and Escape. The search field advertises `/`, `Ctrl+K`, and `Command+K`; choosing a module keeps the originating query in browser history so Back restores it.

When a case review receipt has been recorded but the saved outcome cannot be confirmed, the review dialog preserves the attempted status, team and note, focuses an in-dialog “Retry case status check” action, and blocks another save until a fresh case-list read resolves the uncertainty. That retry only reads saved cases; it does not submit a second review or acceptance receipt.

## Local funnel state

`useProduct.getState().journeyEvents` is a bounded, deduplicated set of milestones for the current page session. It is excluded from persisted preferences. No identifiers, queries, timestamps, camera IDs, network analytics, or external services are collected. This is testable UI instrumentation, not deployed aggregate analytics.

| Event | Meaning |
| --- | --- |
| `entry` | Task entry rendered |
| `task_chosen` | Operator chose an entry task; not destination success |
| `destination_ready` | A routed screen mounted outside Suspense; required catalog, cases, or road data loaded where applicable |
| `evidence_opened` | A registered camera detail screen mounted after catalog load; not proof of decoded video |
| `context_opened` | Corridor screen mounted with road data available; not proof the operator reviewed it |
| `review_opened` | Review queue mounted after saved cases loaded; not a completed review |
| `report_ready` | Reports screen mounted after saved cases loaded; not a successful export |
| `review_saved` | An observation review write and subsequent case refresh succeeded |
| `tour_completed` | Operator reached Finish tour; not completion of an operational task |

Automatic tour screen visits do not emit destination milestones. A failed destination does not complete a task. Successful playback, report downloads, and real-world decisions are deliberately not inferred from clicks. Production funnel rates would require a separately designed aggregation method; this change does not claim to implement one.

The connection warning now uses high-contrast amber foreground and border colors on light and dark surfaces, while preserving its retry action and live status announcement. Rendered light and dark screen audits corrected secondary labels, unavailable and disabled states, navigation text, map labels and attribution, calibration surfaces, legal links and footer, signal details, chart notes and colored percentage labels. Secondary copy uses the brand's accessible muted or link colors; percentage labels use a dark foreground that stays readable on every traffic-class fill. Brand token and traffic-class color contrast are covered by WCAG AA regression checks.

A token-level contrast audit found that the petrol action color reached only 2.13:1 against the dark selected surface when used for keyboard focus and selection borders. A dedicated `--brand-focus` token now keeps the official petrol focus color in light mode and uses the brandbook's pale petrol `#68C7CE` for dark-mode focus, active borders, and onboarding accents. The regression test parses the actual light/dark tokens and checks text at 4.5:1, focus indicators at 3:1, and white primary-action labels against the petrol button fill.

Live keyboard navigation confirmed the focused control matches the new theme token in both themes: petrol `rgb(0, 112, 122)` in light mode and pale petrol `rgb(104, 199, 206)` in dark mode. In each case the control matched `:focus-visible` and rendered a solid outline; the preview was returned to its original dark theme and Storyboard route.

Native radio, checkbox, and range controls now use the same high-contrast pale petrol accent in dark mode. The Settings scenario radio was checked in the running browser and its computed accent matched the dark focus token (`rgb(104, 199, 206)`).

The running app announced “Overview page” and set the document title to “Overview | FlowSense” after client-side navigation to Overview. Guided-tour steps skip the extra route announcement to avoid competing with the step live region.

## Verification

Automated tests cover step progression, dismissal, catalog-based routing, delayed/hidden target fallback, native Tab access to highlighted screens, Escape dismissal, mobile placement, reduced-motion scroll policy, preserved store context, and data-gated funnel events. Existing playback, persistence, calibration, and search tests remain part of `npm test`.

A clean browser origin confirmed the first-visit welcome appears on Overview, opens step 1 of the tour, and stays dismissed after the tour closes. The close action returns to the Overview and restores focus to its persistent “Guided tour” control; the regular browser origin and its saved preferences were left untouched.

A fresh isolated frontend origin rechecked this entry flow: the first-visit welcome appeared above task choices, “Start guided tour” opened step 1, and Escape dismissed the banner for that origin while returning focus to the persistent tour control. The main app's saved preferences were not changed.

A separate new-origin browser session showed the welcome banner on Overview with the backend unavailable. “Start guided tour” opened step 1, “Next” routed to Explore streets at step 2, “Focus highlighted area” moved focus to the real street search, and Escape returned to Overview with focus on the persistent Guided tour control. The 127.0.0.1 preview origin and its saved preferences were untouched.

A live keyboard check started the tour from `/storyboard`, followed its first step to Overview and its second step to Explore streets, focused the real street-search input with “Focus highlighted area,” and used Back to return to Overview. Escape then returned to `/storyboard` and restored focus to the persistent “Guided tour” trigger. This confirms forward and backward routing, focus targeting and return behavior against the running app, not only the tour helper tests.

When the local API proxy returned HTTP 502, the global banner displayed a connection/retry explanation instead of the generic “The operation could not be completed.” API-provided actionable server errors are still preserved. Since the backend is unavailable, live camera playback, successful case writes and report downloads remain unverified.

The shared mobility and graph/routing API clients now use the same human-readable copy for network failures and detail-free 5xx responses, while keeping actionable server details visible. Regression tests cover rejected fetch, 502 gateway responses, and a 503 with an API-provided explanation.

A live desktop acceptance pass started the tour from Storyboard, advanced through all 13 step headings, and finished back on the original Storyboard route. With the local backend unavailable, the camera-control step showed the explicit unavailable-source fallback rather than implying a video was ready. The frontend checkout then passed all 236 tests, lint, the TypeScript and Vite production build, and `git diff --check`.

A mobile hit-area review found several 22–27 px actions in the guide and legal footer, plus compact header and map controls. At widths up to 760 px, standard buttons, form controls, navigation actions, legal links, map actions and Leaflet zoom controls now have at least 44 px height; narrow icon controls expand to 44 px, while attribution links retain a 24 px minimum. On the 390 by 844 CSS viewport, Overview and the guide both kept the document at 390 px wide. The complete 13-step mobile tour kept each coachmark within the viewport; all available targets were highlighted, and the offline camera step showed its explicit fallback after the wait period. The final evidence-guide target was also rechecked after its scroll settled.

A follow-up check at a 320 by 844 CSS viewport caught the mobile header hiding the supplied brand mark along with the wordmark. The narrow layout now hides only the wordmark and keeps the high-contrast petrol or white isotipo visible in light and dark themes. Regression coverage guards both mobile selectors; the page remains within the viewport and the logo retains its 44 px touch target.

A fresh mobile browser pass at 320 by 844 CSS pixels advanced through all 13 tutorial steps. At each route, the coachmark stayed within the viewport (12 px left inset, 11 px bottom inset at the sampled layout) and the document width remained 320 px. The final step finished back on the original Storyboard route, then the desktop viewport was restored. Camera steps still depend on a healthy backend to show video controls; this pass verified their guide placement and not live playback.

The live accessibility tree exposed the first tour announcement as “Step  1  of  13” because JSX whitespace was split around interpolated values. The counter now renders as one string; the running mobile tour announces “Step 1 of 13” while keeping its polite live-region behavior.

Browser checks use the real frontend without seeded observations: desktop route coverage for all 13 tour steps, highlighted controls on every available view, and an explicit unavailable-camera fallback when the backend is offline. A mobile pass at a 390 by 844 CSS viewport checked the target and coachmark across all 13 routes; the only no-target case was camera controls while the camera catalog was offline, where the tour gave the expected fallback. The Emergencies coachmark initially exceeded the bottom edge because its content height changed after placement; it now anchors to the mobile safe area and was rechecked at a 12 px bottom inset with no document overflow. The unavailable-case state was checked in the running tour: review guidance is suppressed and the status explicitly says that a failed load does not mean an empty queue. Rendered text audits covered Overview, Explorer, Observation desk, City map, Cameras, Corridors, Hotspots, Risk signals, Emergencies, Reports, Settings, Storyboard, and Pedestrian flow in both themes. All audited interface text passed WCAG AA after the fixes; the decorative slash in the search header is excluded. On mobile, the document width matched the 390 px viewport, the search spotlight stayed above the coachmark, and Tab moved from search to its suggestion controls. The local backend is unavailable during this verification, so live camera playback, successful case writes, and report downloads are not runtime-verified. Unit tests do not substitute for those checks.

The targeted backend mobility-product suite also passed (13 tests), including policy-receipt timestamps and versions, SHA-256 policy digests, append-only database guards and rejection of incomplete acceptance choices.

A live Overview contrast scan in light mode found location labels at 3.29:1 and a coverage error at 3.01:1. Signal location labels now use the theme's secondary-text token, and inline errors use a dedicated danger token with light and dark variants. The color regression test checks both error foregrounds against their error surfaces at 4.5:1; repeat DOM scans of rendered Overview text in both themes found no remaining small-text contrast failures.

Activating the guide's “Review road context” action navigated to Harbor Freeway and focused its page heading; “Search for a street” also focused the Explorer heading after its lazy screen loaded. Returning through the workspace navigation focused the “From a question to a next step” heading. Route changes inside the guided tour retained coachmark focus, and Escape restored focus to the tour's original trigger.

After replacing the tour's fixed 150 ms measurement interval, a live pass confirmed that step 1 became ready on Overview, Next routed to Explorer, the lazy loading state transitioned to the real street-search target, and Escape returned to Storyboard with focus on “Start guided tour.”

A fresh browser load of the corridor analytics view no longer emitted Recharts' zero-size initialization warning. Chart containers now begin from a small stable initial dimension and allow grid children to shrink; the corridor charts render at their measured width after layout. The targeted chart regression assertion is included in the full frontend suite (237 passing), lint and production build.

A clean isolated browser origin showed the first-visit welcome on Overview; starting the tour opened step 1, the focus action reached the task heading, and Escape returned to Overview with focus on the Guided tour control. A desktop control-name audit across Overview, Explore, Map, Observation desk, Cameras, Corridors, Hotspots, Pedestrian flow, Risk signals, Emergencies, Reports, Settings and Storyboard found no buttons missing visible text, an accessible name or a title.

A new light/dark browser contrast scan found the oversized unavailable-state dash inside the amber Review needed metric at 2.83:1 on white. That metric now uses readable theme-specific amber foregrounds; the fresh Overview scan found zero visible text contrast failures in either theme, and the brand contrast regression includes both metric colors.

The tour now advertises Left/Right arrow shortcuts and handles them only while the coachmark itself has focus. This gives keyboard users direct step navigation without capturing arrow keys from search, form controls, or the highlighted product screen; Escape remains available throughout, and the guide's regular buttons and modeless Tab order are unchanged.

Journey readiness milestones now require a successful current case load and a camera catalog refresh without an error. A stale case list or a failed catalog refresh can remain visible for review, but it no longer records the destination as current evidence readiness.

A never-used browser origin showed the first-visit introduction above the working-mode and task choices. In light mode, the supplied petrol FlowSense artwork and selected-state colors remained legible. Starting the tour opened step 1; Escape returned focus to the persistent “Take the guided tour” button in the same onboarding section after the transient welcome CTA had closed. All twelve supplied logo assets were rehashed against their source files and matched; this checks file integrity only, not copyright ownership or reuse permission.

A dark desktop review found that the sidebar's 2 px hover slide created a horizontal scrollbar at the bottom of the navigation. Navigation rows now keep their position while the icon scale and color transitions remain active; the live view has no horizontal overflow in the sidebar.
A clean 320 × 844 origin showed the first-visit welcome above the Overview hero with both actions visible in the initial viewport. The desktop tour check confirmed that Escape restores focus to the persistent guided-tour trigger after dismissing the welcome.

A review at 784 px showed that the compact tablet navigation hid every section label. The rail now keeps its compact layout but shows readable names next to the supplied icons from 761–1000 px; the live viewport remained 784 px wide with no horizontal overflow.

A live 784 px browser pass opened the tour from How it works, routed through Overview, the pedestrian and emergency views, and Settings, then finished on the original guide page with focus restored to Start guided tour. When backend-backed pedestrian data was unavailable, the step used its explicit fallback. The guide remained within the viewport at the sampled final steps.

At a live 784 px viewport, the How it works cards now render in two 292 px columns instead of three narrow columns. The tutorial text wraps by words and the page stays within the viewport; widths of 760 px and below keep the existing single-column mobile layout.

The compact tablet rail labels now use 10 px type at a 144 px rail width. A live check at 784 px measured 286 px guide columns and a 784 px document width, with no horizontal overflow.

At the same 784 px CSS viewport, the Storyboard heading now uses 24 px type and fits on one 31.2 px line; the navigation rail remains 144 px and the document remains 784 px wide with no horizontal overflow.

After updating the first-visit introduction, the prior v1 dismissal no longer hides the new invitation. A clean 390 × 844 browser origin displayed the welcome card, both choices and the close control within a 390 px document; starting the guide opened step 1 with a darkened page, a visible ring around the real task heading, and the coachmark inside the mobile safe area. Escape restored focus to the persistent tour action. The main 127.0.0.1 preview now shows the same invitation once on reload, then opens the interactive guide; existing theme, mode and saved-camera preferences are not part of the onboarding key.
