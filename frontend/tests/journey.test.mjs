import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissFirstVisitTour, shouldShowFirstVisitTour, journeyTasks, tourSteps, tourRoute, nextTourIndex, targetPhase, coachmarkPosition, sameCoachmarkPosition, tourKey, scrollBehavior, recordJourney, destinationEvents, journeyNextCheck, journeyNextUrl, tourCaseAvailability, tourCaseAvailabilityMessage } from '../src/product/journey.ts';

test('first-visit tour invitation is local, dismissible and safe when storage is unavailable', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(shouldShowFirstVisitTour(storage), true);
  assert.equal(shouldShowFirstVisitTour(() => { throw new Error('storage unavailable'); }), true);
  dismissFirstVisitTour(() => { throw new Error('storage unavailable'); });
  assert.equal(shouldShowFirstVisitTour(() => { throw new Error('storage unavailable'); }), false);
  dismissFirstVisitTour(storage);
  assert.equal(shouldShowFirstVisitTour(storage), false);
  assert.equal(shouldShowFirstVisitTour({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }), false);
  dismissFirstVisitTour({ getItem() { return null; }, setItem() { throw new Error('blocked'); } });
});

test('the guided tour covers all thirteen workspace views and supports forward, backward, finish and dismissal', () => {
  assert.equal(tourSteps.length, 13);
  for (const step of tourSteps) {
    assert(step.route.startsWith('/'));
    assert(step.target.length > 0);
    assert(step.keyPoint.trim().length > 0);
    assert(step.action.length > 0);
    assert(step.fallback.length > 0);
  }
  assert.equal(tourSteps[0].target, '.fs-tasks');
  assert.match(tourSteps[0].action, /Review the available task choices/);
  assert.match(tourSteps[2].fallback, /no video or analysis can be verified/);
  assert.match(tourSteps[4].fallback, /does not mean the queue is empty/);
  let index = 0;
  for (let step = 1; step < 13; step++) { index = nextTourIndex(index, 'next'); assert.equal(index, step); }
  assert.equal(nextTourIndex(index, 'next'), -1);
  assert.equal(nextTourIndex(0, 'back'), 0);
  assert.equal(nextTourIndex(3, 'back'), 2);
  for (let step = 0; step < 13; step++) assert.equal(nextTourIndex(step, 'close'), -1);
  assert.deepEqual(journeyTasks.map(task => task.route), ['/explore', '/cameras', '/risk-signals', '/map']);
  assert.deepEqual(new Set(tourSteps.map(step => step.route)), new Set(['/overview', '/explore', '/cameras', '/corridors/harbor', '/risk-signals', '/reports', '/map', '/watch', '/hotspots', '/pedestrians', '/emergency-corridor', '/settings', '/storyboard']));
});

test('camera step uses registered context or a saved video source, never a fabricated camera', () => {
  const cameras = [{ id: 'a', stream_url: 'public-a' }, { id: 'b', stream_url: 'public-b' }];
  assert.equal(tourRoute(2, cameras, '/cameras/b', []), '/cameras/b');
  assert.equal(tourRoute(2, cameras, '/explore', ['b']), '/cameras/b');
  assert.equal(tourRoute(2, cameras, '/explore', []), '/cameras/a');
  assert.equal(tourRoute(2, [], '/explore', []), '/cameras');
  assert.equal(tourRoute(1, cameras, '/cameras/a', []), '/explore');
});

test('route loading, hidden and unscrollable targets wait and then degrade gracefully', () => {
  assert.equal(targetPhase(false, false, 0), 'waiting');
  assert.equal(targetPhase(true, false, 4400), 'waiting');
  assert.equal(targetPhase(false, false, 4600), 'fallback');
  assert.equal(targetPhase(true, false, 4600), 'fallback');
  assert.equal(targetPhase(true, true, 4600), 'ready');
});

test('the modeless tour closes with Escape and leaves Tab navigation available to the highlighted screen', () => {
  assert.equal(tourKey('Escape'), 'close');
  assert.equal(tourKey('ArrowRight'), 'next');
  assert.equal(tourKey('ArrowLeft'), 'back');
  assert.equal(tourKey('Tab'), 'native');
  assert.equal(tourKey('Shift+Tab'), 'native');
  assert.equal(tourKey('Enter'), 'native');
});

test('responsive coachmarks stay in the viewport and reduced motion avoids smooth scrolling', () => {
  const rect = { left: 300, right: 520, top: 250, bottom: 440 };
  const desktop = coachmarkPosition(rect, 1280, 900, 370);
  assert.equal(desktop.mobile, false);
  assert(desktop.left >= rect.right);
  const mobile = coachmarkPosition(rect, 390, 844, 410);
  assert.equal(mobile.mobile, true);
  assert.equal(mobile.left, 12);
  assert.equal(mobile.top, 422);
  assert.equal(scrollBehavior(true), 'instant');
  assert.equal(scrollBehavior(false), 'smooth');
});

test('stable coachmark placement can be reused without scheduling a render', () => {
  const first = coachmarkPosition({ left: 300, right: 520, top: 250, bottom: 440 }, 1280, 900, 370);
  const same = { ...first };
  const moved = { ...first, top: first.top + 1 };
  assert.equal(sameCoachmarkPosition(first, same), true);
  assert.equal(sameCoachmarkPosition(first, moved), false);
  assert.equal(sameCoachmarkPosition(first, { ...first, mobile: !first.mobile }), false);
});

test('funnel milestones require loaded destinations and never imply completed review or export', () => {
  const ready = { screen: true, cameras: true, camera: true, cases: true, roads: true };
  assert.deepEqual(destinationEvents('/cameras/a', { ...ready, cameras: false }), []);
  assert.deepEqual(destinationEvents('/cameras/a', { ...ready, camera: false }), []);
  assert.deepEqual(destinationEvents('/risk-signals', { ...ready, cases: false }), []);
  assert.deepEqual(destinationEvents('/reports', { ...ready, cases: false }), []);
  assert.deepEqual(destinationEvents('/reports', { ...ready, screen: false }), []);
  assert.deepEqual(destinationEvents('/corridors/harbor', { ...ready, roads: false }), []);
  assert.deepEqual(destinationEvents('/cameras/a', ready), ['destination_ready', 'evidence_opened']);
  assert.deepEqual(destinationEvents('/reports', ready), ['destination_ready', 'report_ready']);
  const events = recordJourney(recordJourney([], 'entry'), 'entry');
  assert.deepEqual(events, ['entry']);
  assert(!destinationEvents('/risk-signals', ready).includes('review_completed'));
});

test('next-step guidance respects unavailable catalogs and empty review queues', () => {
  const base = { cameraCatalogLoaded: true, cameraCatalogFailed: false, cameraCount: 4, casesLoadStatus: 'ready', caseCount: 2 };
  assert.equal(journeyNextCheck('/explore', { ...base, cameraCatalogLoaded: false }), null);
  assert.equal(journeyNextCheck('/explore', { ...base, cameraCatalogFailed: true }), null);
  assert.equal(journeyNextCheck('/explore', { ...base, cameraCount: 0 }), null);
  assert.equal(journeyNextCheck('/risk-signals', { ...base, casesLoadStatus: 'error' }), null);
  assert.deepEqual(journeyNextCheck('/risk-signals', { ...base, caseCount: 0 }), [
    'There are no saved cases to review yet. Find a camera, inspect its evidence and return when a review is ready.', 'Find camera evidence', '/explore',
  ]);
  assert.deepEqual(journeyNextCheck('/risk-signals', base), ['Inspect a case and document the review before confirming it. Share the evidence and the next check.', 'Prepare a report', '/reports']);
  assert.equal(journeyNextCheck('/reports', { ...base, casesLoadStatus: 'loading' }), null);
});

test('next-step navigation only carries a search into the road explorer', () => {
  assert.equal(journeyNextUrl(['Find camera evidence', 'Find camera evidence', '/explore'], '  Western Ave  '), '/explore?q=Western%20Ave');
  assert.equal(journeyNextUrl(['Prepare a report', 'Prepare a report', '/reports'], 'Western Ave'), '/reports');
  assert.equal(journeyNextUrl(['Review saved observations', 'Review saved observations', '/risk-signals'], 'Western Ave'), '/risk-signals');
  assert.equal(journeyNextUrl(['Find camera evidence', 'Find camera evidence', '/explore'], '  '), '/explore');
});

test('case-tour steps distinguish loading, failed, empty, refreshing, stale and ready records', () => {
  const base = { mode: 'observed', casesLoaded: false, casesLoadStatus: 'loading', caseCount: 0 };
  assert.equal(tourCaseAvailability(4, base), 'loading');
  assert.equal(tourCaseAvailability(5, { ...base, casesLoadStatus: 'error' }), 'unavailable');
  assert.match(tourCaseAvailabilityMessage('unavailable'), /does not mean the queue is empty/);
  assert.equal(tourCaseAvailability(4, { ...base, casesLoaded: true, casesLoadStatus: 'ready' }), 'empty');
  assert.match(tourCaseAvailabilityMessage('empty'), /loaded empty list/);
  assert.equal(tourCaseAvailability(5, { ...base, casesLoaded: true, casesLoadStatus: 'refreshing', caseCount: 3 }), 'refreshing');
  assert.equal(tourCaseAvailability(4, { ...base, casesLoaded: true, casesLoadStatus: 'error', caseCount: 3 }), 'stale');
  assert.equal(tourCaseAvailability(4, { ...base, casesLoaded: true, casesLoadStatus: 'ready', caseCount: 2 }), 'ready');
  assert.equal(tourCaseAvailability(3, { ...base, casesLoaded: true, casesLoadStatus: 'ready', caseCount: 2 }), null);
  assert.equal(tourCaseAvailability(4, { ...base, mode: 'presentation' }), null);
});
