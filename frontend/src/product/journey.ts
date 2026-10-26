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
    case 'loading': return 'Saved cases are loading. Continue and return when ready.';
    case 'unavailable': return 'Saved cases are unavailable. Retry on this page; that does not mean the queue is empty.';
    case 'empty': return 'No saved cases yet. Return after evidence is saved.';
    case 'refreshing': return 'Cases are refreshing; listed items may be out of date.';
    case 'stale': return 'Refresh failed. Listed cases may be out of date; retry before reviewing.';
    case 'ready': return '';
  }
}

export const tourSteps = [
  { title: 'Start with your question', keyPoint: 'Observations use available evidence. Presentation mode uses examples.', detail: 'Choose a task to open its tools.', route: '/overview', target: '.fs-tasks', action: 'Review the task choices', fallback: 'Task choices are not available yet. Continue or explore the page.' },
  { title: 'Find the street', keyPoint: 'A nearby camera may face away from your street.', detail: 'Search, open a result, then check its video and direction.', route: '/explore', target: '.p-explorer-search', action: 'Search for a street', fallback: 'Search is unavailable. Continue to learn what to check on a camera page.' },
  { title: 'Check video and evidence', keyPoint: 'A listing is not proof of live video. Detections still need review.', detail: 'Open the video; saved clips show earlier evidence.', route: '/cameras', target: '.p-camera-main .p-live-controls > button', action: 'Inspect camera video', fallback: 'Camera controls are unavailable. No video or analysis can be verified here.' },
  { title: 'Check the road context', keyPoint: 'A nearby road or camera does not prove coverage.', detail: 'Review the viewing zone. Scene counts are not calibrated speed.', route: '/corridors/harbor', target: '.p-corridor-screen select[aria-label="Choose corridor"]', action: 'Review road context', fallback: 'Road context is unavailable. Continue to the review steps.' },
  { title: 'Keep a person in the loop', keyPoint: 'A model score cannot confirm an incident.', detail: 'Inspect source evidence and record your reasoning.', route: '/risk-signals', target: '.p-table-panel', action: 'Review an observation', fallback: 'Saved cases are unavailable. That does not mean the queue is empty.' },
  { title: 'Make the next check clear', keyPoint: 'Check source, freshness and review history before sharing.', detail: 'Review export readiness and note what still needs checking.', route: '/reports', target: '.p-report-readiness', action: 'Prepare a report', fallback: 'Export preparation is unavailable. No report or operational decision has been made.' },
  { title: 'Read the city map', keyPoint: 'A marker shows location, not road coverage or feed availability.', detail: 'Open a source on the map to inspect its evidence.', route: '/map', target: '.p-overview-map', action: 'Inspect a map feature', fallback: 'The city map is unavailable. Continue; missing map tiles do not mean a source is empty.' },
  { title: 'Compare live sources', keyPoint: 'Each feed has its own clock and delay.', detail: 'Review timestamps separately; do not add scene counts into a regional total.', route: '/watch', target: '.p-observation-desk .p-explorer-hero > button', action: 'Review the desk controls', fallback: 'Add cameras from Explore when you are ready to compare feeds.' },
  { title: 'Prioritize hotspots', keyPoint: 'Scores rank items; they are not probabilities.', detail: 'Open a result to review its evidence and next check.', route: '/hotspots', target: '.p-queue-filter-section', action: 'Review the ranking filters', fallback: 'Ranking filters are unavailable. Missing records do not prove there are no hotspots.' },
  { title: 'Review pedestrian context', keyPoint: 'Missing measurements mean unknown, not zero.', detail: 'The pedestrian scenario is illustrative.', route: '/pedestrians', target: '.p-pedestrian-layout', action: 'Compare a mode or location', fallback: 'Pedestrian context is unavailable. Missing measurements are not zero demand.' },
  { title: 'Compare an emergency corridor', keyPoint: 'A suggested route does not dispatch or verify live conditions.', detail: 'Compare a primary route with its backup.', route: '/emergency-corridor', target: '.p-dispatch-form', action: 'Review route choices', fallback: 'Route inputs are unavailable. No route has been calculated or dispatched.' },
  { title: 'Set your workspace context', keyPoint: 'Keep observed data separate from presentation examples.', detail: 'Review source status and connect a source when needed.', route: '/settings', target: '.p-settings-layout', action: 'Review workspace settings', fallback: 'Settings are loading. Retry unavailable source status rather than assuming it is empty.' },
  { title: 'Use the evidence guide', keyPoint: 'Treat unavailable sources and measurements as unknown.', detail: 'Return here for evidence limits and review guidance.', route: '/storyboard', target: '.fs-guide-notes', action: 'Review evidence guidance', fallback: 'The evidence guide is unavailable. Return from workspace navigation when ready.' },
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
