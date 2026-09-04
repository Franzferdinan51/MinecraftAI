// Overseer request transport (Task 5 PoC). Pure builder: live controller
// snapshot → schema-v1 overseer request. Redaction by construction — only
// allowlisted fields are ever copied (goal, manifest, safety counts,
// capped receipts); chat logs, credentials, RCON, and server config have
// no path into the output. The boundary validator remains the gate.

import { deriveSafetyState } from '../minecraft/intelligence/safety-state.mjs';

const MAX_GOAL = 500;
const MAX_RECEIPTS = 20;

export function buildOverseerRequest(snapshot = {}) {
  const minions = Array.isArray(snapshot.minions) ? snapshot.minions : [];
  const vitals = snapshot.vitals && typeof snapshot.vitals === 'object' ? snapshot.vitals : {};
  const records = Array.isArray(snapshot.records) ? snapshot.records : [];

  let clear = 0;
  let recovery = 0;
  let held = 0;
  for (const m of minions) {
    // Controller /health entries carry no online flag (Mission Control
    // /api/state does) — default to online and let vitals decide.
    const online = m.online !== false;
    const state = deriveSafetyState(vitals[m.name] || {});
    if (!online) held += 1;
    else if (state.inRecovery) recovery += 1;
    else if (state.hold) held += 1;
    else clear += 1;
  }

  return Object.freeze({
    goal: String(snapshot.goal || 'Coordinate the village team safely.').slice(0, MAX_GOAL),
    goalVersion: Number.isInteger(snapshot.goalVersion) && snapshot.goalVersion >= 1
      ? snapshot.goalVersion
      : 1,
    manifest: Object.freeze(minions.map((m) => Object.freeze({
      bot: String(m.name || '?').slice(0, 20),
      role: String(m.role || '').slice(0, 40),
      online: m.online !== false,
      paused: m.paused === true,
      ticks: Number.isFinite(m.ticks) ? m.ticks : null,
    }))),
    memories: Object.freeze([]),
    receipts: Object.freeze(records.slice(-MAX_RECEIPTS).map((r) => Object.freeze({
      source: String(r.source || '?').slice(0, 20),
      summary: String(r.summary || r.status || '').slice(0, 200),
    }))),
    safetySummary: `${clear} clear, ${recovery} recovery, ${held} held/offline across ${minions.length} minions.`.slice(0, 500),
    taskBoard: Object.freeze({
      paused: Object.freeze(minions.filter((m) => m.paused === true).map((m) => String(m.name))),
    }),
    budget: Object.freeze({ maxTokens: 2000, timeoutMs: 30000 }),
  });
}
