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

test('provider-reported out-of-service cameras remain listed but are not ranked as usable', () => {
  const result = cameraStatus({ ...camera('https://example.test/live.m3u8', 200), provider_in_service: false });
  assert.equal(result.label, 'Provider reports out of service');
  assert.equal(result.tone, 'amber');
  assert.equal(result.usable, false);
});

test('a live HLS health check can mark a source unavailable without changing catalog data', () => {
  const result = cameraStatus({ ...camera('https://example.test/live.m3u8'), video_health: {
    state: 'unavailable', http_status: 404, checked_at: '2026-10-22T00:00:00Z', message: 'The HLS endpoint returned HTTP 404.',
  } });
  assert.equal(result.label, 'The HLS endpoint returned HTTP 404.');
  assert.equal(result.tone, 'amber');
  assert.equal(result.usable, false);
});

test('expired HLS checks stay usable but are clearly labeled as stale', () => {
  const result = cameraStatus({ ...camera('https://example.test/live.m3u8'), video_health: {
    state: 'stale', http_status: 206, checked_at: '2026-10-22T00:00:00Z',
    message: 'The last HLS check returned HTTP 206; a fresh check is pending.',
  } });
  assert.equal(result.label, 'The last HLS check returned HTTP 206; a fresh check is pending.');
  assert.equal(result.tone, 'amber');
  assert.equal(result.usable, true);
});

test('temporary HLS probe failures remain usable and are not mislabeled as offline', () => {
  const result = cameraStatus({ ...camera('https://example.test/live.m3u8'), video_health: {
    state: 'temporary_error', http_status: null, checked_at: '2026-10-22T00:00:00Z',
    message: 'The HLS source timed out or is temporarily unavailable.',
  } });
  assert.equal(result.label, 'Source check timed out · retry pending');
  assert.equal(result.tone, 'amber');
  assert.equal(result.usable, true);
});
