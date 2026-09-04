// Overseer transport boundary (Task 5). Validates what may leave the game
// stack (redacted request packages) and what may come back (proposal-only
// responses). Pure functions; no transport, no Hermes calls here.

import { normalizeProposal } from '../minecraft/intelligence/contracts.mjs';

const REQUEST_KEYS = new Set([
  'goal', 'goalVersion', 'manifest', 'memories', 'receipts',
  'safetySummary', 'taskBoard', 'question', 'budget',
]);

const BANNED_REQUEST_KEYS = [
  'credentials', 'secret', 'secrets', 'password', 'token',
  'serverConfig', 'server_config', 'rcon', 'rawChat', 'chatLog',
  'files', 'file', 'privateKey', 'private_key', 'env',
];

// Raw command / shell / destructive instructions must never cross the boundary.
const BANNED_TEXT = /\b(mc\s+rcon|rcon|shell|exec\s*\(|rm\s+-rf|del\s+\/[fsq]|format\s+[a-z]:|password|private\s+key|api\s*[_-]?key|mc\s+[a-z]+)/i;

const MAX_PROPOSALS = 12;

function fail(error) {
  return Object.freeze({ ok: false, error });
}

function text(value, max) {
  return typeof value === 'string' && value.length <= max;
}

function cleanText(value) {
  return typeof value === 'string' && !BANNED_TEXT.test(value);
}

export function validateOverseerRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('not_an_object');
  for (const key of Object.keys(input)) {
    if (BANNED_REQUEST_KEYS.includes(key)) return fail(`banned_field:${key}`);
    if (!REQUEST_KEYS.has(key)) return fail(`unknown_field:${key}`);
  }
  if (!text(input.goal, 500) || !cleanText(input.goal || '')) return fail('bad_goal');
  if (!Number.isInteger(input.goalVersion) || input.goalVersion < 1) return fail('bad_goal_version');
  const budget = input.budget;
  if (!budget || typeof budget !== 'object') return fail('missing_budget');
  if (!Number.isInteger(budget.maxTokens) || budget.maxTokens < 1 || budget.maxTokens > 8000) {
    return fail('bad_token_budget');
  }
  if (!Number.isInteger(budget.timeoutMs) || budget.timeoutMs < 1000 || budget.timeoutMs > 120000) {
    return fail('bad_timeout_budget');
  }
  if (input.question !== undefined && (!text(input.question, 500) || !cleanText(input.question))) {
    return fail('bad_question');
  }
  if (input.safetySummary !== undefined && !text(input.safetySummary, 500)) return fail('bad_safety_summary');
  for (const list of ['memories', 'receipts']) {
    if (input[list] !== undefined && (!Array.isArray(input[list]) || input[list].length > 20)) {
      return fail(`bad_${list}`);
    }
  }
  return Object.freeze({ ok: true });
}

export function validateOverseerResponse(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('not_an_object');
  if (input.schemaVersion !== 1) return fail('unsupported_schema');
  const allowed = new Set(['schemaVersion', 'proposals', 'research', 'skillIdeas']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) return fail(`unknown_field:${key}`);
  if (!Array.isArray(input.proposals) || input.proposals.length > MAX_PROPOSALS) return fail('bad_proposals');
  for (const proposal of input.proposals) {
    const parsed = normalizeProposal(proposal);
    if (!parsed.ok) return fail(`bad_proposal:${parsed.error}`);
  }
  for (const item of input.research || []) {
    const blob = `${item.topic || ''}\n${item.finding || ''}\n${item.uncertainty || ''}`;
    if (blob.length > 1200 || !cleanText(blob)) return fail('bad_research');
  }
  for (const idea of input.skillIdeas || []) {
    if (!text(idea.note || '', 500) || !cleanText(idea.note || '')) return fail('bad_skill_idea');
  }
  if (!Array.isArray(input.research || []) || !Array.isArray(input.skillIdeas || [])) {
    return fail('bad_lists');
  }
  return Object.freeze({ ok: true });
}
