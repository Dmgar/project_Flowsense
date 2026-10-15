import test from 'node:test';
import assert from 'node:assert/strict';
import { getObservation } from '../src/product/api.ts';

function hangingFetch(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    const cancel = () => reject(new DOMException('Request cancelled', 'AbortError'));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}

test('a stalled service cannot leave a camera request pending indefinitely', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', hangingFetch);
  const pending = getObservation('camera-a');
  t.mock.timers.tick(25000);
  await assert.rejects(pending, /tardó demasiado/);
});

test('leaving the camera cancels the request without misreporting a timeout', async t => {
  t.mock.method(globalThis, 'fetch', hangingFetch);
  const controller = new AbortController();
  const pending = getObservation('camera-a', controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('server errors retain the actionable detail supplied by the API', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ detail: 'La cámara no responde.' }), { status: 503 }));
  await assert.rejects(getObservation('camera-a'), /La cámara no responde/);
});

test('the deadline covers a stalled response body, not only response headers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({ ok: true, json: () => hangingFetch('', { signal }) }));
  const pending = getObservation('camera-a');
  await Promise.resolve();
  t.mock.timers.tick(25000);
  await assert.rejects(pending, /tardó demasiado/);
});
