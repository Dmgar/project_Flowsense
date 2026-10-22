import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveTrackTrailBuffer } from '../src/product/liveTrackTrails.ts';

const reading = (sequence, bbox, { session = 'session-a', generation = 1 } = {}) => ({
  session_id: session,
  metrics: { sequence, generation, observed_detections: [{ id: 7, class: 'vehicle', bbox }] },
});

test('reconstructs a short per-track trail from advancing detections without duplicate polls', () => {
  const buffer = new LiveTrackTrailBuffer();
  assert.deepEqual(buffer.update(reading(1, [10, 10, 10, 10]), 1000), []);
  assert.deepEqual(buffer.update(reading(2, [20, 10, 10, 10]), 1500), []);
  assert.deepEqual(buffer.update(reading(2, [20, 10, 10, 10]), 1750), []);
  const completed = buffer.update(reading(3, [30, 10, 10, 10]), 2000);
  assert.deepEqual(completed[0].trail, [[15, 20], [25, 20], [35, 20]]);
});

test('resets track trails when the camera session or analysis generation changes', () => {
  const buffer = new LiveTrackTrailBuffer();
  buffer.update(reading(1, [10, 10, 10, 10]), 1000);
  buffer.update(reading(2, [20, 10, 10, 10]), 1200);
  buffer.update(reading(3, [30, 10, 10, 10]), 1400);

  assert.deepEqual(buffer.update(reading(1, [100, 10, 10, 10], { generation: 2 }), 1600), []);
  buffer.update(reading(2, [110, 10, 10, 10], { generation: 2 }), 1800);
  assert.deepEqual(buffer.update(reading(3, [120, 10, 10, 10], { generation: 2 }), 2000)[0].trail,
    [[105, 20], [115, 20], [125, 20]]);
  assert.deepEqual(buffer.update(reading(1, [200, 10, 10, 10], { session: 'session-b' }), 2200), []);
});

test('expires trails after brief detections disappear and trims history to twelve points', () => {
  const buffer = new LiveTrackTrailBuffer();
  for (let sequence = 1; sequence <= 14; sequence += 1) {
    buffer.update(reading(sequence, [sequence * 2, 10, 10, 10]), sequence * 100);
  }
  const current = buffer.update(reading(14, [28, 10, 10, 10]), 1400);
  assert.equal(current[0].trail.length, 12);
  assert.deepEqual(buffer.update(reading(14, [28, 10, 10, 10]), 4001), []);
});

test('uses server trails when supplied by a newer backend', () => {
  const buffer = new LiveTrackTrailBuffer();
  const result = buffer.update({ session_id: 'session-a', metrics: { sequence: 1, generation: 1,
    observed_detections: [{ id: 7, class: 'car', bbox: [10, 10, 10, 10],
      trail: [[10, 20], [20, 20], [30, 20]] }] } }, 1000);
  assert.deepEqual(result[0].trail, [[10, 20], [20, 20], [30, 20]]);
});
