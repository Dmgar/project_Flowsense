import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationCorridorProgress, calibrationPlaybackCoverage, calibrationProgress, calibrationQueue, canSaveRoadZone, corridorCalibrationCoverage, directionDifferenceDegrees, hasPreviouslyVerifiedVideo, isCurrentlyPlaying, nextCalibrationCamera, retainRecentRoadRegionSuggestion, suggestObservedDirection, suggestObservedRoadRegion } from '../src/product/cameraCalibration.ts';

const camera = (id, name, hls_status, stream_url = 'https://example.test/live.m3u8') => ({
  id, name, hls_status, stream_url, district: 'Los Angeles', lat: 34, lng: -118,
  image_url: '', source_url: '', provider: 'Caltrans', status: 'unverified', refresh_seconds: 0,
  last_observed_at: null,
});

test('calibration queue prefers video-verified cameras, then route-ready cameras', () => {
  const cameras = [
    camera('zone-ready', 'Already calibrated', 200),
    camera('unknown-feed', 'Unknown feed with route', 0),
    camera('verified-feed', 'Verified feed', 200),
  ];
  const statuses = [
    { camera_id: 'zone-ready', ready_for_road_analysis: true, route_metadata_available: true },
    { camera_id: 'unknown-feed', ready_for_road_analysis: false, route_metadata_available: true },
    { camera_id: 'verified-feed', ready_for_road_analysis: false, route_metadata_available: false },
  ];

  assert.equal(nextCalibrationCamera(cameras, statuses)?.id, 'verified-feed');
});

test('calibration queue skips the saved camera and cameras without video', () => {
  const cameras = [camera('current', 'Current', 200), camera('no-video', 'No video', 200, '')];
  const statuses = [
    { camera_id: 'current', ready_for_road_analysis: false, route_metadata_available: true },
    { camera_id: 'no-video', ready_for_road_analysis: false, route_metadata_available: true },
  ];

  assert.equal(nextCalibrationCamera(cameras, statuses, 'current'), undefined);
});

test('calibration worklist returns every pending video camera in priority order', () => {
  const cameras = [
    camera('ready', 'Already ready', 200),
    camera('unverified-route', 'Unverified route', 0),
    camera('verified-no-route', 'Verified no route', 200),
    camera('verified-route', 'Verified route', 200),
    camera('image-only', 'Image only', 200, ''),
  ];
  const statuses = [
    { camera_id: 'ready', ready_for_road_analysis: true, route_metadata_available: true },
    { camera_id: 'unverified-route', ready_for_road_analysis: false, route_metadata_available: true },
    { camera_id: 'verified-no-route', ready_for_road_analysis: false, route_metadata_available: false },
    { camera_id: 'verified-route', ready_for_road_analysis: false, route_metadata_available: true },
  ];

  assert.deepEqual(calibrationQueue(cameras, statuses).map(item => item.id), [
    'verified-route', 'verified-no-route', 'unverified-route',
  ]);
  assert.deepEqual(calibrationQueue(cameras, statuses, 'verified-route').map(item => item.id), [
    'verified-no-route', 'unverified-route',
  ]);
});

test('currently decoding video ranks ahead of historical HLS reachability', () => {
  const cameras = [camera('old-url', 'Old HLS response', 200), camera('live', 'Live decoder', 0)];
  const statuses = [
    { camera_id: 'old-url', ready_for_road_analysis: false, route_metadata_available: true },
    { camera_id: 'live', ready_for_road_analysis: false, route_metadata_available: true,
      playback_verified: true, playback_session_state: 'Live' },
  ];

  assert.equal(isCurrentlyPlaying(statuses[1]), true);
  assert.equal(isCurrentlyPlaying({ ...statuses[1], playback_verified: false }), false);
  assert.deepEqual(calibrationQueue(cameras, statuses).map(item => item.id), ['live', 'old-url']);
});

test('continuation calibrates adjacent cameras on the same directed corridor first', () => {
  const cameras = [
    { ...camera('current', 'Current', 200), route: 'I-110', direction: 'South', lat: 34.05, lng: -118.26 },
    { ...camera('adjacent-near', 'Adjacent near', 0), route: 'i-110', direction: 'south', lat: 34.051, lng: -118.26 },
    { ...camera('adjacent-far', 'Adjacent far', 200), route: 'I-110', direction: 'South', lat: 34.08, lng: -118.26 },
    { ...camera('other-corridor', 'Other corridor', 200), route: 'I-5', direction: 'South', lat: 34.0501, lng: -118.26 },
  ];
  const statuses = cameras.map(item => ({ camera_id: item.id, ready_for_road_analysis: false, route_metadata_available: true }));

  assert.deepEqual(calibrationQueue(cameras, statuses, 'current').map(item => item.id), [
    'adjacent-far', 'adjacent-near', 'other-corridor',
  ]);
});

test('road calibration progress counts only video sources and keeps missing status unready', () => {
  const cameras = [camera('ready', 'Ready', 200), camera('pending', 'Pending', 200), camera('image', 'Image only', 200, '')];
  const progress = calibrationProgress(cameras, [
    { camera_id: 'ready', ready_for_road_analysis: true, route_metadata_available: true },
  ]);
  assert.deepEqual(progress, { total: 2, ready: 1, pending: 1 });
});

test('road calibration coverage separates opposite directions and keeps missing zones pending', () => {
  const cameras = [
    { ...camera('south-ready', 'South ready', 200), route: 'I-110', direction: 'South' },
    { ...camera('south-pending', 'South pending', 0), route: 'i-110', direction: 'south' },
    { ...camera('north-pending', 'North pending', 200), route: 'I-110', direction: 'North' },
    { ...camera('unknown-route', 'Unknown route', 200), route: undefined, direction: undefined },
    camera('image-only', 'Image only', 200, ''),
  ];
  const statuses = [
    { camera_id: 'south-ready', ready_for_road_analysis: true, route_metadata_available: true },
    { camera_id: 'north-pending', ready_for_road_analysis: false, route_metadata_available: true },
  ];

  const groups = calibrationCorridorProgress(cameras, statuses);
  const byRoute = new Map(groups.map(item => [`${item.route}|${item.direction}`, item]));

  assert.equal(groups.length, 3);
  assert.deepEqual(byRoute.get('I-110|South') && {
    total: byRoute.get('I-110|South').total, ready: byRoute.get('I-110|South').ready,
    pending: byRoute.get('I-110|South').pending, next: byRoute.get('I-110|South').next_camera.id,
  }, { total: 2, ready: 1, pending: 1, next: 'south-pending' });
  assert.deepEqual(byRoute.get('I-110|North') && {
    total: byRoute.get('I-110|North').total, ready: byRoute.get('I-110|North').ready,
    pending: byRoute.get('I-110|North').pending, next: byRoute.get('I-110|North').next_camera.id,
  }, { total: 1, ready: 0, pending: 1, next: 'north-pending' });
  assert.equal(byRoute.get('Route reference needed|Direction review').pending, 1);
});

test('per-camera road coverage counts only matching route and direction sources', () => {
  const result = corridorCalibrationCoverage({ route: 'I-110', direction: 'South' }, [
    { camera_id: 'south-ready', route: 'i-110', direction: 'south', ready_for_road_analysis: true, route_metadata_available: true },
    { camera_id: 'south-pending', route: 'I-110', direction: 'South', ready_for_road_analysis: false, route_metadata_available: true },
    { camera_id: 'north-ready', route: 'I-110', direction: 'North', ready_for_road_analysis: true, route_metadata_available: true },
    { camera_id: 'other-route', route: 'I-5', direction: 'South', ready_for_road_analysis: true, route_metadata_available: true },
  ]);
  assert.deepEqual(result, { route: 'I-110', direction: 'South', total: 2, ready: 1 });
  assert.equal(corridorCalibrationCoverage({ route: 'I-110' }, []), null);
});

test('previous verification accepts numeric and string HTTP status values', () => {
  assert.equal(hasPreviouslyVerifiedVideo(camera('numeric', 'Numeric status', 200)), true);
  assert.equal(hasPreviouslyVerifiedVideo(camera('string', 'String status', '200')), true);
  assert.equal(hasPreviouslyVerifiedVideo(camera('missing', 'Unknown status', 'notice')), false);
});

test('calibration coverage separates previously reachable URLs from feeds needing playback verification', () => {
  assert.deepEqual(calibrationPlaybackCoverage([
    camera('reachable', 'Previously reachable', '200'),
    camera('unknown', 'Playback unknown', 'unavailable'),
    camera('missing', 'No check', 0),
  ]), { pending: 3, previouslyVerified: 1, playbackCheckRequired: 2 });
});

test('new road zones require a manual polygon, direction and explicit enablement', () => {
  assert.equal(canSaveRoadZone(false, 4, 0, 2), false);
  assert.equal(canSaveRoadZone(true, 2, 0, 2), false);
  assert.equal(canSaveRoadZone(true, 4, 0, 0), false);
  assert.equal(canSaveRoadZone(true, 4, 0, 2), true);
});

test('editing a calibrated zone preserves its direction unless the polygon is cleared', () => {
  assert.equal(canSaveRoadZone(true, 4, 2, 0), true);
  assert.equal(canSaveRoadZone(true, 0, 2, 0), false);
});

test('direction comparison exposes alignment and opposite-flow conflicts', () => {
  assert.equal(directionDifferenceDegrees([0, 2], [0, 4]), 0);
  assert.equal(directionDifferenceDegrees([1, 0], [0, 1]), 90);
  assert.equal(directionDifferenceDegrees([1, 0], [-2, 0]), 180);
  assert.equal(directionDifferenceDegrees([0, 0], [1, 0]), null);
});

test('observed movement suggests a direction only when at least three tracks agree inside the drawn lane', () => {
  const polygon = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const tracks = [20, 40, 60].map(y => ({ class: 'vehicle', trail: [[10, y], [20, y], [30, y]] }));
  const suggestion = suggestObservedDirection(polygon, tracks, 100, 100);

  assert.ok(suggestion);
  assert.deepEqual(suggestion.direction, [1, 0]);
  assert.equal(suggestion.agreeingTracks, 3);
  assert.equal(suggestion.sampledTracks, 3);
  assert.ok(suggestion.end[0] > suggestion.start[0]);
});

test('observed movement abstains when directions conflict or evidence is insufficient', () => {
  const polygon = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const rightward = y => ({ class: 'car', trail: [[10, y], [20, y], [30, y]] });
  const leftward = y => ({ class: 'truck', trail: [[90, y], [80, y], [70, y]] });

  assert.equal(suggestObservedDirection(polygon, [rightward(20), rightward(40)], 100, 100), null);
  assert.equal(suggestObservedDirection(polygon,
    [rightward(20), rightward(40), rightward(60), leftward(80), leftward(90)], 100, 100), null);
  assert.equal(suggestObservedDirection([[0, 0], [.05, 0], [.05, 1], [0, 1]],
    [rightward(20), rightward(40), rightward(60)], 100, 100), null);
});

test('observed movement ignores stationary objects and pedestrians', () => {
  const polygon = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const stationary = y => ({ class: 'vehicle', trail: [[40, y], [40, y], [40, y]] });
  const pedestrian = y => ({ class: 'pedestrian', trail: [[10, y], [20, y], [30, y]] });

  assert.equal(suggestObservedDirection(polygon,
    [stationary(20), stationary(40), pedestrian(60)], 100, 100), null);
});

test('road-area assistance outlines a dominant moving-car corridor for operator review', () => {
  const tracks = [20, 35, 50, 65].map(y => ({
    class: 'car', bbox: [20, y - 8, 16, 8],
    trail: [[20, y], [35, y], [50, y], [65, y]],
  }));
  tracks.push(
    { class: 'truck', bbox: [80, 15, 24, 12], trail: [[90, 15], [80, 15], [70, 15], [60, 15]] },
  );

  const suggestion = suggestObservedRoadRegion(tracks, 100, 100);
  assert.ok(suggestion);
  assert.equal(suggestion.agreeingTracks, 4);
  assert.equal(suggestion.sampledTracks, 5);
  assert.equal(suggestion.polygon.length, 4);
  for (const [x, y] of suggestion.polygon) {
    assert.ok(x >= 0 && x <= 1);
    assert.ok(y >= 0 && y <= 1);
  }
  assert.ok(suggestion.polygon.some(([, y]) => y > .5));
});

test('road-area assistance abstains on balanced opposing flows and sparse motion', () => {
  const moving = (id, reverse = false) => ({
    class: 'car', bbox: [20, 30 + id * 5, 16, 8],
    trail: reverse ? [[80, 30 + id * 5], [65, 30 + id * 5], [50, 30 + id * 5]]
      : [[20, 30 + id * 5], [35, 30 + id * 5], [50, 30 + id * 5]],
  });
  assert.equal(suggestObservedRoadRegion([moving(0), moving(1)], 100, 100), null);
  assert.equal(suggestObservedRoadRegion([moving(0), moving(1, true), moving(2), moving(3, true)], 100, 100), null);
});

test('road-area assistance retains a valid suggestion briefly across rolling-window dropouts', () => {
  const suggestion = { polygon: [[.1, .2], [.8, .2], [.8, .6], [.1, .6]], agreeingTracks: 3, sampledTracks: 4 };
  const retained = retainRecentRoadRegionSuggestion(suggestion, null, 1_000);
  assert.deepEqual(retainRecentRoadRegionSuggestion(null, retained, 8_999), retained);
  assert.equal(retainRecentRoadRegionSuggestion(null, retained, 9_001), null);
  assert.equal(retainRecentRoadRegionSuggestion(null, retained, 999), null);
});
