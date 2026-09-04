// Deterministic authority gateway (Task 3). Pure pipeline:
// schema → role/capability → bot safety state → policy → lease →
// budget/idempotency → adapter descriptor. No I/O, no dispatch.

import { ACTORS, normalizeProposal } from './contracts.mjs';
import { capabilityFor } from './capabilities.mjs';
import { skillCardFor } from './skill-cards.mjs';
import { evaluateProposal } from './policy.mjs';
import { describeAdapter } from './action-adapters.mjs';

const LEASE_FOR_SKILL = Object.freeze({
  'depot-delivery': { kind: 'depot', arg: 'depot' },
  'farm-food-loop': { kind: 'field', arg: 'field' },
  'small-approved-build': { kind: 'blueprint', arg: 'blueprint' },
});

function deny(reason, extra = {}) {
  return Object.freeze({ allowed: false, reason, ...extra });
}

function roleOf(bot) {
  return ACTORS[bot] ? ACTORS[bot].role : null;
}

function capabilityAllowed(name, role) {
  const cap = capabilityFor(name);
  if (!cap) return false;
  return cap.roles.includes('all') || cap.roles.includes(role);
}

function leaseCheck(proposal, leases) {
  const need = LEASE_FOR_SKILL[proposal.skill];
  if (!need) return null;
  const lease = (leases || {})[need.kind];
  const want = proposal.args ? proposal.args[need.arg] : undefined;
  if (!lease || lease[need.arg] !== want) return 'lease_required';
  if (!Number.isFinite(lease.expires) || lease.expires <= Date.now()) return 'lease_expired';
  return null;
}

export function authorize(input, ctx = {}) {
  const normalized = normalizeProposal(input);
  if (!normalized.ok) return deny('invalid_proposal', { error: normalized.error });
  const proposal = normalized.value;

  const role = roleOf(proposal.bot);
  if (!role) return deny('unknown_actor');
  if (!capabilityAllowed(proposal.capability, role)) return deny('forbidden_capability');

  if (proposal.skill) {
    const card = skillCardFor(proposal.skill);
    if (!card) return deny('unknown_skill');
    const okRole = card.roles.includes('all') || card.roles.includes(role);
    if (!okRole) return deny('forbidden_skill');
  }

  const state = (ctx.botState || {})[proposal.bot] || {};
  if (state.inRecovery) return deny('bot_in_recovery');
  if (state.busy) return deny('bot_busy');

  const decision = evaluateProposal(proposal, {
    mode: ctx.mode, house: ctx.house, approvals: ctx.approvals, canaryBot: ctx.canaryBot,
  });
  if (!decision.accepted) return deny(decision.reason, { proposal });
  if (!decision.dispatch) return deny(decision.reason, { proposal });

  const leaseProblem = leaseCheck(proposal, ctx.leases);
  if (leaseProblem) return deny(leaseProblem, { proposal });

  const count = proposal.args ? proposal.args.count : undefined;
  if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 64)) {
    return deny('over_count_limit', { proposal });
  }
  const { x, z } = proposal.args || {};
  if (Number.isFinite(x) && Number.isFinite(z)) {
    const house = { x: 50, z: 85, ...(ctx.house || {}) };
    if (Math.hypot(x - house.x, z - house.z) > 500) return deny('over_range_limit', { proposal });
  }

  const adapter = proposal.skill ? describeAdapter(proposal, role) : null;
  if (proposal.skill && !adapter) return deny('adapter_rejected', { proposal });

  const usedKeys = ctx.usedKeys instanceof Map ? ctx.usedKeys : new Map();
  if (usedKeys.has(proposal.idempotencyKey)) {
    return Object.freeze({
      allowed: false, duplicate: true, reason: 'duplicate_key',
      receipt: usedKeys.get(proposal.idempotencyKey),
    });
  }
  const receipt = Object.freeze({
    idempotencyKey: proposal.idempotencyKey,
    bot: proposal.bot, capability: proposal.capability,
    skill: proposal.skill || null, role,
    at: new Date().toISOString(),
  });
  usedKeys.set(proposal.idempotencyKey, receipt);
  return Object.freeze({ allowed: true, reason: 'authorized', proposal, adapter, receipt });
}

export function verifyReceipt(proposal, observed) {
  const expected = (proposal && proposal.expectedEvidence) || [];
  const seen = new Set((observed && observed.evidence) || []);
  const missing = expected.filter((e) => !seen.has(e));
  if (missing.length === 0) return Object.freeze({ verdict: 'verified', missing: [] });
  return Object.freeze({ verdict: 'needs_review', missing });
}
