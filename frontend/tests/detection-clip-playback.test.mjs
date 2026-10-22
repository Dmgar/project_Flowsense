import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, '../src/product/detectionClipPlayback.ts'), 'utf8');
const javascript = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
const transformed = javascript
  .replace('export function crossingReviewOffset', 'exports.crossingReviewOffset = function')
  .replace('export function missingDetectionClipMessage', 'exports.missingDetectionClipMessage = function')
  .replace('export function playSavedClipAt', 'exports.playSavedClipAt = function');
const load = new Function('exports', transformed);
const { crossingReviewOffset, missingDetectionClipMessage, playSavedClipAt } = (() => { const exports = {}; load(exports); return exports; })();

test('crossing review starts before the gate so playback shows the approach', () => {
  assert.equal(crossingReviewOffset(5), 3);
  assert.equal(crossingReviewOffset(1), 0);
  assert.equal(crossingReviewOffset(Number.NaN), 0);
  assert.equal(crossingReviewOffset(5, Number.NaN), 5);
});

test('missing detection video never fails silently', () => {
  assert.match(missingDetectionClipMessage(true), /still recording or has not loaded/);
  assert.match(missingDetectionClipMessage(false), /No saved video clip is linked/);
});

function fakeVideo({ readyState = 0, duration = Number.NaN, play = () => Promise.resolve() } = {}) {
  const listeners = new Map();
  return {
    readyState, duration, currentTime: 0, preload: 'none', error: null,
    addEventListener(name, callback) {
      const callbacks = listeners.get(name) || [];
      callbacks.push(callback);
      listeners.set(name, callbacks);
    },
    dispatch(name) {
      for (const callback of listeners.get(name) || []) callback();
    },
    play,
  };
}

test('starts playback in the click call before metadata arrives, then seeks to the crossing', () => {
  const order = [];
  const video = fakeVideo({ play: () => { order.push('play'); return Promise.resolve(); } });
  playSavedClipAt(video, 4.2, () => {});
  assert.deepEqual(order, ['play']);
  assert.equal(video.preload, 'auto');
  video.duration = 10;
  video.dispatch('loadedmetadata');
  assert.equal(video.currentTime, 4.2);
});

test('clamps seeks to the last playable point when metadata is already available', () => {
  const video = fakeVideo({ readyState: 1, duration: 5 });
  playSavedClipAt(video, 9, () => {});
  assert.equal(video.currentTime, 4.9);
});

test('surfaces rejected playback so the review UI can explain why the clip did not start', async () => {
  const errors = [];
  const video = fakeVideo({ play: () => Promise.reject(new Error('Playback was interrupted.')) });
  playSavedClipAt(video, 0, message => errors.push(message));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, ['Playback was interrupted.']);
});
