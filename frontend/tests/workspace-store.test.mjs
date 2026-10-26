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
  assert.match(useProduct.getState().toast, /four/);
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

test('explorer filters survive route changes without becoming persistent browser preferences', () => {
  useProduct.setState({ explorerRadiusKm: 1.5, explorerMapStyle: 'streets', explorerVideoFilter: 'all' });
  useProduct.getState().setExplorerRadiusKm(3);
  useProduct.getState().setExplorerMapStyle('terrain');
  useProduct.getState().setExplorerVideoFilter('checked');
  useProduct.getState().navigate('/cameras');
  assert.equal(useProduct.getState().explorerRadiusKm, 3);
  assert.equal(useProduct.getState().explorerMapStyle, 'terrain');
  assert.equal(useProduct.getState().explorerVideoFilter, 'checked');
  updateLocation('/explore?q=I-110'); events.popstate();
  assert.equal(useProduct.getState().path, '/explore');
  assert.equal(useProduct.getState().query, 'I-110');
  assert.equal(useProduct.getState().explorerRadiusKm, 3);
  const persisted = JSON.parse(saved.get('flowsense-product-preferences')).state;
  assert(!('explorerRadiusKm' in persisted));
  assert(!('explorerMapStyle' in persisted));
  assert(!('explorerVideoFilter' in persisted));
});

test('legacy period preferences recover an English label without losing saved cameras', async () => {
  const previous = useProduct.getState().period;
  const legacyPeriods = ['\u00daltimos 15 min', '\u00daltima hora', '\u00daltimas 24 h', '\u00daltimos 7 d\u00edas'];
  const expected = ['Last 15 min', 'Last hour', 'Last 24 h', 'Last 7 days'];
  for (const [index, period] of legacyPeriods.entries()) {
    saved.set('flowsense-product-preferences', JSON.stringify({ state: { period, favoriteCameras: ['camera-legacy'], watchCameras: ['camera-desk'], mode: 'observed' }, version: 0 }));
    await useProduct.persist.rehydrate();
    assert.equal(useProduct.getState().period, expected[index]);
    assert.deepEqual(useProduct.getState().favoriteCameras, ['camera-legacy']);
    assert.deepEqual(useProduct.getState().watchCameras, ['camera-desk']);
    assert.equal(useProduct.getState().mode, 'observed');
  }
  useProduct.getState().setPeriod(previous);
});

test('theme persists across hydration and older preferences retain new layer defaults', async () => {
  useProduct.getState().setTheme('dark');
  const preference = JSON.parse(saved.get('flowsense-product-preferences'));
  assert.equal(preference.state.theme, 'dark');
  useProduct.setState({ theme: 'light' });
  saved.set('flowsense-product-preferences', JSON.stringify(preference));
  await useProduct.persist.rehydrate();
  assert.equal(useProduct.getState().theme, 'dark');
  saved.set('flowsense-product-preferences', JSON.stringify({ state: { theme: 'invalid', layers: { cameras: false } }, version: 0 }));
  await useProduct.persist.rehydrate();
  assert.equal(useProduct.getState().theme, 'dark');
  assert.equal(useProduct.getState().layers.cameras, false);
  assert.equal(useProduct.getState().layers.clusterCameras, true);
});


test('tour opening and local journey milestones preserve evidence mode, search and saved context', () => {
  useProduct.setState({ path: '/overview', demoIndex: -1, mode: 'observed', query: 'I-110', district: 'Long Beach', favoriteCameras: ['a'], watchCameras: ['b'], journeyEvents: [] });
  useProduct.getState().startTour();
  const state = useProduct.getState();
  assert.equal(state.demoIndex, 0);
  assert.equal(state.mode, 'observed');
  assert.equal(state.query, 'I-110');
  assert.equal(state.district, 'Long Beach');
  assert.deepEqual(state.favoriteCameras, ['a']);
  assert.deepEqual(state.watchCameras, ['b']);
  state.recordJourney('entry'); state.recordJourney('entry');
  assert.deepEqual(useProduct.getState().journeyEvents, ['entry']);
  state.setDemoIndex(-1); state.startTour();
  assert.equal(useProduct.getState().demoIndex, 0);
  const persisted = JSON.parse(saved.get('flowsense-product-preferences')).state;
  assert(!('journeyEvents' in persisted));
  assert(!('demoIndex' in persisted));
});
