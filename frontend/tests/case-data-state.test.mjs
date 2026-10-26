import test from 'node:test';
import assert from 'node:assert/strict';
import { caseExportAvailability, caseRefreshNotice, caseReportStatus, cityPulseEmptyState } from '../src/product/caseDataState.ts';

test('a failed case refresh keeps prior data explicitly stale', () => {
  assert.equal(caseRefreshNotice('error', true), 'Could not refresh saved cases. Showing the last successful load; values may be out of date. Use Retry connection above.');
  assert.deepEqual(caseExportAvailability('error', true), {
    enabled: false,
    message: 'The case refresh failed. Downloads are disabled until the service responds; the table shows the last successful load.',
  });
});

test('initial case loading and failure never enable report downloads', () => {
  assert.equal(caseRefreshNotice('error', false), null);
  assert.deepEqual(caseExportAvailability('loading', false), { enabled: false, message: 'Loading saved cases. Downloads will be available after they load.' });
  assert.deepEqual(caseExportAvailability('error', false), { enabled: false, message: 'Saved cases are unavailable. Use Retry connection above before downloading.' });
});

test('case exports resume only after a successful refresh', () => {
  assert.deepEqual(caseExportAvailability('ready', true), { enabled: true, message: 'Case exports use the latest successful case load.' });
  assert.equal(caseExportAvailability('refreshing', true).enabled, false);
  assert.match(caseRefreshNotice('refreshing', true), /last successful load/);
});

test('printed reports distinguish unavailable, stale, refreshing, and current case data', () => {
  assert.match(caseReportStatus('loading', false, 0), /Initial case load in progress; case count is not yet available/);
  assert.match(caseReportStatus('error', false, 0), /Case data is unavailable; the current case count cannot be confirmed/);
  assert.equal(caseReportStatus('refreshing', true, 1), 'Showing 1 case from the last successful load; refresh in progress.');
  assert.equal(caseReportStatus('error', true, 0), 'Showing 0 cases from the last successful load; the current refresh failed.');
  assert.equal(caseReportStatus('ready', true, 2), '2 cases from the latest successful load.');
});

test('City pulse distinguishes initial load, stale refresh, errors, filtered absence and a real empty list', () => {
  assert.equal(cityPulseEmptyState('loading', false, '', 'All districts').title, 'Loading saved cases');
  assert.equal(cityPulseEmptyState('loading', false, 'incident', 'All districts').title, 'Loading saved cases');
  assert.equal(cityPulseEmptyState('refreshing', true, '', 'All districts').title, 'Refreshing saved cases');
  assert.match(cityPulseEmptyState('refreshing', true, '', 'All districts').detail, /last successful list had no matching reviews/);
  assert.equal(cityPulseEmptyState('error', false, '', 'All districts').title, 'Saved cases unavailable');
  assert.equal(cityPulseEmptyState('error', false, 'incident', 'All districts').title, 'Saved cases unavailable');
  assert.equal(cityPulseEmptyState('error', true, '', 'All districts').title, 'Could not refresh saved cases');
  assert.equal(cityPulseEmptyState('ready', true, 'incident', 'All districts').title, 'No matching saved reviews');
  assert.equal(cityPulseEmptyState('error', true, 'incident', 'All districts').title, 'No matches in the last successful load');
  assert.equal(cityPulseEmptyState('refreshing', true, 'incident', 'All districts').title, 'No matches in the last successful load');
  assert.equal(cityPulseEmptyState('ready', true, '', 'Long Beach').title, 'No saved reviews in Long Beach');
  assert.equal(cityPulseEmptyState('ready', true, '', 'All districts').title, 'No saved case reviews');
});
