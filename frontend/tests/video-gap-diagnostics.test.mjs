import test from 'node:test';
import assert from 'node:assert/strict';
import { describeContinuityCoverage, describeLatestSampleAge, describeVideoGap, liveCaptureIsFresh } from '../src/product/videoGapDiagnostics.ts';

test('describes only observable continuity evidence without guessing the cause', () => {
  assert.equal(describeVideoGap({ session_changed: true }), 'Monitoring ended and a new video session began; this unobserved gap does not confirm a stream outage.');
  assert.equal(describeVideoGap({ session_changed: false }), 'Analysis samples paused within the same video session; cause unverified.');
  assert.equal(describeVideoGap({ session_changed: false, in_progress: true }), 'Analysis has not resumed yet; cause unverified.');
});

test('does not infer a clean pause breakdown when the camera API omits the new counters', () => {
  const description = describeContinuityCoverage({ coverage_percent: 5.2, session_count: 3 });

  assert.match(description, /not source uptime/);
  assert.match(description, /Pause breakdown is unavailable/);
  assert.doesNotMatch(description, /No analysis gaps/);
});

test('separates gaps inside a session from gaps between separately observed sessions', () => {
  assert.equal(describeContinuityCoverage({
    coverage_percent: 40, session_count: 2, in_session_pause_count: 1,
    longest_in_session_pause_seconds: 8.4, session_boundary_gap_count: 3,
  }), 'Analysis coverage · 40% observed across 2 video sessions in the last 15 minutes. This measures when monitoring saved samples, not source uptime. 1 within-session analysis gaps over 2 seconds · longest 8.4s. 3 gaps between separately observed sessions.');
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
