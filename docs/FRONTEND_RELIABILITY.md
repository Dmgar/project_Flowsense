# Frontend reliability and appearance

## Changes

- A dedicated light/dark theme control is available in the header and Settings.
  It updates the whole product workspace, dialogs, charts and map controls and
  survives reloads. Public camera images retain their original colors.
- Filter, map-layer and appearance controls use distinct icons and English
  accessibility labels. Text and controls have improved contrast and focus states.
- Mobile navigation has a close button, Escape dismissal and a keyboard focus
  boundary. Background controls are inert while navigation is open.
- District filtering uses the same geographic matching rules for signals and
  cameras. Connected-source districts are available in the global selector.
- Layers without calibrated observations are disabled with an explanation in
  observed mode. Presentation layers remain available in presentation mode.
- Map layers close on Escape or an outside click. Expanded maps also close on
  Escape. Route lines do not intercept point selection while choosing coordinates.
- Blank coordinate components are rejected instead of being converted to zero.
  Route alternatives and their assessment remain together across navigation;
  unrelated recalculated routes clear the previous assessment.
- Graph loading retries after an initial failure. HTTP requests have bounded
  deadlines and support cancellation; WebSocket cleanup does not schedule a new
  connection after the component unmounts.
- The workspace can retry a failed connection immediately. Background polling
  does not overlap, and pending requests are cancelled when the workspace unmounts.
- API validation errors show the affected field and message. Custom review teams
  remain selectable. Full-screen camera failures produce a readable notification.

## Verification

Run `npm test`, `npm run build` and `npm run lint` from `frontend/`.

Browser checks covered light/dark switching and reload persistence, all navigation
modules, keyboard dismissal, district selection, street search, camera comparison,
the observation desk, map layers and expansion, invalid coordinates, calculation
of a real route and two alternatives, report links, and connection-dialog rendering.
No test cases were submitted to the operator's case ledger. Camera selections
added for observation-desk checks were removed afterwards.

The browser checks used the available in-app viewport; they do not certify every
device or every third-party camera stream. Public source availability and inference
results remain separate from interface verification. Existing operator-authored
case content and geographic proper names retain their original language.
