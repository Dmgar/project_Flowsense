import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrafficTimeline, describeTrafficMinute } from '../src/product/trafficTimeline.ts';

test('traffic timeline distinguishes observed zero crossings from unobserved video gaps', () => {
  const now = Date.parse('2026-10-21T11:29:00Z');
  const bins = buildTrafficTimeline([
    { minute: '2026-10-21T11:27:00Z', total: 2, video_samples: 0 },
    { minute: '2026-10-21T11:28:00Z', total: 0, video_samples: 3 },
  ], '2026-10-21T11:00:00Z', now);

  assert.equal(bins.length, 30);
  assert.deepEqual(bins[27], {
    minute: '2026-10-21T11:27:00.000Z', total: 2, video_samples: 0, observed: true,
  });
  assert.equal(bins[28].observed, true);
  assert.equal(bins[28].total, 0);
  assert.equal(bins[29].observed, false);
  assert.match(describeTrafficMinute(bins[29]), /no saved video analysis; crossing count unknown/);
});
