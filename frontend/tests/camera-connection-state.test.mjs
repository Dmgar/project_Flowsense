import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshCameraCatalogAfterConnect } from '../src/product/cameraConnectionState.ts';

test('a successful catalog refresh keeps the newly connected camera even if the response is stale', async () => {
  const connected = { id: 'camera-new', name: 'New camera' };
  const result = await refreshCameraCatalogAfterConnect(connected, [], async () => [{ id: 'camera-old', name: 'Existing camera' }]);

  assert.equal(result.refreshed, true);
  assert.deepEqual(result.cameras, [
    { id: 'camera-old', name: 'Existing camera' },
    connected,
  ]);
});

test('a failed catalog refresh keeps the confirmed camera without duplicating an existing entry', async () => {
  const connected = { id: 'camera-new', name: 'New camera' };
  const result = await refreshCameraCatalogAfterConnect(connected, [connected, { id: 'camera-old', name: 'Existing camera' }], async () => {
    throw new Error('catalog unavailable');
  });

  assert.equal(result.refreshed, false);
  assert.deepEqual(result.cameras, [
    { id: 'camera-old', name: 'Existing camera' },
    connected,
  ]);
});
