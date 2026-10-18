import test from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../src/store/useStore.ts';

test('selecting a backup keeps the corridor assessment, while a new route clears stale context', () => {
  const primary = { route_id: 'primary' };
  const backup = { route_id: 'backup' };
  const assessment = { score_pct: 75, explanation: 'Moderate detour and limited overlap.' };
  const state = useStore.getState();
  state.setActiveRoute(primary);
  state.setRouteOptions([primary, backup]);
  state.setRouteResilience(assessment);
  state.setActiveRoute(backup);
  assert.equal(useStore.getState().routeResilience, assessment);
  assert.equal(useStore.getState().activeRoute, backup);
  state.setActiveRoute({ route_id: 'recalculated' });
  assert.equal(useStore.getState().routeResilience, null);
  state.setRouteResilience(assessment);
  state.setRouteOptions([]);
  assert.equal(useStore.getState().routeResilience, null);
});
