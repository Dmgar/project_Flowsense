import test from 'node:test';
import assert from 'node:assert/strict';
import { monitoringPollDelay } from '../src/product/monitoringPollDelay.ts';

test('monitoring refresh backs off after failures and resets immediately on recovery', () => {
  assert.equal(monitoringPollDelay(0, true), 3_000);
  assert.equal(monitoringPollDelay(1, false), 6_000);
  assert.equal(monitoringPollDelay(2, false), 12_000);
  assert.equal(monitoringPollDelay(8, false), 12_000);
  assert.equal(monitoringPollDelay(8, true), 3_000);
});

test('invalid failure counts never produce a faster-than-base retry', () => {
  assert.equal(monitoringPollDelay(-1, false), 6_000);
  assert.equal(monitoringPollDelay(Number.NaN, false), 6_000);
});
