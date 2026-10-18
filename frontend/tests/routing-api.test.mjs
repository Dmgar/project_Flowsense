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
