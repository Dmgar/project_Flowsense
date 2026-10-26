import test from 'node:test';
import assert from 'node:assert/strict';
import { getCameras, getObservation, openCase } from '../src/product/api.ts';

function hangingFetch(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    const cancel = () => reject(new DOMException('Request cancelled', 'AbortError'));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}

test('camera discovery requests video-only sources and rejects image-only results', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.match(url, /cameras\?video_only=true$/);
    return new Response(JSON.stringify([
      { id: 'video', stream_url: 'https://example.test/playlist.m3u8', image_url: '/legacy-image' },
      { id: 'photo', stream_url: '', image_url: '/legacy-image' },
    ]));
  });
  assert.deepEqual((await getCameras()).map(camera => camera.id), ['video']);
});

test('video review retains its session timestamp without inventing a saved image', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.evidence_session_id, 'session-test');
    assert.equal(body.evidence_media_time_seconds, 14.25);
    assert.equal(body.evidence_frame_id, undefined);
    return new Response(JSON.stringify(body));
  });
  await openCase({ id: 'video-review', title: 'Review', location: 'Test', severity: 'medium',
    action: 'Video is not stored.', evidence_camera_id: 'video', data_origin: 'observation',
    evidence_session_id: 'session-test', evidence_media_time_seconds: 14.25 }, 'Traffic operations');
});

test('a stalled service cannot leave a camera request pending indefinitely', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', hangingFetch);
  const pending = getObservation('camera-a');
  t.mock.timers.tick(25000);
  await assert.rejects(pending, /took too long/);
});

test('leaving the camera cancels the request without misreporting a timeout', async t => {
  t.mock.method(globalThis, 'fetch', hangingFetch);
  const controller = new AbortController();
  const pending = getObservation('camera-a', controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('server errors retain the actionable detail supplied by the API', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ detail: 'The camera is not responding.' }), { status: 503 }));
  await assert.rejects(getObservation('camera-a'), /The camera is not responding/);
});

test('network failures explain the service connection problem without exposing browser error text', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(getObservation('camera-a'), error => {
    assert.equal(error.message, 'Unable to reach the FlowSense service. Check your connection or service status, then retry.');
    assert.doesNotMatch(error.message, /Failed to fetch|operation could not be completed/i);
    return true;
  });
});

test('gateway failures without an API detail tell the operator what to retry', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Bad Gateway', { status: 502 }));
  await assert.rejects(getObservation('camera-a'), error => {
    assert.equal(error.message, 'The FlowSense service could not complete this request. Check service status and retry.');
    return true;
  });
});

test('validation errors identify the input field instead of showing an object placeholder', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ detail: [{ loc: ['body', 'lat'], msg: 'Input should be less than or equal to 90' }] }), { status: 422 }));
  await assert.rejects(getObservation('camera-a'), /lat: Input should be less than or equal to 90/);
});

test('the deadline covers a stalled response body, not only response headers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({ ok: true, json: () => hangingFetch('', { signal }) }));
  const pending = getObservation('camera-a');
  await Promise.resolve();
  t.mock.timers.tick(25000);
  await assert.rejects(pending, /took too long/);
});
