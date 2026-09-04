// Tier 3 approvals queue (powers plan, Tasks 3/6 prerequisite). Pure,
// in-memory lifecycle for player-gated work: request → pending →
// approved/rejected/expired, with single-use consume. Approved records
// expose the exact shape `policy.mjs` matches on
// (`{ approved: true, idempotencyKey }`), so this is the deterministic
// producer for the approvals arrays policy consumes. No I/O, no dispatch.

import { ACTORS } from './contracts.mjs';
import { capabilityFor } from './capabilities.mjs';
import { skillCardFor } from './skill-cards.mjs';

const MAX_SUMMARY = 300;
const MAX_PENDING = 50;

function fail(message) {
  throw new Error(`approvals-queue: ${message}`);
}

function nonEmptyText(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SUMMARY) fail(`invalid ${field}`);
  return value.trim();
}

export function createQueue(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 30 * 60 * 1000;
  const records = new Map();
  let seq = 0;

  function request(input = {}) {
    const idempotencyKey = nonEmptyText(input.idempotencyKey, 'idempotencyKey');
    const bot = nonEmptyText(input.bot, 'bot');
    if (!ACTORS[bot]) fail('unknown bot');
    const capability = nonEmptyText(input.capability, 'capability');
    const definition = capabilityFor(capability);
    if (!definition) fail('unknown capability');
    if (input.riskTier !== 3 || definition.tier !== 3) fail('approvals queue handles tier 3 only');
    if (input.skill !== undefined && !skillCardFor(nonEmptyText(input.skill, 'skill'))) fail('unknown skill');
    for (const rec of records.values()) {
      if (rec.idempotencyKey === idempotencyKey && rec.status === 'pending') fail('duplicate pending idempotencyKey');
    }
    if ([...records.values()].filter((r) => r.status === 'pending').length >= MAX_PENDING) fail('pending queue full');
    const id = `apr-${now()}-${(seq += 1)}`;
    const rec = Object.freeze({
      id,
      status: 'pending',
      approved: false,
      idempotencyKey,
      bot,
      capability,
      skill: input.skill === undefined ? null : input.skill.trim(),
      summary: nonEmptyText(input.summary, 'summary'),
      riskTier: 3,
      requestedBy: nonEmptyText(input.requestedBy, 'requestedBy'),
      requestedAt: now(),
      expiresAt: now() + ttlMs,
      decidedBy: null,
      decidedAt: null,
      reason: null,
    });
    records.set(id, rec);
    return rec;
  }

  function decide(id, status, { by, reason = null } = {}) {
    const rec = records.get(id);
    if (!rec) fail('unknown approval id');
    if (rec.status !== 'pending') fail('already decided');
    const next = Object.freeze({
      ...rec,
      status,
      approved: status === 'approved',
      decidedBy: nonEmptyText(by, 'decidedBy'),
      decidedAt: now(),
      reason,
    });
    records.set(id, next);
    return next;
  }

  return {
    request,
    approve: (id, opts) => decide(id, 'approved', opts),
    reject: (id, opts) => decide(id, 'rejected', opts),

    get: (id) => records.get(id) || null,

    pending: () => Object.freeze(
      [...records.values()].filter((r) => r.status === 'pending'),
    ),

    matchFor: (proposal = {}) => {
      for (const rec of records.values()) {
        if (rec.status === 'approved'
          && rec.approved === true
          && rec.idempotencyKey === proposal.idempotencyKey) return rec;
      }
      return null;
    },

    consume: (id) => {
      const rec = records.get(id);
      if (!rec || rec.status !== 'approved') return false;
      records.delete(id);
      return true;
    },

    sweep: () => {
      const swept = [];
      for (const [id, rec] of records) {
        if (rec.status === 'pending' && rec.expiresAt <= now()) {
          records.set(id, Object.freeze({ ...rec, status: 'expired' }));
          swept.push(id);
        }
      }
      return Object.freeze(swept);
    },
  };
}
