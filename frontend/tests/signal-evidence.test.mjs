import test from 'node:test';
import assert from 'node:assert/strict';
import { observedCaseSignal, resolveSignalCameraEvidence, signalNextCheck } from '../src/product/signalEvidence.ts';

const camera = (id) => ({ id, name: `Camera ${id}` });
const observation = (evidence_camera_id = 'cam-2') => ({ data_origin: 'observation', evidence_camera_id });

test('scenario signals never borrow an unrelated camera as evidence', () => {
  assert.deepEqual(resolveSignalCameraEvidence({ data_origin: 'presentation' }, [camera('cam-1')], true, false), { state: 'illustrative' });
  assert.deepEqual(resolveSignalCameraEvidence({}, [camera('cam-1')], true, false), { state: 'illustrative' });
});

test('observation evidence resolves only its saved camera ID', () => {
  assert.deepEqual(resolveSignalCameraEvidence(observation(), [camera('cam-1'), camera('cam-2')], true, false), { state: 'linked', camera: camera('cam-2') });
  assert.deepEqual(resolveSignalCameraEvidence(observation(), [camera('cam-1')], true, false), { state: 'not_in_catalog' });
});

test('camera evidence distinguishes an unlinked case, loading, and catalog failure', () => {
  assert.deepEqual(resolveSignalCameraEvidence(observation(null), [], true, false), { state: 'unlinked' });
  assert.deepEqual(resolveSignalCameraEvidence(observation(), [], false, false), { state: 'loading' });
  assert.deepEqual(resolveSignalCameraEvidence(observation(), [], false, true), { state: 'catalog_unavailable' });
});

test('a saved linked camera may remain visible with an explicit refresh failure state', () => {
  assert.deepEqual(resolveSignalCameraEvidence(observation(), [camera('cam-2')], false, true), { state: 'linked_catalog_unavailable', camera: camera('cam-2') });
});

test('next checks match the evidence state instead of assuming every signal has a live camera', () => {
  assert.match(signalNextCheck('illustrative'), /illustrative example, not a current observation/);
  assert.match(signalNextCheck('unlinked'), /has no linked camera/);
  assert.match(signalNextCheck('loading'), /still loading/);
  assert.match(signalNextCheck('catalog_unavailable'), /Retry it before relying/);
  assert.match(signalNextCheck('not_in_catalog'), /not in the current catalog/);
  assert.match(signalNextCheck('linked'), /Open the linked camera/);
  assert.match(signalNextCheck('linked_catalog_unavailable'), /may be out of date/);
});

test('saved observation cases become City pulse entries linked to their recorded camera', () => {
  const item = { id: 'case-1', signal_id: 'sig-1', title: 'Vehicle review', owner: 'Ops', severity: 'medium', status: 'under_review', data_origin: 'observation', note: 'Checked the saved frame.', created_at: '', updated_at: '', audit: [], evidence_camera_id: 'cam-2', evidence_frame_id: 'frame-7', confidence: 0.74 };
  const source = { id: 'cam-2', name: 'Northbound camera', district: 'Long Beach', lat: 33.77, lng: -118.19 };
  const signal = observedCaseSignal(item, [camera('cam-1'), source]);
  assert.equal(signal.id, 'sig-1');
  assert.equal(signal.title, 'Manual image review');
  assert.equal(signal.location, 'Northbound camera');
  assert.equal(signal.district, 'Long Beach');
  assert.equal(signal.evidence_camera_id, 'cam-2');
  assert.equal(signal.evidence_frame_id, 'frame-7');
  assert.equal(signal.action, 'Checked the saved frame.');
  assert.equal(signal.data_origin, 'observation');
});
