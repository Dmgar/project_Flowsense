import test from 'node:test';
import assert from 'node:assert/strict';
import { describeLatestSampleAge, describeVideoGap, liveCaptureIsFresh } from '../src/product/videoGapDiagnostics.ts';

test('describes only observable continuity evidence without guessing the cause', () => {
  assert.equal(describeVideoGap({ session_changed: true }), 'Video session changed across this gap; the trigger is unverified.');
  assert.equal(describeVideoGap({ session_changed: false }), 'Analysis samples paused within the same video session; cause unverified.');
  assert.equal(describeVideoGap({ session_changed: false, in_progress: true }), 'Analysis has not resumed yet; cause unverified.');
});

test('live decoder and inference status distinguish delayed persistence from a stale camera', () => {
  const fresh = { active: true, session_state: 'Live', sample_age_seconds: .4 };
  assert.equal(liveCaptureIsFresh(fresh), true);
  assert.equal(liveCaptureIsFresh({ ...fresh, sample_age_seconds: 6 }), false);
  assert.equal(liveCaptureIsFresh({ ...fresh, session_state: 'Connecting' }), false);
  assert.match(describeVideoGap({ session_changed: false, in_progress: true }, true), /Live video is active/);
  assert.match(describeLatestSampleAge(18, true), /Live video and inference are active/);
  assert.match(describeLatestSampleAge(18, false), /may have stopped/);
});
