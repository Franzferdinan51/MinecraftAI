// Shadow-mode audit of live controller traffic (powers plan, Task 8).
// Pure translator: raw `mc` action args + a vitals snapshot → the verdict
// the deterministic pipeline WOULD have produced. Never gates, never
// dispatches — the controller records the verdict via
// journal.recordShadow() for review. No I/O, no side effects.

import { deriveSafetyState } from './safety-state.mjs';

// World-altering verbs grounded in the Mineflayer bot action table
// (bot/server.js ACTIONS): only these are checked against the protected
// radius. Movement, chat, eat, look, and sleep never trigger
// protected_zone — the bots live and regroup at the house.
export const MODIFYING_VERBS = Object.freeze(new Set([
  'dig', 'place', 'place_fill', 'till', 'sow', 'collect', 'harvest',
]));

function actionText(args) {
  const parts = Array.isArray(args) ? args : [args];
  return parts.map((p) => String(p ?? '')).join(' ').slice(0, 120).trim() || '(empty)';
}

function targetPoints(args) {
  const nums = (Array.isArray(args) ? args : []).slice(1).map(Number).filter(Number.isFinite);
  const pts = [];
  let i = 0;
  while (i < nums.length) {
    if (nums.length - i >= 3) { pts.push({ x: nums[i], z: nums[i + 2] }); i += 3; }
    else if (nums.length - i === 2) { pts.push({ x: nums[i], z: nums[i + 1] }); i += 2; }
    else { i += 1; }
  }
  return pts;
}

export function auditAction({ bot, actionArgs, vitals = {}, house = {} } = {}) {
  const action = actionText(actionArgs);
  const verb = Array.isArray(actionArgs) && actionArgs.length > 0 ? String(actionArgs[0]) : '';
  const safety = deriveSafetyState(vitals);

  if (safety.hold) {
    return Object.freeze({
      bot: String(bot || 'unknown').slice(0, 40),
      action,
      verdict: 'would_hold',
      reasons: safety.reasons,
      recoveryAction: safety.recoveryAction,
    });
  }

  if (MODIFYING_VERBS.has(verb)) {
    const radius = Number.isFinite(house.radius) ? house.radius : 8;
    if (Number.isFinite(house.x) && Number.isFinite(house.z)
      && targetPoints(actionArgs).some((p) => Math.hypot(p.x - house.x, p.z - house.z) <= radius)) {
      return Object.freeze({
        bot: String(bot || 'unknown').slice(0, 40),
        action,
        verdict: 'would_deny',
        reasons: Object.freeze(['protected_zone']),
        recoveryAction: null,
      });
    }
  }

  return Object.freeze({
    bot: String(bot || 'unknown').slice(0, 40),
    action,
    verdict: 'would_allow',
    reasons: Object.freeze([]),
    recoveryAction: null,
  });
}
