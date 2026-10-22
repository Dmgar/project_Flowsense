import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraMediaErrorMessage, shouldRetryCameraMediaError, shouldRetryCameraRequestStatus } from '../src/product/cameraMediaError.ts';

test('unsupported-source retries stop until a frame proves this camera can play', () => {
  assert.match(cameraMediaErrorMessage(1), /interrupted/i);
  assert.match(cameraMediaErrorMessage(2), /network error/i);
  assert.match(cameraMediaErrorMessage(3), /decode/i);
  assert.match(cameraMediaErrorMessage(4), /not supported/i);
  assert.match(cameraMediaErrorMessage(99), /failed in the browser/i);
  assert.equal(shouldRetryCameraMediaError(1), true);
  assert.equal(shouldRetryCameraMediaError(3), true);
  assert.equal(shouldRetryCameraMediaError(4, 0), true);
  assert.equal(shouldRetryCameraMediaError(4, 1), true);
  assert.equal(shouldRetryCameraMediaError(4, 2), true);
  assert.equal(shouldRetryCameraMediaError(4, 3), false);
  assert.equal(shouldRetryCameraMediaError(4, 3, true), true);
  assert.equal(shouldRetryCameraMediaError(4, 100, true), true);
});

test('transient HTTP responses retry camera negotiation while invalid requests stop', () => {
  assert.equal(shouldRetryCameraRequestStatus(408), true);
  assert.equal(shouldRetryCameraRequestStatus(429), true);
  assert.equal(shouldRetryCameraRequestStatus(500), true);
  assert.equal(shouldRetryCameraRequestStatus(502), true);
  assert.equal(shouldRetryCameraRequestStatus(503), true);
  assert.equal(shouldRetryCameraRequestStatus(504), true);
  assert.equal(shouldRetryCameraRequestStatus(400), false);
  assert.equal(shouldRetryCameraRequestStatus(404), false);
  assert.equal(shouldRetryCameraRequestStatus(422), false);
});
