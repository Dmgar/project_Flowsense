export type CaseLoadStatus = 'loading' | 'refreshing' | 'ready' | 'error';

export function cityPulseEmptyState(status: CaseLoadStatus, loaded: boolean, query: string, district: string): { title: string; detail: string } {
  if (status === 'loading' || !loaded && status === 'refreshing') return { title: 'Loading saved cases', detail: 'Checking for saved camera reviews. A camera image alone does not confirm an incident.' };
  if (status === 'error' && !loaded) return { title: 'Saved cases unavailable', detail: 'The case service could not return this list. Use Retry connection above; an unavailable response does not mean there are no saved cases.' };
  if (query.trim()) {
    if (status === 'refreshing' || status === 'error') return {
      title: 'No matches in the last successful load',
      detail: status === 'refreshing'
        ? 'The case list is refreshing. Clear the search or choose another area; new matches will appear when the update completes.'
        : 'The case refresh failed. Clear the search or choose another area to browse loaded reviews, or retry the connection to check for new matches.',
    };
    return { title: 'No matching saved reviews', detail: 'Clear the search or choose another area to see saved camera reviews.' };
  }
  if (status === 'refreshing') return { title: 'Refreshing saved cases', detail: 'The last successful list had no matching reviews. Waiting for the current list to finish loading.' };
  if (status === 'error') return { title: 'Could not refresh saved cases', detail: 'The last successful list had no matching reviews. Retry the connection to check for updates.' };
  return district === 'All districts'
    ? { title: 'No saved case reviews', detail: 'No camera reviews have been saved yet. Find a camera to inspect evidence before opening a case.' }
    : { title: `No saved reviews in ${district}`, detail: 'No saved camera reviews are available for this area. Choose another area or find a camera to inspect evidence.' };
}

export function caseRefreshNotice(status: CaseLoadStatus, loaded: boolean): string | null {
  if (!loaded || status === 'ready' || status === 'loading') return null;
  return status === 'refreshing'
    ? 'Refreshing saved cases. Showing the last successful load.'
    : 'Could not refresh saved cases. Showing the last successful load; values may be out of date. Use Retry connection above.';
}

export function caseExportAvailability(status: CaseLoadStatus, loaded: boolean): { enabled: boolean; message: string } {
  if (loaded && status === 'ready') return { enabled: true, message: 'Case exports use the latest successful case load.' };
  if (loaded && status === 'refreshing') return { enabled: false, message: 'Saved cases are refreshing. Downloads will be available when the refresh finishes.' };
  if (loaded && status === 'error') return { enabled: false, message: 'The case refresh failed. Downloads are disabled until the service responds; the table shows the last successful load.' };
  if (status === 'error') return { enabled: false, message: 'Saved cases are unavailable. Use Retry connection above before downloading.' };
  return { enabled: false, message: 'Loading saved cases. Downloads will be available after they load.' };
}

export function caseReportStatus(status: CaseLoadStatus, loaded: boolean, count: number): string {
  if (!loaded) return status === 'loading'
    ? 'Initial case load in progress; case count is not yet available.'
    : 'Case data is unavailable; the current case count cannot be confirmed.';
  if (status === 'refreshing') return `Showing ${count} case${count === 1 ? '' : 's'} from the last successful load; refresh in progress.`;
  if (status === 'error') return `Showing ${count} case${count === 1 ? '' : 's'} from the last successful load; the current refresh failed.`;
  return `${count} case${count === 1 ? '' : 's'} from the latest successful load.`;
}
