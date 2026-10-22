import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateHintCoverage, classReviewEvidenceStatus, detectionPipelineStatus, formatOutsideZoneSummary, formatTrackScore, visibleClassBreakdown, visibleDetectionCount } from '../src/product/detectionDiagnostics.ts';

test('live detection distinguishes a stale frame from an API without telemetry', () => {
  assert.equal(detectionPipelineStatus(null), 'stale');
  assert.equal(detectionPipelineStatus({}), 'unavailable');
  assert.equal(detectionPipelineStatus({ analysis_pipeline: {} }), 'unavailable');
  assert.equal(detectionPipelineStatus({}, 8.4, true), 'inference_only');
  assert.equal(detectionPipelineStatus({}, 8.4), 'unavailable');
  assert.equal(detectionPipelineStatus(null, 8.4, true), 'stale');
  assert.equal(detectionPipelineStatus({}, 0), 'unavailable');
  assert.equal(detectionPipelineStatus({ analysis_pipeline: { raw_candidates: 0 } }), 'ready');
});

test('track score is labeled separately from a provisional vehicle class', () => {
  assert.equal(formatTrackScore(0.802), '80% track score');
  assert.equal(formatTrackScore(-0.1), '0% track score');
  assert.equal(formatTrackScore(1.4), '100% track score');
  assert.equal(formatTrackScore(null), 'Track score unavailable');
});

test('outside-zone diagnostics identify excluded vehicle observations over the same window', () => {
  assert.equal(
    formatOutsideZoneSummary(3, { car: 2, bus: 1 }, 4),
    '3 outside-zone model observations in the last 4 seconds (2 cars, 1 bus). These are excluded from tracking and counts.',
  );
});

test('outside-zone diagnostics handle a singular observation and unknown model classes', () => {
  assert.equal(
    formatOutsideZoneSummary(1, { train: 1 }),
    '1 outside-zone model observation in the last 2 seconds (1 train object). These are excluded from tracking and counts.',
  );
});

test('visible count prefers the actual rendered detection list, including provisional tracks', () => {
  assert.equal(visibleDetectionCount([{ id: 1 }, { id: 2 }], 1), 2);
  assert.equal(visibleDetectionCount([], 3), 0);
  assert.equal(visibleDetectionCount(undefined, 3), 3);
  assert.equal(visibleDetectionCount(undefined, undefined), 0);
});

test('visible class breakdown distinguishes stable classes from pending types', () => {
  assert.deepEqual(visibleClassBreakdown([
    { class: 'car', class_status: 'stable' },
    { class: 'truck', class_status: 'uncertain' },
    { class: 'vehicle' },
  ]), { stable: 1, pending: 2 });
  assert.equal(visibleClassBreakdown(undefined), null);
});

test('candidate hint coverage is reported only for complete, internally consistent history', () => {
  assert.deepEqual(candidateHintCoverage(6271, 13261, true), {
    candidateCount: 6271, pendingVehicleCount: 13261, percent: 47.3,
  });
  assert.equal(candidateHintCoverage(2, 3, false), null);
  assert.equal(candidateHintCoverage(4, 3, true), null);
  assert.equal(candidateHintCoverage(0, 0, true), null);
});

test('class review status explains when clips are not linked to current track evidence', () => {
  assert.match(classReviewEvidenceStatus(0, 6, 52, true), /No detections in the loaded track history are linked to playable clips/i);
  assert.match(classReviewEvidenceStatus(0, 6, 52, true), /paused by the disk reserve/i);
  assert.match(classReviewEvidenceStatus(2, 6, 1, false), /2 recent detections have playable video/);
  assert.match(classReviewEvidenceStatus(0, 0, null, true), /No playable clip is available/);
});

test('outside-zone diagnostics explain an empty latest result without changing counts', () => {
  assert.equal(
    formatOutsideZoneSummary(0, { car: 4 }),
    'No model candidates were outside the inbound zone in the last 2 seconds.',
  );
  assert.equal(formatOutsideZoneSummary(Number.NaN), 'No model candidates were outside the inbound zone in the last 2 seconds.');
});
