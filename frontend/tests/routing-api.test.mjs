import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGraphStatus } from '../src/api/client.ts';

test('graph and routing requests have a bounded response deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  const request = fetchGraphStatus();
  t.mock.timers.tick(25000);
  await assert.rejects(request, /took too long/);
});

test('cancelling graph initialization aborts the underlying HTTP request', async t => {
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  const controller = new AbortController();
  const request = fetchGraphStatus(controller.signal);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});

test('gateway failures return a useful FlowSense service message', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Bad Gateway', { status: 502 }));
  await assert.rejects(fetchGraphStatus(), error => {
    assert.equal(error.message, 'The FlowSense service could not complete this request. Check service status and retry.');
    return true;
  });
});

test('network failures explain that FlowSense cannot be reached', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(fetchGraphStatus(), error => {
    assert.equal(error.message, 'Unable to reach the FlowSense service. Check your connection or service status, then retry.');
    return true;
  });
});

test('actionable API details remain visible when the service responds with an error', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ detail: 'The road graph is not ready.' }), { status: 503 }));
  await assert.rejects(fetchGraphStatus(), /The road graph is not ready/);
});
