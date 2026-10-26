import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraFrameHealth } from '../src/product/cameraFrameHealth.ts';
import { shouldWatchCameraFrames } from '../src/product/reconnectPolicy.ts';

test('a stream with no decoded frame expires after 15 seconds of active playback only', () => {
  const health = new CameraFrameHealth(0);
  assert.equal(health.poll(10_000, true), 'wait');
  assert.equal(health.poll(80_000, false), 'wait');
  assert.equal(health.poll(84_999, true), 'wait');
  assert.equal(health.poll(85_000, true), 'no-frame');
});

test('decoded frames refresh the stall timer and a frozen stream is detected', () => {
  const health = new CameraFrameHealth(0);
  health.recordFrame(1_000);
  assert.equal(health.poll(8_999, true), 'wait');
  assert.equal(health.poll(9_000, true), 'stalled');
  health.recordFrame(14_000);
  assert.equal(health.poll(21_999, true), 'wait');
  assert.equal(health.poll(22_000, true), 'stalled');
});

test('a user pause does not expire the no-frame budget', () => {
  const health = new CameraFrameHealth(0);
  assert.equal(health.poll(10_000, true), 'wait');
  assert.equal(health.poll(100_000, false), 'wait');
  assert.equal(health.poll(104_999, true), 'wait');
  assert.equal(health.poll(105_000, true), 'no-frame');
});

test('a missing WebRTC media track expires even when the video element is still paused', () => {
  const health = new CameraFrameHealth(0);
  health.beginTrackWait(0);
  assert.equal(health.poll(0, true, false), 'wait');
  assert.equal(health.poll(7_999, true, false), 'wait');
  assert.equal(health.poll(8_000, true, false), 'no-track');
  health.recordTrack(8_000);
  assert.equal(health.poll(8_001, true, true), 'wait');
  assert.equal(health.poll(22_999, true, true), 'wait');
  assert.equal(health.poll(23_000, true, true), 'no-frame');
});

test('an unpaused camera view times out when no WebRTC track arrives and the video element remains paused', () => {
  const health = new CameraFrameHealth(0);
  health.beginTrackWait(0);
  const watching = shouldWatchCameraFrames(true, false);
  assert.equal(watching, true);
  assert.equal(health.poll(0, watching, false), 'wait');
  assert.equal(health.poll(7_999, watching, false), 'wait');
  assert.equal(health.poll(8_000, watching, false), 'no-track');
});

test('an autoplay-blocked element still times out if the media track itself never arrived', () => {
  const health = new CameraFrameHealth(0);
  health.beginTrackWait(0);
  const watching = shouldWatchCameraFrames(true, false, false, true);
  assert.equal(watching, true);
  assert.equal(health.poll(0, watching, false), 'wait');
  assert.equal(health.poll(8_000, watching, false), 'no-track');
  assert.equal(shouldWatchCameraFrames(true, false, true, true), false);
});

test('intentional pause and background tab suspend the missing-track watchdog', () => {
  assert.equal(shouldWatchCameraFrames(true, true), false);
  assert.equal(shouldWatchCameraFrames(false, false), false);
});

test('background time does not consume the missing-track deadline', () => {
  const health = new CameraFrameHealth(0);
  health.beginTrackWait(0);
  assert.equal(health.poll(5_000, false, false), 'wait');
  assert.equal(health.poll(100_000, false, false), 'wait');
  assert.equal(health.poll(107_999, true, false), 'wait');
  assert.equal(health.poll(108_000, true, false), 'no-track');
});

test('background time does not turn a resumed decoded stream into a false stall', () => {
  const health = new CameraFrameHealth(0);
  health.recordTrack(0);
  health.recordFrame(100);
  assert.equal(health.poll(5_000, false), 'wait');
  assert.equal(health.poll(90_000, false), 'wait');
  // On visibility return the old wall-clock gap is discarded; the camera gets
  // a fresh active playback window to deliver its next frame.
  assert.equal(health.poll(90_001, true), 'wait');
  assert.equal(health.poll(97_999, true), 'wait');
  assert.equal(health.poll(98_001, true), 'stalled');
});

test('frame delivery after a long background interval resets the resumed stall window', () => {
  const health = new CameraFrameHealth(0);
  health.recordTrack(0);
  health.recordFrame(100);
  health.poll(5_000, false);
  health.poll(60_000, false);
  health.recordFrame(60_001);
  assert.equal(health.poll(67_999, true), 'wait');
  assert.equal(health.poll(68_001, true), 'stalled');
});
