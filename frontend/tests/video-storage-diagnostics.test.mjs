import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClipCapacityNote, formatPausedVideoAnalysisStatus, partitionVideoClips, videoWriterStatus } from '../src/product/videoStorageDiagnostics.ts';

test('storage pause reports persisted analysis separately from paused MP4 evidence', () => {
  assert.equal(formatPausedVideoAnalysisStatus(3577, 900),
    'Live detection history is still being saved: 3,577 analysis samples in the last 15 minutes. MP4 clip recording is paused by the storage safeguard.');
});

test('analysis pause status handles short windows and malformed counts safely', () => {
  assert.equal(formatPausedVideoAnalysisStatus(Number.NaN, 1),
    'Live detection history is still being saved: 0 analysis samples in the last 1 second. MP4 clip recording is paused by the storage safeguard.');
});

test('a transient encoder queue warning does not claim MP4 recording has paused', () => {
  const status = videoWriterStatus('Evidence writer fell behind; a few clip frames may be missing. Camera analysis continues.');
  assert.deepEqual(status, {
    pauseReason: '',
    warning: 'Evidence writer fell behind; a few clip frames may be missing. Camera analysis continues.',
  });
});

test('observation queue delays are reported without claiming video or inference stopped', () => {
  const warning = 'Observation history writer fell behind; recent road analysis may be delayed. Live video and inference continue.';
  assert.deepEqual(videoWriterStatus(warning), { pauseReason: '', warning });
});

test('storage guards and permanent writer errors still pause recording', () => {
  assert.deepEqual(videoWriterStatus('', 'Video evidence paused: the 5 GB clip storage limit is reached.'), {
    pauseReason: 'Video evidence paused: the 5 GB clip storage limit is reached.',
    warning: '',
  });
  assert.deepEqual(videoWriterStatus('Could not save camera observations or video evidence.'), {
    pauseReason: 'Could not save camera observations or video evidence.',
    warning: '',
  });
});

test('short captures are excluded from review video while their count remains visible', () => {
  const result = partitionVideoClips([
    { id: 'short', state: 'ready', duration: .067 },
    { id: 'retained-short', state: 'short', duration: .2 },
    { id: 'playable', state: 'ready', duration: .25 },
    { id: 'interrupted', state: 'interrupted', duration: 3 },
  ]);
  assert.deepEqual(result, { reviewable: [{ id: 'playable', state: 'ready', duration: .25 }], shortCount: 2 });
});

test('available clip quota explains both independent storage guards', () => {
  assert.equal(
    formatClipCapacityNote(1.07, 79, false, false),
    '1.07 GB of clip quota remains. New clips pause if the quota is exhausted or the free-disk safety reserve is reached.',
  );
});

test('paused recording does not claim the clip quota is full when the API omits its trigger', () => {
  assert.equal(
    formatClipCapacityNote(1.07, 79, true, false),
    '1.07 GB of clip quota remains. The server reports recording is paused but does not identify the storage trigger; live detection and observation history continue.',
  );
});

test('a specific backend storage reason is summarized without replacing the detailed reason', () => {
  assert.equal(
    formatClipCapacityNote(1.07, 79, true, true),
    '1.07 GB of clip quota remains. Recording is paused by the storage safeguard reported above; live detection and observation history continue.',
  );
});

test('a full clip quota is identified directly', () => {
  assert.equal(
    formatClipCapacityNote(0, 100, true, false),
    'Video clips are paused at the clip storage cap. Live detection and observations continue.',
  );
});
