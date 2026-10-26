import type { MobilityCase, ReviewStatus } from './types';

export function caseReviewWasSaved(
  cases: MobilityCase[],
  signalId: string,
  status: ReviewStatus,
  owner: string,
  note: string,
): boolean {
  const item = cases.find(review => review.signal_id === signalId);
  const latestAudit = item?.audit.at(-1);
  return item?.status === status
    && latestAudit?.action === status
    && latestAudit.owner === owner
    && latestAudit.note === note;
}
