import { normalizeProposal } from './contracts.mjs';

const DEFAULT_HOUSE = Object.freeze({ x: 50, y: 63, z: 85, radius: 8 });
const MODES = new Set(['observe', 'shadow', 'canary', 'active']);

function hasApproval(proposal, approvals = []) {
  return approvals.some((record) => record
    && record.approved === true
    && record.idempotencyKey === proposal.idempotencyKey);
}

function targetsProtectedZone(args, house) {
  if (!Number.isFinite(args.x) || !Number.isFinite(args.z)) return false;
  const radius = Number.isFinite(house.radius) ? house.radius : DEFAULT_HOUSE.radius;
  return Math.hypot(args.x - house.x, args.z - house.z) <= radius;
}

export function evaluateProposal(input, options = {}) {
  const normalized = normalizeProposal(input);
  if (!normalized.ok) return Object.freeze({ accepted: false, dispatch: false, reason: 'invalid_proposal', error: normalized.error });

  const proposal = normalized.value;
  const mode = MODES.has(options.mode) ? options.mode : 'observe';
  const approvals = Array.isArray(options.approvals) ? options.approvals : [];
  const approved = hasApproval(proposal, approvals);
  const house = { ...DEFAULT_HOUSE, ...(options.house || {}) };

  if (targetsProtectedZone(proposal.args, house)) {
    return Object.freeze({ accepted: false, dispatch: false, reason: 'protected_zone', proposal });
  }
  if (proposal.args.waterEnabled === true && !approved) {
    return Object.freeze({ accepted: false, dispatch: false, reason: 'approval_required', proposal });
  }
  if (proposal.riskTier === 3) {
    return Object.freeze({ accepted: true, dispatch: false, reason: approved ? 'tier_3_proposal' : 'approval_required', proposal });
  }
  if (mode === 'observe') return Object.freeze({ accepted: true, dispatch: false, reason: 'observe_mode', proposal });
  if (mode === 'shadow') return Object.freeze({ accepted: true, dispatch: false, reason: 'shadow_mode', proposal });
  if (mode === 'canary' && options.canaryBot !== proposal.bot) {
    return Object.freeze({ accepted: true, dispatch: false, reason: 'outside_canary', proposal });
  }
  return Object.freeze({ accepted: true, dispatch: true, reason: 'authorized', proposal });
}
