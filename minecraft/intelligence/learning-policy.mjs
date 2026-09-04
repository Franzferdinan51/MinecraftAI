// Learning policy: repeated verified outcomes become *candidates* only.
// Activation always requires a Mission Control review record plus explicit
// player approval (Tier 3). No model can self-promote a lesson.

const MIN_VERIFIED_USES = 3;

export function evaluateProcedural(input = {}) {
  const reasons = [];
  const uses = Array.isArray(input.uses) ? input.uses : [];
  const verified = uses.filter((u) => u && u.verified === true).length;
  if (verified < MIN_VERIFIED_USES) reasons.push(`needs at least ${MIN_VERIFIED_USES} verified uses`);
  if (uses.some((u) => u && u.violation === true)) reasons.push('safety violation on record');
  if (!input.cardDefinition || typeof input.cardDefinition !== 'object') {
    reasons.push('missing reproducible card definition');
  }
  if (!input.reviewRecord) reasons.push('missing Mission Control review record');
  if (reasons.length > 0) {
    return Object.freeze({ eligible: false, status: 'pending_review', reasons: Object.freeze(reasons) });
  }
  if (input.playerApproval !== true) {
    return Object.freeze({ eligible: false, status: 'pending_review', reasons: Object.freeze([]) });
  }
  return Object.freeze({ eligible: true, status: 'approved', reasons: Object.freeze([]) });
}

export function reviewTransition(status, action, evidence = {}) {
  if (status === 'pending_review' && action === 'approve') {
    return evidence.playerApproval === true ? 'active' : 'pending_review';
  }
  if (status === 'pending_review' && action === 'reject') return 'rejected';
  if (status === 'active' && action === 'expire') return 'expired';
  if (status === 'rejected' && action === 'reopen') return 'pending_review';
  return status;
}
