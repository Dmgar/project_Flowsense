import test from 'node:test';
import assert from 'node:assert/strict';

// Unit environment only; this does not certify interactions in a real browser.
const saved = new Map();
globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
const location = { pathname: '/overview', search: '' };
const updateLocation = path => { const next = new URL(path, 'http://localhost'); location.pathname = next.pathname; location.search = next.search; };
const events = {};
globalThis.window = { localStorage: globalThis.localStorage, location, history: { pushState: (_state, _title, path) => updateLocation(path), replaceState: (_state, _title, path) => updateLocation(path) }, addEventListener: (name, action) => { events[name] = action; } };
const { useProduct } = await import('../src/product/store.ts');

test('observation desk retains four sources and rejects a fifth without silently replacing evidence', () => {
  useProduct.setState({ watchCameras: [], toast: '' });
  for (const id of ['a', 'b', 'c', 'd', 'e']) useProduct.getState().toggleWatch(id);
  assert.deepEqual(useProduct.getState().watchCameras, ['a', 'b', 'c', 'd']);
  assert.match(useProduct.getState().toast, /cuatro/);
  useProduct.getState().toggleWatch('b'); useProduct.getState().toggleWatch('e');
  assert.deepEqual(useProduct.getState().watchCameras, ['a', 'c', 'd', 'e']);
});

test('only preferences and selected IDs persist, while runtime cases and images are excluded', () => {
  useProduct.getState().toggleFavorite('camera-1');
  const persisted = JSON.parse(saved.get('flowsense-product-preferences')).state;
  assert(persisted.favoriteCameras.includes('camera-1'));
  assert.equal(persisted.watchCameras.length, 4);
  assert(!('cameras' in persisted)); assert(!('cases' in persisted));
});

test('street queries survive encoded links and back navigation', () => {
  useProduct.getState().navigate('/explore?q=Western%20Ave');
  assert.equal(useProduct.getState().path, '/explore');
  assert.equal(useProduct.getState().query, 'Western Ave');
  useProduct.getState().setQuery('I-110 & Main');
  assert.equal(new URLSearchParams(location.search).get('q'), 'I-110 & Main');
  updateLocation('/explore?q=Long%20Beach'); events.popstate();
  assert.equal(useProduct.getState().query, 'Long Beach');
  useProduct.getState().navigate('/watch');
  assert.equal(useProduct.getState().query, '');
});
