import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateProcedural, reviewTransition } from '../minecraft/intelligence/learning-policy.mjs';
import { skillbookFor } from '../minecraft/intelligence/role-skillbook.mjs';

const okUses = [
  { verified: true, violation: false },
  { verified: true, violation: false },
  { verified: true, violation: false },
];
const card = { name: 'ember-ash-watch', version: 1, roles: ['scout'], maxActions: 2 };

function proposal(over = {}) {
  return {
    skill: 'ember-ash-watch', bot: 'Ember', uses: okUses,
    cardDefinition: card, reviewRecord: { id: 'rev-1' },
    playerApproval: true, ...over,
  };
}

test('three clean verified uses plus review plus approval is eligible', () => {
  const r = evaluateProcedural(proposal());
  assert.equal(r.eligible, true);
  assert.deepEqual(r.reasons, []);
});

test('fewer than three verified uses is ineligible', () => {
  const r = evaluateProcedural(proposal({ uses: okUses.slice(0, 2) }));
  assert.equal(r.eligible, false);
  assert.ok(r.reasons.some((x) => /at least 3/i.test(x)));
});

test('any safety violation blocks eligibility', () => {
  const uses = [...okUses.slice(0, 2), { verified: true, violation: true }];
  const r = evaluateProcedural(proposal({ uses }));
  assert.equal(r.eligible, false);
});

test('no player approval means pending review, never active', () => {
  const r = evaluateProcedural(proposal({ playerApproval: false }));
  assert.equal(r.eligible, false);
  assert.equal(r.status, 'pending_review');
});

test('review transitions need explicit player action to activate', () => {
  assert.equal(reviewTransition('pending_review', 'approve', { playerApproval: true }), 'active');
  assert.equal(reviewTransition('pending_review', 'approve', { playerApproval: false }), 'pending_review');
  assert.equal(reviewTransition('pending_review', 'reject', {}), 'rejected');
  assert.equal(reviewTransition('active', 'expire', {}), 'expired');
});

test('skillbook gives role cards now, learned cards only after approval', () => {
  const book = skillbookFor('Flint');
  assert.ok(book.active.includes('safe-quarry-batch'));
  assert.ok(book.active.includes('safe-regroup'));
  assert.ok(!book.active.includes('small-approved-build'));
  const withLearned = skillbookFor('Ember', {
    additions: [{ skill: 'ember-ash-watch', status: 'pending_review' }],
  });
  assert.ok(!withLearned.active.includes('ember-ash-watch'));
  assert.ok(withLearned.pendingReview.includes('ember-ash-watch'));
  const approved = skillbookFor('Ember', {
    additions: [{ skill: 'ember-ash-watch', status: 'active' }],
  });
  assert.ok(approved.active.includes('ember-ash-watch'));
});
