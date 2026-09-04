// Personal skillbooks: base role cards from the registry plus learned
// additions that are ACTIVE only after player approval. Pending items are
// listed separately and never granted.

import { ACTORS } from './contracts.mjs';
import { SKILL_CARDS } from './skill-cards.mjs';

export function skillbookFor(bot, options = {}) {
  const actor = ACTORS[bot];
  const role = actor ? actor.role : null;
  const active = Object.entries(SKILL_CARDS)
    .filter(([, card]) => role && (card.roles.includes('all') || card.roles.includes(role)))
    .map(([name]) => name);
  const pendingReview = [];
  for (const addition of options.additions || []) {
    if (!addition || typeof addition.skill !== 'string') continue;
    if (addition.status === 'active' && !active.includes(addition.skill)) {
      active.push(addition.skill);
    } else if (addition.status !== 'active' && !pendingReview.includes(addition.skill)) {
      pendingReview.push(addition.skill);
    }
  }
  return Object.freeze({
    bot, role,
    active: Object.freeze(active),
    pendingReview: Object.freeze(pendingReview),
  });
}
