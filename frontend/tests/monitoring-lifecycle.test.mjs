import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireCameraViewer, monitoringCameraIds, setMonitoring, transientMonitoringCameraIds } from '../src/product/monitoring.ts';

test('an open camera viewer keeps its capture lease until every view is released', () => {
  const releaseFirst = acquireCameraViewer('camera-a');
  const releaseSecond = acquireCameraViewer('camera-a');

  assert.deepEqual(monitoringCameraIds(), ['camera-a']);
  releaseFirst();
  assert.deepEqual(monitoringCameraIds(), ['camera-a']);
  releaseSecond();
  assert.deepEqual(monitoringCameraIds(), []);
});

test('closing a live view preserves an explicitly enabled background lease', () => {
  setMonitoring('camera-b', true);
  const release = acquireCameraViewer('camera-b');
  release();

  assert.deepEqual(monitoringCameraIds(), ['camera-b']);
  setMonitoring('camera-b', false);
  assert.deepEqual(monitoringCameraIds(), []);
});

test('page shutdown releases transient viewers but preserves explicit background monitoring', () => {
  setMonitoring('camera-background', true);
  const release = acquireCameraViewer('camera-foreground');

  assert.deepEqual(transientMonitoringCameraIds(monitoringCameraIds()), ['camera-foreground']);
  release();
  assert.deepEqual(transientMonitoringCameraIds(monitoringCameraIds()), []);

  setMonitoring('camera-background', false);
});
