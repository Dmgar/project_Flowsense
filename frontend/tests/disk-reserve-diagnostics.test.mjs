import test from 'node:test';
import assert from 'node:assert/strict';
import { diskReserveDiagnostic } from '../src/product/diskReserveDiagnostics.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('low disk headroom warns before reaching the evidence safety reserve', () => {
  assert.deepEqual(diskReserveDiagnostic(2_400_000_000, 2_000_000_000), {
    level: 'near-limit',
    text: 'Only 0.40 GB above the 2.00 GB safety reserve. New recording pauses if free disk space falls below the reserve; existing clips are preserved.',
  });
});

test('disk headroom warns below 1 GB and clears at the threshold', () => {
  assert.equal(diskReserveDiagnostic(2_999_999_999, 2_000_000_000)?.level, 'near-limit');
  assert.equal(diskReserveDiagnostic(3_000_000_000, 2_000_000_000)?.level, 'available');
});

test('current 690 MB headroom warns before the MP4 safety reserve can pause recording', () => {
  assert.deepEqual(diskReserveDiagnostic(1_690_000_000, 1_000_000_000), {
    level: 'near-limit',
    text: 'Only 0.69 GB above the 1.00 GB safety reserve. New recording pauses if free disk space falls below the reserve; existing clips are preserved.',
  });
});

test('disk reserve block is distinguished from the clip quota', () => {
  assert.deepEqual(diskReserveDiagnostic(1_900_000_000, 2_000_000_000), {
    level: 'critical',
    text: 'Free at least 100.0 MB to meet the disk safety reserve. Aim for 600.0 MB so MP4 recording can resume with 0.50 GB of headroom; existing clips are preserved.',
  });
});

test('critical disk warning rounds the recovery amount up instead of displaying equal rounded totals', () => {
  assert.deepEqual(diskReserveDiagnostic(1_994_657_792, 2_000_000_000), {
    level: 'critical',
    text: 'Free at least 5.4 MB to meet the disk safety reserve. Aim for 505.4 MB so MP4 recording can resume with 0.50 GB of headroom; existing clips are preserved.',
  });
});

test('healthy disk headroom is reported without a warning', () => {
  assert.deepEqual(diskReserveDiagnostic(3_000_000_000, 2_000_000_000), {
    level: 'available',
    text: 'Free disk space: 3.00 GB · configured safety reserve: 2.00 GB.',
  });
});

test('missing disk capacity data remains unavailable', () => {
  assert.equal(diskReserveDiagnostic(undefined, 2_000_000_000), null);
});

test('critical reserve recovery guides preserve clips and explain the external-volume path', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/product/TrafficSummary.tsx', import.meta.url)), 'utf8');
  assert.match(source, /How to resume saving video/);
  assert.match(source, /VIDEO_EVIDENCE_DIR/);
  assert.match(source, /VIDEO_EVIDENCE_MAX_BYTES/);
  assert.match(source, /does not delete them automatically/);
  assert.match(source, /verify this panel reports external clip storage/);
});
