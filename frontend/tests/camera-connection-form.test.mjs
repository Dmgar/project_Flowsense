import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCameraConnection } from '../src/product/cameraConnectionForm.ts';

const valid = { name: 'Downtown camera', source: 'https://public.example/live.m3u8', lat: '34.04', lng: '-118.25' };

test('camera connection accepts supported video URLs and webcam indices', () => {
  assert.deepEqual(validateCameraConnection(valid), {});
  assert.deepEqual(validateCameraConnection({ ...valid, source: 'rtsp://camera.example/live' }), {});
  assert.deepEqual(validateCameraConnection({ ...valid, source: '0' }), {});
});

test('camera connection rejects malformed, credentialed, unsupported and still-image sources', () => {
  assert.match(validateCameraConnection({ ...valid, source: 'not a URL' }).source, /HTTP\(S\) or RTSP/);
  assert.match(validateCameraConnection({ ...valid, source: 'https://user:secret@camera.example/live.m3u8' }).source, /Remove usernames and passwords/);
  assert.match(validateCameraConnection({ ...valid, source: 'https://camera.example/image.jpg?live=1' }).source, /Still images are not supported/);
  assert.match(validateCameraConnection({ ...valid, source: 'file:///tmp/video.mp4' }).source, /HTTP\(S\) or RTSP/);
});

test('camera connection validates names and decimal coordinate ranges', () => {
  const errors = validateCameraConnection({ ...valid, name: '  ', lat: '90.01', lng: '-181' });
  assert.match(errors.name, /2 to 120/);
  assert.match(errors.lat, /latitude between/);
  assert.match(errors.lng, /longitude between/);
  assert.deepEqual(validateCameraConnection({ ...valid, lat: '-90', lng: '180' }), {});
});
