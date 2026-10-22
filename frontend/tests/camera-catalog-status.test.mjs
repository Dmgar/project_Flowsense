import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraCatalogStatus } from '../src/product/cameraCatalogStatus.ts';

test('camera catalog distinguishes loading, loaded empty, failed, and ready states', () => {
  assert.equal(cameraCatalogStatus(0, false, false), 'loading');
  assert.equal(cameraCatalogStatus(0, true, false), 'empty');
  assert.equal(cameraCatalogStatus(0, false, true), 'error');
  assert.equal(cameraCatalogStatus(71, true, false), 'ready');
});
