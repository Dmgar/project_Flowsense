import test from 'node:test';
import assert from 'node:assert/strict';
import { apiUrl, telemetryUrl } from '../src/api/urls.ts';

test('same-origin HTTP and telemetry share the frontend proxy', () => {
  assert.equal(apiUrl('/api/v1/graph/status', ''), '/api/v1/graph/status');
  assert.equal(telemetryUrl('http://localhost:3001', ''), 'ws://localhost:3001/ws/telemetry');
});

test('explicit API targets keep HTTP, media, reports and telemetry on the same backend', () => {
  const base = 'http://localhost:8002/';
  for (const path of ['/api/v1/mobility/cameras', '/api/v1/mobility/cameras/a/image', '/api/v1/mobility/reports/cases.csv']) {
    assert.equal(apiUrl(path, base), `http://localhost:8002${path}`);
  }
  assert.equal(telemetryUrl('http://localhost:5173', base), 'ws://localhost:8002/ws/telemetry');
  assert.equal(apiUrl('https://provider.example/video.m3u8', base), 'https://provider.example/video.m3u8');
  assert.equal(apiUrl('', base), '');
});

test('HTTPS selects secure telemetry including an API path prefix', () => {
  assert.equal(telemetryUrl('https://frontend.example', ''), 'wss://frontend.example/ws/telemetry');
  assert.equal(telemetryUrl('https://frontend.example', 'https://api.example/pilot/'), 'wss://api.example/pilot/ws/telemetry');
});
