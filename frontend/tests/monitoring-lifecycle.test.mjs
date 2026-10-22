import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireCameraViewer, monitoringCameraIds, setMonitoring, transientMonitoringCameraIds, updateProviderAvailability } from '../src/product/monitoring.ts';

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

test('provider outages suspend leases without erasing saved monitoring preferences', () => {
  setMonitoring('camera-provider-outage', true);
  updateProviderAvailability([{ id: 'camera-provider-outage', provider_in_service: false }]);
  assert.deepEqual(monitoringCameraIds(), []);

  updateProviderAvailability([{ id: 'camera-provider-outage', provider_in_service: true }]);
  assert.deepEqual(monitoringCameraIds(), ['camera-provider-outage']);
  setMonitoring('camera-provider-outage', false);
});

test('confirmed HLS source outages suspend automatic monitoring and recover after a valid check', () => {
  setMonitoring('camera-hls-outage', true);
  updateProviderAvailability([{ id: 'camera-hls-outage', provider_in_service: true, video_health: { state: 'unavailable' } }]);
  assert.deepEqual(monitoringCameraIds(), []);

  updateProviderAvailability([{ id: 'camera-hls-outage', provider_in_service: true, video_health: { state: 'available' } }]);
  assert.deepEqual(monitoringCameraIds(), ['camera-hls-outage']);
  setMonitoring('camera-hls-outage', false);
});
