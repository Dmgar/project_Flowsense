import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cameraMatches, normalizeStreet, distanceToLineKm, searchEvidence, nearbyCameraOptions } from '../src/product/evidenceSearch.ts';

const camera = (id, name, lat = 34, lng = -118) => ({ id, name, lat, lng, district: 'Los Angeles', route: '', nearby_place: '' });
const edge = (u, v, coordinates) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { u, v, name: 'Central Avenue' } });

test('street abbreviations, accents and freeway numbers are understood without matching I-10 to I-110', () => {
  assert.equal(normalizeStreet('Wéstern Avenue'), normalizeStreet('Western Ave'));
  assert(cameraMatches(camera('a', 'I-110 : (1) Western Ave'), 'avenida Western'));
  assert(cameraMatches(camera('a', 'I-110 : (1) Western Ave'), 'calle Western'));
  assert(cameraMatches(camera('a', 'I-110 : (1) Western Ave'), 'autopista 110'));
  assert(!cameraMatches(camera('b', 'I-10 : (2) Main St'), 'I-110'));
});

test('proximity uses the complete segment instead of just endpoints', () => {
  const line = [[-118.1, 34], [-117.9, 34]];
  assert(distanceToLineKm(34.001, -118, line) < .12);
  assert(distanceToLineKm(34.1, -118, line) > 10);
});

test('catalog matches and nearby cameras remain distinct and radius is respected', () => {
  const cameras = [camera('direct', 'Central Ave', 34.1), camera('near', 'Another road', 34.005), camera('far', 'Remote', 34.2)];
  const edges = [edge(1, 2, [[-118.01, 34], [-117.99, 34]]), edge(2, 1, [[-117.99, 34], [-118.01, 34]])];
  const result = searchEvidence(cameras, edges, 'Central Avenue', 1.5);
  assert.equal(result.streets.length, 1);
  assert.deepEqual(result.hits.map(hit => [hit.camera.id, hit.match]), [['direct', 'catalog'], ['near', 'nearby']]);
  assert.equal(searchEvidence(cameras, edges, 'Central Avenue', .5).hits.length, 1);
  assert.equal(searchEvidence(cameras, edges, 'Unknown street').hits.length, 0);
});

test('all registered cameras remain discoverable and the real catalog supports street and city searches', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../data/public_cameras_los_angeles.json', import.meta.url), 'utf8'));
  assert.equal(searchEvidence(catalog, [], '').hits.length, catalog.length);
  assert(searchEvidence(catalog, [], 'Western Ave').hits.length >= 1);
  assert.equal(searchEvidence(catalog, [], 'Long Beach').hits.length, catalog.filter(c => c.district === 'Long Beach').length);
});

test('video alternatives exclude the current camera, distant sources and sources without a stream', () => {
  const origin = { ...camera('current', 'Origin'), stream_url: 'current.m3u8' };
  const others = [origin, { ...camera('far', 'Far', 35), stream_url: 'far.m3u8' }, camera('image-only', 'Still'),
    ...[.04, .01, .02, .03].map((delta, i) => ({ ...camera(`near-${i}`, 'Near', 34 + delta), stream_url: 'live.m3u8' }))];
  const result = nearbyCameraOptions(others, origin);
  assert.deepEqual(result.map(item => item.camera.id), ['near-1', 'near-2', 'near-3']);
  assert(result.every(item => item.distanceKm > 0 && item.distanceKm < 10));
});
