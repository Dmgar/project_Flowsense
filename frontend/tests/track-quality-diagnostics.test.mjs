import test from 'node:test';
import assert from 'node:assert/strict';
import { trackQualityFromRecentHistory } from '../src/product/trackQualityDiagnostics.ts';

const now = Date.parse('2026-10-21T15:00:00.000Z');
const event = (overrides = {}) => ({
  counted: true, class: 'car', first_seen: '2026-10-21T14:59:58.500Z',
  last_seen: '2026-10-21T14:59:59.500Z', crossed_at: '2026-10-21T14:59:59.400Z', observations: 8,
  ...overrides,
});

test('recent saved history fallback measures brief counted tracks and sample scope', () => {
  assert.deepEqual(trackQualityFromRecentHistory([
    event(), event({ first_seen: '2026-10-21T14:59:50.000Z', last_seen: '2026-10-21T14:59:54.000Z', observations: 12 }),
    event({ counted: false }), event({ class: 'Rider' }), event({ class: 'Person' }), event({ crossed_at: '2026-10-21T14:58:00.000Z' }),
  ], now), {
    counted_track_count: 2, measurable_track_count: 2, brief_track_count: 1, brief_track_percent: 50,
    average_observations: 10, history_event_count: 6,
  });
});

test('history fallback handles missing timestamps and excludes future crossings', () => {
  const result = trackQualityFromRecentHistory([
    event({ first_seen: null }), event({ crossed_at: '2026-10-21T15:00:01.000Z' }),
    event({ effective_class: 'false_positive' }),
  ], now);
  assert.deepEqual(result, {
    counted_track_count: 1, measurable_track_count: 0, brief_track_count: 0, brief_track_percent: null,
    average_observations: 8, history_event_count: 3,
  });
});

test('duration percentage excludes counted records with missing duration timestamps', () => {
  const result = trackQualityFromRecentHistory([
    event(), event({ first_seen: null }),
  ], now);
  assert.equal(result.counted_track_count, 2);
  assert.equal(result.measurable_track_count, 1);
  assert.equal(result.brief_track_percent, 100);
});

test('empty history does not invent a duration percentage', () => {
  const result = trackQualityFromRecentHistory([], now);
  assert.equal(result.brief_track_percent, null);
  assert.equal(result.counted_track_count, 0);
});
