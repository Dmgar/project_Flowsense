// Node 24+: read-only verification against the running local API.
import assert from 'node:assert/strict';
import { searchEvidence } from '../frontend/src/product/evidenceSearch.ts';

const base = 'http://127.0.0.1:8002/api/v1';
async function get(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(30000) });
  assert(response.ok, `${path}: ${response.status}`);
  return response.json();
}
const [cameras, graph] = await Promise.all([get('/mobility/cameras'), get('/graph/geojson')]);
assert(cameras.length >= 40);
const checks = ['Western Avenue', 'I-110', 'Santa Monica', 'Long Beach', 'Central Avenue'].map(query => {
  const started = performance.now();
  const result = searchEvidence(cameras, graph.features, query);
  if (query !== 'Central Avenue') assert(result.hits.length > 0, `No evidence for ${query}`);
  assert(result.hits.every(hit => hit.match === 'catalog' || hit.distanceKm <= 1.5));
  return { query, cameras: result.hits.length, street_segments: result.streets.length, nearby: result.hits.filter(hit => hit.match === 'nearby').length, elapsed_ms: Math.round(performance.now() - started) };
});
console.log(JSON.stringify({ catalog: cameras.length, edges: graph.features.length, checks }, null, 2));
