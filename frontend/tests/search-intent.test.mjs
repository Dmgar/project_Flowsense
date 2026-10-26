import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSearchOption, searchReturnUrl, searchSubmitDestination } from '../src/product/searchIntent.ts';

const modules = [
  { name: 'Overview', path: '/overview' },
  { name: 'Explore streets', path: '/explore' },
  { name: 'Cameras', path: '/cameras' },
  { name: 'Reports', path: '/reports' },
  { name: 'Settings', path: '/settings' },
  { name: 'How it works', path: '/storyboard' },
];

test('Enter opens an exact module before broad camera matches', () => {
  assert.deepEqual(searchSubmitDestination('Reports', modules, {
    cameras: [{ name: 'Report Creek', path: '/cameras/report-creek' }], signals: [],
  }), { path: '/reports' });
});

test('Enter resolves a named camera or signal before falling back to road search', () => {
  assert.deepEqual(searchSubmitDestination('  camera north  ', modules, {
    cameras: [{ name: 'Camera North', path: '/cameras/north' }], signals: [],
  }), { path: '/cameras/north' });
  assert.deepEqual(searchSubmitDestination('Wilshire issue', modules, {
    cameras: [], signals: [{ name: 'Wilshire issue', path: '/risk-signals', signal: 'SIG-007' }],
  }), { path: '/risk-signals', signal: 'SIG-007' });
  assert.deepEqual(searchSubmitDestination('Main Street', modules, { cameras: [], signals: [] }), {
    path: '/explore?q=Main%20Street',
  });
});

test('short queries do not trigger navigation', () => {
  assert.equal(searchSubmitDestination('x', modules, { cameras: [], signals: [] }), null);
});

test('arrow navigation wraps suggestions while preserving an empty selection state', () => {
  assert.equal(nextSearchOption(-1, 'next', 4), 0);
  assert.equal(nextSearchOption(-1, 'previous', 4), 3);
  assert.equal(nextSearchOption(3, 'next', 4), 0);
  assert.equal(nextSearchOption(0, 'previous', 4), 3);
  assert.equal(nextSearchOption(2, 'next', 4), 3);
  assert.equal(nextSearchOption(9, 'next', 0), -1);
});

test('search navigation keeps the query in the history entry it came from', () => {
  assert.equal(searchReturnUrl('/overview', ' Main Street '), '/overview?q=Main+Street');
  assert.equal(searchReturnUrl('/settings', 'reports', '?tab=profile', '#security'), '/settings?tab=profile&q=reports#security');
  assert.equal(searchReturnUrl('/overview', '  '), null);
});
