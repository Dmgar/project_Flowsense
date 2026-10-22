import test from 'node:test';
import assert from 'node:assert/strict';
import { describeRoadCameraCoverage, describeRoadCameraLinks } from '../src/product/roadAssociationDiagnostics.ts';

test('reports measured, calibrated, and active camera coverage separately', () => {
  assert.equal(describeRoadCameraCoverage({ measured_camera_count: 2, camera_count: 5,
    calibrated_camera_count: 3, active_camera_count: 1 }),
  '2 of 5 linked camera estimates · 3 calibrated · 1 feeds live');
});

test('does not invent zero calibrated cameras when the API omits that field', () => {
  assert.equal(describeRoadCameraCoverage({ measured_camera_count: 0, camera_count: 5,
    active_camera_count: 0 }),
  '0 of 5 linked camera estimates · calibration status unavailable · 0 feeds live');
});

test('explains which camera links to the mapped road and whether its zone is set', () => {
  assert.equal(describeRoadCameraLinks([
    { camera_id: 'cam-1', distance_m: 168, zone_enabled: false },
    { camera_id: 'cam-2', distance_m: 24, zone_enabled: true },
    { camera_id: 'cam-3', distance_m: null, zone_enabled: false },
  ], new Map([['cam-1', 'I-10 · McClure West'], ['cam-2', 'I-10 · Channing Street']]), 2),
  'Linked cameras: I-10 · McClure West · approx. 168 m · zone needed · I-10 · Channing Street · approx. 24 m · zone set · +1 more');
});

test('reports missing road-camera linkage details without inventing a source', () => {
  assert.equal(describeRoadCameraLinks([], new Map()), 'Camera link details unavailable');
});
