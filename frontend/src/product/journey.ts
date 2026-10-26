export const journeyTasks = [
  { id: 'road', category: 'Road context', icon: 'route', title: 'Understand a road or corridor', detail: 'Find a street and check its camera coverage.', route: '/explore' },
  { id: 'camera', category: 'Video sources', icon: 'camera', title: 'Find a live camera', detail: 'Choose a public source, then check video availability.', route: '/cameras' },
  { id: 'review', category: 'Human review', icon: 'shield', title: 'Review an observation', detail: 'Check saved cases and document your next check.', route: '/risk-signals' },
  { id: 'region', category: 'Regional view', icon: 'map', title: 'Explore the region', detail: 'Locate roads and sources on the city map.', route: '/map' },
];

const firstVisitKey = 'flowsense-first-visit-tour-dismissed-v2';
let welcomeDismissedInMemory = false;
type WelcomeStorage = Pick<Storage, 'getItem' | 'setItem'> | (() => Pick<Storage, 'getItem' | 'setItem'>);
export function shouldShowFirstVisitTour(storage: WelcomeStorage): boolean {
  try {
    const available = typeof storage === 'function' ? storage() : storage;
    const dismissed = available.getItem(firstVisitKey) === 'true';
    if (dismissed) welcomeDismissedInMemory = true;
    return !dismissed && !welcomeDismissedInMemory;
  }
  catch { return !welcomeDismissedInMemory; }
}
export function dismissFirstVisitTour(storage: WelcomeStorage): void {
  welcomeDismissedInMemory = true;
  try {
    const available = typeof storage === 'function' ? storage() : storage;
    available.setItem(firstVisitKey, 'true');
  }
  catch { /* Keep onboarding usable when browser storage is disabled. */ }
}

const nextChecks: Record<string, [string, string, string]> = {
  explore: ['Open a camera result to check its video. Add sources to the desk when a comparison would help.', 'Open observation desk', '/watch'],
  watch: ['Compare source timing and viewing direction before drawing a conclusion. Keep uncertainty in your review.', 'Review saved observations', '/risk-signals'],
  cameras: ['Check the source and viewing zone first. A model candidate or tracked detection still needs human review.', 'Review saved observations', '/risk-signals'],
  corridors: ['Confirm which cameras cover the road. Document what the available evidence supports and what is missing.', 'Open review queue', '/risk-signals'],
  'risk-signals': ['Inspect a case and document the review before confirming it. Share the evidence and the next check.', 'Prepare a report', '/reports'],
  reports: ['Check the source, review status and uncertainty before exporting. A download is not an operational decision.', 'Return to evidence search', '/explore'],
};

export function journeyNextCheck(path: string, state: { cameraCatalogLoaded: boolean; cameraCatalogFailed: boolean; cameraCount: number; casesLoadStatus: 'loading' | 'refreshing' | 'ready' | 'error'; caseCount: number }): [string, string, string] | null {
  const route = path.split('/')[1];
  if (route === 'explore' && (!state.cameraCatalogLoaded || state.cameraCatalogFailed || state.cameraCount === 0)) return null;
  if (route === 'risk-signals') {
    if (state.casesLoadStatus === 'error' || state.casesLoadStatus === 'loading' || state.caseCount === 0) {
      return state.casesLoadStatus === 'ready' && state.caseCount === 0
        ? ['There are no saved cases to review yet. Find a camera, inspect its evidence and return when a review is ready.', 'Find camera evidence', '/explore']
        : null;
    }
  }
  if (route === 'reports' && state.casesLoadStatus !== 'ready' && state.casesLoadStatus !== 'refreshing') return null;
  return nextChecks[route] || null;
}

export function journeyNextUrl(next: [string, string, string], query: string): string {
  const [,, destination] = next;
  // A road/place search is meaningful in the explorer. Carrying that text into
  // review, report, or camera routes leaves unrelated stale text in global search.
  return destination === '/explore' && query.trim()
    ? `${destination}?q=${encodeURIComponent(query.trim())}`
    : destination;
}

export type TourCaseAvailability = 'loading' | 'unavailable' | 'empty' | 'refreshing' | 'stale' | 'ready';
export function tourCaseAvailability(index: number, state: { mode: 'observed' | 'presentation'; casesLoaded: boolean; casesLoadStatus: 'loading' | 'refreshing' | 'ready' | 'error'; caseCount: number }): TourCaseAvailability | null {
  if (![4, 5].includes(index) || state.mode === 'presentation') return null;
  if (state.casesLoadStatus === 'error') return state.casesLoaded ? 'stale' : 'unavailable';
  if (!state.casesLoaded || state.casesLoadStatus === 'loading') return 'loading';
  if (state.casesLoadStatus === 'refreshing') return 'refreshing';
  return state.caseCount === 0 ? 'empty' : 'ready';
}
export function tourCaseAvailabilityMessage(availability: TourCaseAvailability): string {
  switch (availability) {
    case 'loading': return 'Saved-case data is still loading. Continue the tour, or wait for this page to finish checking.';
    case 'unavailable': return 'Saved cases could not be loaded. That does not mean the queue is empty. Retry connection on this page, or continue the tour.';
    case 'empty': return 'The case service returned a loaded empty list. There are no saved observations to review yet; return after evidence is saved.';
    case 'refreshing': return 'The last loaded case list is being refreshed. Check that the latest load finishes before treating it as current.';
    case 'stale': return 'The latest case refresh failed. Any listed cases are from the last successful load and may be stale; retry before treating them as current.';
    case 'ready': return '';
  }
}

export const tourSteps = [
  { title: 'Start with your question', keyPoint: 'Choose the right tool first: observation mode uses available evidence; presentation mode shows examples.', detail: 'These cards open the existing tools. This tour follows a full evidence journey, and you can explore on your own at any time.', route: '/overview', target: '.fs-tasks', action: 'Review the available task choices', fallback: 'The task choices are not available on this page yet. Continue to learn the evidence journey, or close the tour to explore the page.' },
  { title: 'Find the street', keyPoint: 'A nearby camera may not see the street you searched for. Open its video and check the direction.', detail: 'Search for a street, freeway, place or camera. Nearby cameras may not see the road you searched for. Open a result to inspect its video.', route: '/explore', target: '.p-explorer-search', action: 'Search for a street', fallback: 'Street search is not ready here. You can continue to the camera and road-context steps without choosing a result.' },
  { title: 'Check video and evidence', keyPoint: 'A camera listing is not proof of current video. A detection is a candidate, not a confirmed event.', detail: 'Connect the video before judging the scene. Saved clips are earlier evidence; model candidates and tracked detections need review. Unavailable analysis means no conclusion.', route: '/cameras', target: '.p-camera-main .p-live-controls > button', action: 'Inspect camera video', fallback: 'Camera controls are not visible at this step. If the catalog or feed is unavailable, no video or analysis can be verified. Continue to learn what evidence to check when a source is available.' },
  { title: 'Check the road context', keyPoint: 'A mapped road or nearby source does not prove camera coverage. Scene counts are not calibrated speed.', detail: 'Compare the road and nearby sources. A road link is different from a calibrated viewing zone. Counts describe the visible scene, not calibrated speed or whole-road occupancy.', route: '/corridors/harbor', target: '.p-corridor-screen select[aria-label="Choose corridor"]', action: 'Review road context', fallback: 'Road context is not visible at this step. If coverage has not loaded, that does not confirm that a camera sees the road. Continue to the review steps.' },
  { title: 'Keep a person in the loop', keyPoint: 'Open the source evidence and record your reasoning; a model score or alert cannot confirm an incident.', detail: 'When a saved case is available, inspect its evidence and document your review. A confirmed empty list means no case is ready to review; unavailable case data needs a retry. You can return to cameras to collect evidence.', route: '/risk-signals', target: '.p-table-panel', action: 'Review an observation', fallback: 'The saved-case panel is not visible at this step. If case data failed to load, that does not mean the queue is empty. Continue to learn how a person records a review.' },
  { title: 'Make the next check clear', keyPoint: 'Check source, freshness and audit history before sharing. A report does not make an operational decision.', detail: 'Review the case origins and audit history before exporting. Check the export-readiness notice and record what still needs checking. FlowSense supports your decision; it does not make an operational decision.', route: '/reports', target: '.p-report-readiness', action: 'Prepare a report', fallback: 'Export preparation is not visible at this step. You can still finish the tour; no export or operational decision has been made.' },
  { title: 'Read the city map', keyPoint: 'A map marker shows a location, not proof that a road is covered or a feed is available.', detail: 'Use the map to locate public sources and signals, then open their evidence. A marker or nearby camera does not prove that a road is covered.', route: '/map', target: '.p-overview-map', action: 'Inspect a map layer or feature', fallback: 'The city map is not ready yet. You can continue; unavailable map tiles do not indicate that a source or road is empty.' },
  { title: 'Compare live sources', keyPoint: 'Feeds have different clocks and delays. Review each timestamp; do not add scene counts into a regional total.', detail: 'The observation desk keeps up to four selected cameras together. Each feed has independent timing and delay, so review them individually rather than adding their counts into a regional total.', route: '/watch', target: '.p-observation-desk .p-explorer-hero > button', action: 'Review the observation desk controls', fallback: 'No selected video sources are required to learn this view. Add cameras from Explore streets when you are ready to compare feeds.' },
  { title: 'Prioritize hotspots', keyPoint: 'Scores rank items for review; they are not probabilities. Presentation rankings are examples.', detail: 'Use signal type, priority and review status to refine the ranking. Scores are not calibrated probabilities, and scenario rankings are illustrative. When records are available, open View details to inspect their evidence and next check.', route: '/hotspots', target: '.p-queue-filter-section', action: 'Review the ranking filters', fallback: 'The ranking filters are not visible yet. Continue the guide, or return when the page is available. Missing records do not establish that there are no hotspots.' },
  { title: 'Review pedestrian context', keyPoint: 'Missing measurements are unknown, not zero. The displayed pedestrian scenario is illustrative.', detail: 'Choose a reference location and travel mode to review crossing context. The pedestrian scenario is illustrative; other travel modes have no measurements in this view. Missing measurements are not zero demand.', route: '/pedestrians', target: '.p-pedestrian-layout', action: 'Compare a travel mode or location', fallback: 'Pedestrian context is not available on this page yet. Continue; missing measurements are not zero demand.' },
  { title: 'Compare an emergency corridor', keyPoint: 'A suggested route is decision support. It does not dispatch a unit or verify live conditions.', detail: 'Enter or pick an origin and destination to compare a primary route with a backup. This is decision support only; it does not dispatch a unit or confirm live road conditions.', route: '/emergency-corridor', target: '.p-dispatch-form', action: 'Review route inputs and available choices', fallback: 'Route inputs are not ready. No route has been calculated or dispatched; continue to review the remaining workspace tools.' },
  { title: 'Set your workspace context', keyPoint: 'Keep observations and presentation examples distinct when interpreting any result.', detail: 'Choose observed data or a clearly labeled presentation scenario, review network and source status, and connect a source when needed. Your saved preferences remain yours.', route: '/settings', target: '.p-settings-layout', action: 'Review workspace and source settings', fallback: 'Settings are still loading. You can continue; an unavailable source status should be retried rather than assumed empty.' },
  { title: 'Use the evidence guide', keyPoint: 'When a source or measurement is unavailable, treat it as unknown and check provenance before drawing a conclusion.', detail: 'Return here whenever you need a reminder about evidence limits, source availability or the next human review step. You can restart the tour or explore any tool directly.', route: '/storyboard', target: '.fs-guide-notes', action: 'Review the evidence and source guidance', fallback: 'The evidence guide is not ready yet. Use the workspace navigation to return whenever you need it.' },
];

export function tourRoute(index: number, cameras: { id: string; stream_url?: string | null }[], currentPath: string, selected: string[]) {
  if (index !== 2) return tourSteps[index].route;
  const current = currentPath.startsWith('/cameras/') ? cameras.find(c => c.id === currentPath.split('/')[2]) : undefined;
  const camera = current || cameras.find(c => selected.includes(c.id) && c.stream_url) || cameras.find(c => c.stream_url);
  return camera ? `/cameras/${encodeURIComponent(camera.id)}` : '/cameras';
}

export function coachmarkPosition(_rect: { left: number; top: number; right: number; bottom: number }, width: number, height: number, cardHeight: number) {
  // Reserve a separate lower band for the guide; the spotlight stays above it.
  const mobile = width <= 1100;
  const left = mobile ? 12 : Math.max(12, width - 412);
  return { left, top: Math.max(12, height - cardHeight - 12), mobile };
}

export function sameCoachmarkPosition(a: ReturnType<typeof coachmarkPosition>, b: ReturnType<typeof coachmarkPosition>) {
  return a.left === b.left && a.top === b.top && a.mobile === b.mobile;
}

export function tourKey(key: string) {
  if (key === 'Escape') return 'close';
  if (key === 'ArrowRight') return 'next';
  if (key === 'ArrowLeft') return 'back';
  return 'native';
}
export function scrollBehavior(reducedMotion: boolean): ScrollBehavior { return reducedMotion ? 'instant' : 'smooth'; }

export type JourneyEvent = 'entry' | 'task_chosen' | 'destination_ready' | 'evidence_opened' | 'context_opened' | 'review_opened' | 'report_ready' | 'tour_completed' | 'review_saved';
export function recordJourney(events: JourneyEvent[], event: JourneyEvent): JourneyEvent[] {
  return events.includes(event) ? events : [...events, event];
}

export function nextTourIndex(index: number, direction: 'next' | 'back' | 'close') {
  if (direction === 'close' || (direction === 'next' && index === tourSteps.length - 1)) return -1;
  return Math.max(0, Math.min(tourSteps.length - 1, index + (direction === 'next' ? 1 : -1)));
}
export function targetPhase(found: boolean, visible: boolean, elapsed: number) {
  return found && visible ? 'ready' : elapsed > 4500 ? 'fallback' : 'waiting';
}
export function destinationEvents(path: string, ready: { screen: boolean; cameras: boolean; camera: boolean; cases: boolean; roads: boolean }): JourneyEvent[] {
  if (!ready.screen || (path.startsWith('/cameras') && (!ready.cameras || (path.startsWith('/cameras/') && !ready.camera))) || (['/risk-signals', '/reports'].includes(path) && !ready.cases) || (path.startsWith('/corridors') && !ready.roads)) return [];
  return ['destination_ready', ...(path.startsWith('/cameras/') ? ['evidence_opened' as const] : []), ...(path.startsWith('/corridors') ? ['context_opened' as const] : []), ...(path === '/risk-signals' ? ['review_opened' as const] : []), ...(path === '/reports' ? ['report_ready' as const] : [])];
}
