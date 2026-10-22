import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shellUrl = new URL('../src/product/Shell.tsx', import.meta.url);
const cssUrl = new URL('../src/product/product.css', import.meta.url);

test('mobile navigation keeps utility links visible and closes back to its trigger', async () => {
  const shell = await readFile(shellUrl, 'utf8');
  assert.match(shell, /className="p-navigation-secondary"/);
  assert.match(shell, /menuButton\.current\?\.focus\(\)/);
  assert.match(shell, /aria-label="Close navigation"/);
});

test('product shell provides responsive, reduced-motion, and keyboard-focus treatments', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /p-content-arrive/);
});
