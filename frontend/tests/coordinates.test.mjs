import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoordinates } from '../src/product/coordinates.ts';

test('incomplete coordinates cannot silently become a location at zero latitude or longitude', () => {
  for (const value of [',', ' , -118.2', '34.04, ', '34.04', '34.04,-118.2,1', 'NaN,-118.2', '91,0', '0,181']) {
    assert.throws(() => parseCoordinates(value), /Enter a latitude/);
  }
});

test('explicit zero coordinates and geographic boundaries remain valid', () => {
  assert.deepEqual(parseCoordinates('0,0'), { latitude: 0, longitude: 0 });
  assert.deepEqual(parseCoordinates(' -90, 180 '), { latitude: -90, longitude: 180 });
  assert.deepEqual(parseCoordinates('34.0437,-118.2505'), { latitude: 34.0437, longitude: -118.2505 });
});
