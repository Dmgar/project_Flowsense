import test from 'node:test';
import assert from 'node:assert/strict';
import { observationDeskSelection } from '../src/product/deskSelection.ts';

const camera = (id, stream_url) => ({ id, name: id, lat: 34, lng: -118, district: 'Los Angeles', route: '', nearby_place: '', stream_url });

test('desk capacity counts only registered cameras with a video source', () => {
  const result = observationDeskSelection(['live-1', 'still', 'gone', 'live-2'], [
    camera('live-1', 'https://example.test/one.m3u8'), camera('still', ''), camera('live-2', 'https://example.test/two.m3u8'),
  ]);
  assert.deepEqual(result.playable.map(item => item.id), ['live-1', 'live-2']);
  assert.equal(result.usedSlots, 2);
  assert.equal(result.availableSlots, 2);
  assert.equal(result.isFull, false);
  assert.deepEqual(result.unsupportedIds, ['still']);
  assert.deepEqual(result.missingIds, ['gone']);
  assert.deepEqual([...result.invalidIds], ['still', 'gone']);
});

test('desk capacity reaches four with valid video sources and clamps at zero', () => {
  const cameras = ['a', 'b', 'c', 'd', 'e'].map(id => camera(id, `${id}.m3u8`));
  const result = observationDeskSelection(['a', 'b', 'c', 'd', 'e'], cameras);
  assert.equal(result.usedSlots, 4);
  assert.equal(result.availableSlots, 0);
  assert.equal(result.isFull, true);
  assert.deepEqual(result.playable.map(item => item.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(result.overflowIds, ['e']);
  assert.deepEqual([...result.invalidIds], ['e']);
});

test('duplicate persisted IDs do not create duplicate desk tiles or consume extra slots', () => {
  const result = observationDeskSelection(['a', 'a'], [camera('a', 'a.m3u8')]);
  assert.equal(result.usedSlots, 1);
  assert.deepEqual(result.playable.map(item => item.id), ['a']);
});

test('invalid persisted IDs do not consume capacity', () => {
  const result = observationDeskSelection(['gone'], []);
  assert.equal(result.usedSlots, 0);
  assert.equal(result.availableSlots, 4);
  assert.equal(result.isFull, false);
  assert.deepEqual(result.missingIds, ['gone']);
});
