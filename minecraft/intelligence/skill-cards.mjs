export const SKILL_CARDS = Object.freeze({
  'safe-regroup': {
    version: 1, roles: ['all'], maxActions: 2,
    expectedEvidence: ['arrival', 'task_complete'], cooldownMs: 30_000,
    failureExit: 'report_hazard', protectedZonePolicy: 'outside_only',
  },
  'hazard-survey': {
    version: 1, roles: ['scout'], maxActions: 3,
    expectedEvidence: ['hazard_report', 'task_complete'], cooldownMs: 60_000,
    failureExit: 'return_to_rally', protectedZonePolicy: 'no_modification',
  },
  'safe-quarry-batch': {
    version: 1, roles: ['miner'], maxActions: 4,
    expectedEvidence: ['inventory_delta', 'task_complete'], cooldownMs: 60_000,
    failureExit: 'return_to_rally', protectedZonePolicy: 'outside_only',
  },
  'farm-food-loop': {
    version: 1, roles: ['farmer'], maxActions: 4,
    expectedEvidence: ['inventory_delta', 'task_complete'], cooldownMs: 60_000,
    failureExit: 'report_hazard', protectedZonePolicy: 'approved_field_only',
  },
  'depot-delivery': {
    version: 1, roles: ['builder', 'farmer', 'miner'], maxActions: 3,
    expectedEvidence: ['inventory_delta', 'task_complete'], cooldownMs: 30_000,
    failureExit: 'return_to_rally', protectedZonePolicy: 'approved_depot_only',
  },
  'material-preflight': {
    version: 1, roles: ['foreman', 'builder'], maxActions: 2,
    expectedEvidence: ['inventory_report', 'task_complete'], cooldownMs: 30_000,
    failureExit: 'request_help', protectedZonePolicy: 'read_only',
  },
  'small-approved-build': {
    version: 1, roles: ['builder'], maxActions: 4,
    expectedEvidence: ['block_delta', 'task_complete'], cooldownMs: 60_000,
    failureExit: 'request_help', protectedZonePolicy: 'approved_blueprint_only',
  },
  'team-help-request': {
    version: 1, roles: ['all'], maxActions: 1,
    expectedEvidence: ['team_message'], cooldownMs: 30_000,
    failureExit: 'none', protectedZonePolicy: 'no_modification',
  },
});

export function skillCardFor(name) {
  return SKILL_CARDS[name] || null;
}
