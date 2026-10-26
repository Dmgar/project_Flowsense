import test from 'node:test';
import assert from 'node:assert/strict';
import { caseReviewWasSaved } from '../src/product/reviewOutcome.ts';

const savedCase = {
  id: 'FS-1234ABCD', signal_id: 'SIG-17', status: 'under_review', owner: 'Road safety',
  audit: [
    { action: 'new', owner: 'Traffic operations', note: 'Initial case' },
    { action: 'under_review', owner: 'Road safety', note: 'Checked the saved clip' },
  ],
};

test('an uncertain review write is confirmed only when the latest audit entry matches the submitted decision', () => {
  assert.equal(caseReviewWasSaved([savedCase], 'SIG-17', 'under_review', 'Road safety', 'Checked the saved clip'), true);
  assert.equal(caseReviewWasSaved([savedCase], 'SIG-17', 'under_review', 'Road safety', 'Different note'), false);
  assert.equal(caseReviewWasSaved([savedCase], 'SIG-17', 'confirmed', 'Road safety', 'Checked the saved clip'), false);
  assert.equal(caseReviewWasSaved([savedCase], 'SIG-18', 'under_review', 'Road safety', 'Checked the saved clip'), false);
});
