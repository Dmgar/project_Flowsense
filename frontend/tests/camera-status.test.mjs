import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraStatus } from '../src/product/cameraStatus.ts';

const camera = (stream_url, hls_status) => ({ stream_url, hls_status });

test('camera status treats string and numeric HTTP 200 as a previous URL response', () => {
  for (const status of [200, '200']) {
    assert.equal(cameraStatus(camera('https://example.test/live.m3u8', status)).label, 'HLS URL returned HTTP 200 previously · open to confirm playback');
  }
});

test('camera status does not claim an unresponsive or missing video URL was checked', () => {
  assert.equal(cameraStatus(camera('https://example.test/live.m3u8', 'unavailable')).label, 'Video source registered · open to connect');
  assert.equal(cameraStatus(camera('', 200)).label, 'Video not supported');
});
