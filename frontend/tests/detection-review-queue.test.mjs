import test from 'node:test';
import assert from 'node:assert/strict';
import { archivedReviewHistoryMessage, canSaveVideoReview, confirmableSuggestedClass, groupReviewableDetections, reviewableDetections } from '../src/product/detectionReviewQueue.ts';

const clipIds = new Set(['ready-clip']);
const event = (overrides = {}) => ({ clip: 'ready-clip', counted: false, class: 'vehicle',
  class_status: 'uncertain', candidate_class: 'car', direction: 'unrestricted', ...overrides });

test('saved operator labels remain transparent when the active API lacks archived review rows', () => {
  assert.equal(archivedReviewHistoryMessage(true, 2), '');
  assert.equal(archivedReviewHistoryMessage(false, 0), '');
  assert.match(archivedReviewHistoryMessage(false, 2), /2 operator video reviews are saved and applied to totals/);
  assert.match(archivedReviewHistoryMessage(false, 1), /1 operator video review is saved and applied to totals/);
  assert.equal(archivedReviewHistoryMessage(null, 2), '');
});

test('full-scene uncertain vehicles with playable evidence can be reviewed before road calibration', () => {
  const candidate = event();
  const unclear = event({ candidate_class: null });
  const stable = event({ class: 'car', class_status: 'stable' });
  const missingClip = event({ clip: 'missing-clip' });

  assert.deepEqual(reviewableDetections([candidate, unclear, stable, missingClip], clipIds, false), [candidate, unclear, stable]);
});

test('calibrated cameras keep uncertain reviews limited to approaching-lane tracks', () => {
  const approaching = event({ direction: 'approaching' });
  const away = event({ direction: 'away' });

  assert.deepEqual(reviewableDetections([approaching, away], clipIds, true), [approaching]);
  const approachingStable = event({ class: 'bus', class_status: 'stable', direction: 'approaching' });
  const awayStable = event({ class: 'bus', class_status: 'stable', direction: 'away' });
  assert.deepEqual(reviewableDetections([approachingStable, awayStable], clipIds, true), [approachingStable]);
});

test('counted detections remain reviewable only when a playable crossing offset exists', () => {
  const linkedCrossing = event({ counted: true, crossing_offset_seconds: 1.5, class: 'car', class_status: 'stable' });
  const unlinkedCrossing = event({ counted: true, class: 'car', class_status: 'stable' });

  assert.deepEqual(reviewableDetections([linkedCrossing, unlinkedCrossing], clipIds, false), [linkedCrossing]);
});

test('a suggested class can be confirmed only after its linked clip plays and before a review exists', () => {
  const candidate = event();

  assert.equal(confirmableSuggestedClass(candidate, new Set()), null);
  assert.equal(confirmableSuggestedClass(candidate, clipIds), 'car');
  assert.equal(confirmableSuggestedClass(event({ feedback: { reviewed_class: 'truck' } }), clipIds), null);
  assert.equal(confirmableSuggestedClass(event({ class: 'car' }), clipIds), null);
  assert.equal(confirmableSuggestedClass(event({ candidate_class: 'vehicle' }), clipIds), null);
});

test('new and corrected labels require the linked evidence clip to have played', () => {
  assert.equal(canSaveVideoReview(event(), new Set()), false);
  assert.equal(canSaveVideoReview(event(), clipIds), true);
  assert.equal(canSaveVideoReview(event({ clip: null }), clipIds), false);
});

test('saved class reviews leave the pending queue and remain available for correction', () => {
  const pending = Array.from({ length: 14 }, (_, index) => event({
    id: index,
    last_seen: new Date(Date.UTC(2026, 9, 21, 12, 0, index)).toISOString(),
  }));
  const reviewed = event({ id: 'reviewed', feedback: { reviewed_class: 'car' },
    last_seen: '2026-10-21T12:01:00.000Z' });

  const groups = groupReviewableDetections([...pending, reviewed]);

  assert.equal(groups.pending.length, 12);
  assert.equal(groups.pending.some(item => item.feedback), false);
  assert.equal(groups.pending[0].id, 13);
  assert.deepEqual(groups.reviewed, [reviewed]);
  assert.deepEqual(groups.counted, []);
});
