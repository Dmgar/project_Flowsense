import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldLoadMap } from '../src/product/mapLoading.ts';

const entry = (isIntersecting, width, height, bottom, rootTop = 100) => ({
  isIntersecting,
  boundingClientRect: { width, height, bottom },
  rootBounds: rootTop === null ? null : { top: rootTop },
});

test('a deferred map loads when approaching, after passing it, and never from a hidden zero-size route', () => {
  assert.equal(shouldLoadMap(entry(true, 300, 200, 450)), true);
  assert.equal(shouldLoadMap(entry(false, 300, 200, 450)), false);
  assert.equal(shouldLoadMap(entry(false, 300, 200, 80)), true);
  assert.equal(shouldLoadMap(entry(false, 0, 0, 0)), false);
  assert.equal(shouldLoadMap(entry(false, 300, 200, 80, null)), false);
});
