import { capabilityFor } from './capabilities.mjs';
import { skillCardFor } from './skill-cards.mjs';

export const ACTORS = Object.freeze({
  HermesBot: { agentKind: 'hermescraft-agent', role: 'overseer' },
  Steve: { agentKind: 'hermescraft-agent', role: 'foreman' },
  Reed: { agentKind: 'hermescraft-agent', role: 'builder' },
  Moss: { agentKind: 'hermescraft-agent', role: 'farmer' },
  Flint: { agentKind: 'hermescraft-agent', role: 'miner' },
  Ember: { agentKind: 'hermescraft-agent', role: 'scout' },
});

const REQUIRED = ['id', 'bot', 'capability', 'args', 'reason', 'expectedEvidence', 'riskTier', 'idempotencyKey'];
const ALLOWED = new Set([...REQUIRED, 'skill', 'requiresApproval']);
const MAX_TEXT = 300;

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractError';
  }
}

function reject(message) {
  throw new ContractError(message);
}

function nonEmptyText(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT) reject(`invalid ${field}`);
  return value.trim();
}

function roleAllows(role, allowedRoles) {
  return allowedRoles.includes('all') || allowedRoles.includes(role);
}

function validateArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) reject('args must be an object');
  for (const [key, value] of Object.entries(args)) {
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(key)) reject('invalid args key');
    if (typeof value === 'string' && value.length > MAX_TEXT) reject('argument too long');
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 30_000_000)) reject('argument out of range');
  }
  if (Number.isInteger(args.count) && (args.count < 1 || args.count > 64)) reject('count out of range');
  if (typeof args.area === 'string' && !/^[a-z][a-z0-9-]{0,63}$/.test(args.area)) reject('invalid area');
  return Object.freeze({ ...args });
}

export function validateProposal(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) reject('proposal must be an object');
  for (const key of Object.keys(input)) if (!ALLOWED.has(key)) reject(`unknown proposal field: ${key}`);
  for (const field of REQUIRED) if (!(field in input)) reject(`missing ${field}`);

  const bot = nonEmptyText(input.bot, 'bot');
  const actor = ACTORS[bot];
  if (!actor) reject('unknown bot');
  const capability = nonEmptyText(input.capability, 'capability');
  const definition = capabilityFor(capability);
  if (!definition) reject('unknown capability');
  if (!roleAllows(actor.role, definition.roles)) reject('role is not permitted for capability');
  if (!Number.isInteger(input.riskTier) || input.riskTier !== definition.tier) reject('risk tier does not match capability');

  const value = {
    id: nonEmptyText(input.id, 'id'),
    bot,
    capability,
    args: validateArgs(input.args),
    reason: nonEmptyText(input.reason, 'reason'),
    expectedEvidence: input.expectedEvidence,
    riskTier: input.riskTier,
    idempotencyKey: nonEmptyText(input.idempotencyKey, 'idempotencyKey'),
    requiresApproval: input.requiresApproval === true,
  };
  if (!Array.isArray(value.expectedEvidence) || value.expectedEvidence.length < 1 || value.expectedEvidence.length > 8) reject('invalid expectedEvidence');
  value.expectedEvidence = Object.freeze(value.expectedEvidence.map((item) => nonEmptyText(item, 'evidence')));

  if (input.skill !== undefined) {
    const skill = nonEmptyText(input.skill, 'skill');
    const card = skillCardFor(skill);
    if (!card) reject('unknown skill');
    if (!roleAllows(actor.role, card.roles)) reject('role is not permitted for skill');
    if (capability !== 'skill.run') reject('skills require skill.run capability');
    value.skill = skill;
  }
  if (capability === 'skill.run' && !value.skill) reject('skill.run requires skill');
  if (definition.tier === 3 && value.requiresApproval !== true) reject('tier 3 proposal requires approval');
  if (definition.tier < 3 && value.requiresApproval) reject('approval is only valid for tier 3 proposals');
  return Object.freeze(value);
}

export function normalizeProposal(input) {
  try {
    return { ok: true, value: validateProposal(input) };
  } catch (error) {
    return { ok: false, error: error instanceof ContractError ? error.message : 'invalid proposal' };
  }
}
