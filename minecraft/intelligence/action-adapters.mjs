// Allowlisted skill-card adapters. These build bounded action DESCRIPTORS
// (plain data). They never call HTTP, RCON, shell, or queue endpoints —
// dispatch happens only if a future caller passes a descriptor through the
// gateway's authorize() decision. Raw dig/place/RCON/admin have no adapter.

import { skillCardFor } from './skill-cards.mjs';

const MAX_STACK = 64;
const MAX_RANGE = 500;

function roleAllowed(card, role) {
  return card.roles.includes('all') || card.roles.includes(role);
}

export function describeAdapter(proposal, role) {
  const card = skillCardFor(proposal.skill);
  if (!card) return null;
  if (!roleAllowed(card, role)) return null;
  const args = { ...(proposal.args || {}) };
  if (!Number.isFinite(args.count) || args.count < 1 || args.count > MAX_STACK) return null;
  if (Number.isFinite(args.x) && Number.isFinite(args.z)) {
    if (Math.hypot(args.x - 50, args.z - 85) > MAX_RANGE) return null;
  }
  return Object.freeze({
    kind: 'skill_card',
    skill: proposal.skill,
    version: card.version,
    maxActions: card.maxActions,
    boundedArgs: Object.freeze(args),
    failureExit: card.failureExit,
  });
}
