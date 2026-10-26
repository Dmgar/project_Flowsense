import test from 'node:test';
import assert from 'node:assert/strict';
import { roadCountDisplay, savedTrackScopeLabel, savedTrackScopeNote } from '../src/product/roadAnalysisState.ts';

test('unconfigured road zones never present unavailable direction counts as zero', () => {
  assert.equal(roadCountDisplay(0, false), '—');
  assert.equal(roadCountDisplay(12, false), '—');
});

test('configured road zones retain measured zero and count values', () => {
  assert.equal(roadCountDisplay(0, true), 0);
  assert.equal(roadCountDisplay(12, true), 12);
});

test('track history scope identifies full-scene records when no road zone exists', () => {
  assert.match(savedTrackScopeLabel(false), /full-scene.*not assigned to a road/i);
  assert.match(savedTrackScopeNote(false), /excluded from directional road counts/i);
  assert.match(savedTrackScopeLabel(true), /current road zone/i);
});
