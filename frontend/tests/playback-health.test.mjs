import test from 'node:test';
import assert from 'node:assert/strict';
import { bufferedLiveTarget, PlaybackHealth } from '../src/product/playbackHealth.ts';

test('a source that never yields a frame falls back after 35 seconds of active waiting', () => {
  const health = new PlaybackHealth(0);
  assert.equal(health.poll(34000), 'wait');
  assert.equal(health.poll(35000), 'fallback');
});

test('a voluntary pause or autoplay rejection does not expire the initial loading budget', () => {
  const health = new PlaybackHealth(0);
  health.setPaused(true, 1000);
  assert.equal(health.poll(180000), 'wait');
  assert.equal(health.requestRecovery(180000).action, 'wait');
  health.setPaused(false, 180000);
  assert.equal(health.poll(213000), 'wait');
  assert.equal(health.poll(214000), 'fallback');
});

test('time spent in the background does not turn into a stall when returning', () => {
  const health = new PlaybackHealth(0);
  health.recordProgress(1, 1000);
  health.setVisible(false, 2000);
  assert.equal(health.poll(300000), 'wait');
  health.setVisible(true, 300000);
  assert.equal(health.poll(301000), 'wait');
  assert.equal(health.poll(312000), 'recover');
});

test('fatal errors can recover immediately, but repeated errors are bounded', () => {
  const health = new PlaybackHealth(0);
  assert.deepEqual(health.requestRecovery(100), { action: 'retry', attempt: 1 });
  assert.equal(health.requestRecovery(200).action, 'wait');
  assert.deepEqual(health.requestRecovery(2200), { action: 'retry', attempt: 2 });
  assert.equal(health.requestRecovery(4300).action, 'fallback');
});

test('a frozen playhead triggers recovery and real movement clears the stall', () => {
  const health = new PlaybackHealth(0);
  health.recordProgress(5, 1000);
  assert.equal(health.poll(13000), 'recover');
  health.requestRecovery(13000);
  assert.equal(health.recordProgress(2, 14000), true); // Decoder restarted at an earlier position.
  assert.equal(health.poll(15000), 'wait');
  assert.equal(health.recordProgress(2, 16000), false);
  assert.equal(health.poll(26000), 'recover');
});

test('two retries do not permanently penalize a stream after sustained healthy playback', () => {
  const health = new PlaybackHealth(0);
  health.requestRecovery(100);
  health.requestRecovery(2200);
  for (let time = 3000; time <= 36000; time += 1000) health.recordProgress(time / 1000, time);
  assert.deepEqual(health.requestRecovery(50000), { action: 'retry', attempt: 1 });
});

test('seeking and zero-time metadata do not prove playback or consume retries', () => {
  const health = new PlaybackHealth(0);
  assert.equal(health.recordProgress(0, 1000), false);
  assert.equal(health.recordProgress(NaN, 2000), false);
  assert.equal(health.poll(5000, true), 'wait');
  health.recordProgress(3, 6000);
  assert.equal(health.poll(18000, true), 'wait');
  assert.equal(health.poll(19000), 'wait');
});

test('a long seek does not masquerade as thirty seconds of healthy playback', () => {
  const health = new PlaybackHealth(0);
  health.requestRecovery(100); health.requestRecovery(2200);
  health.recordProgress(1, 3000);
  health.poll(40000, true);
  health.recordProgress(30, 41000);
  assert.equal(health.requestRecovery(44000).action, 'fallback');
});

test('an unfulfilled seek cannot disable recovery forever', () => {
  const health = new PlaybackHealth(0);
  health.recordProgress(1, 1000);
  assert.equal(health.poll(2000, true), 'wait');
  assert.equal(health.poll(21999, true), 'wait');
  assert.equal(health.poll(22000, true), 'recover');
  assert.deepEqual(health.requestRecovery(22000), { action: 'retry', attempt: 1 });
  health.poll(23000, true);
  assert.equal(health.poll(43000, true), 'recover');
  assert.deepEqual(health.requestRecovery(43000), { action: 'retry', attempt: 2 });
  health.poll(44000, true);
  assert.equal(health.poll(64000, true), 'recover');
  assert.equal(health.requestRecovery(64000).action, 'fallback');
});

test('live recovery never jumps to a VOD end or an undownloaded live interval', () => {
  assert.equal(bufferedLiveTarget(false, 178, [[0, 30]]), null);
  assert.equal(bufferedLiveTarget(true, 178, [[0, 30]]), null);
  assert.equal(bufferedLiveTarget(true, 29, [[0, 30]]), 29);
  assert.equal(bufferedLiveTarget(true, 35, [[0, 30], [40, 50]]), null);
  assert.equal(bufferedLiveTarget(true, NaN, [[0, 30]]), null);
});
