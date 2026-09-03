import assert from 'node:assert/strict';
import fs from 'node:fs';

const sourcePath = new URL('../minecraft/minion-controller/minion-controller.mjs', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`could not extract ${name}`);
}

function loadFunction(name, dependencies = '') {
  return Function(`${dependencies}\n${functionSource(name)}\nreturn ${name};`)();
}

const survivalAction = loadFunction('survivalAction');
const safeLowHealth = JSON.stringify({
  data: { health: 4.3, inventory: [], nearbyEntities: [] },
});
assert.equal(
  survivalAction(safeLowHealth),
  '',
  'a low-health bot with no food and no nearby hostile must continue into recovery/gameplay instead of fleeing forever',
);

const houseHelpers = `const HOUSE = { x: 50, y: 63, z: 85 };
const HOUSE_SAFE_RADIUS = 8;
${functionSource('houseRally')}
${functionSource('nearHouse')};`;
const fallbackAction = loadFunction('fallbackAction', houseHelpers);
const recoveryAfterFailedAction = loadFunction('recoveryAfterFailedAction', `${houseHelpers}\nconst fallbackAction = ${fallbackAction.toString()};`);
const blockedGatherStatus = JSON.stringify({
  data: {
    position: { x: 0, y: 70, z: 0 },
    inventory: [],
    scene: { visible_block_hits: [] },
    notableBlocks: [{ name: 'oak_log', position: { x: 8, y: 70, z: 0 } }],
  },
});
assert.equal(
  recoveryAfterFailedAction(
    { role: 'scout, defender, and torch keeper' },
    blockedGatherStatus,
    'mc collect oak_log 2',
    "mc exit 1: ERROR: Can't see any oak_log right now.",
    5,
  ),
  'mc goto_near 8 70 0',
  'a blocked gather must immediately navigate toward its known resource instead of repeating the same failed collect',
);

const recentHumanMessages = loadFunction('humanMessages');
const chatFixture = JSON.stringify({ data: { unreadChat: [
  { from: 'Duckets', message: 'new task', ago: '24s' },
  { from: 'Duckets', message: 'recent task', ago: '476s' },
  { from: 'Duckets', message: 'old task', ago: '701s' },
  { from: 'Ember', message: 'bot report', ago: '1s' },
] } });
assert.deepEqual(
  recentHumanMessages(chatFixture, ['Steve', 'Reed', 'Moss', 'Flint', 'Ember']),
  [{ from: 'Duckets', message: 'new task', ago: '24s' }, { from: 'Duckets', message: 'recent task', ago: '476s' }],
  'recent human requests within the 600s window should be handled after a controller restart, stale ones ignored',
);

const directRequestAction = loadFunction('directRequestAction');
assert.equal(
  directRequestAction('Steve come to xyz: 57.571 / 63.0 /82.740', 'Duckets'),
  'mc goto_near 57 63 82',
  'a human coordinate request must become navigation toward their reported position',
);
assert.equal(
  directRequestAction('ember follow me please', 'Duckets'),
  'mc follow Duckets',
  'a follow-me request must become a direct follow action',
);
assert.equal(
  directRequestAction('run from the zombies', 'Duckets'),
  'mc flee 20',
  'a retreat request must become an immediate flee action',
);
assert.equal(
  directRequestAction('ember make a sword', 'Duckets'),
  'mc craft wooden_sword',
  'a sword request must become a direct crafting action',
);
assert.equal(
  directRequestAction('Reed set your respawn to the bed', 'Duckets'),
  'mc sleep',
  'a bed/respawn request must become a direct sleep action',
);
const inventoryStatusReply = loadFunction('inventoryStatusReply');
const woodStatus = JSON.stringify({ data: { inventory: [{ name: 'oak_log', count: 3 }] } });
assert.ok(
  inventoryStatusReply({ name: 'Steve' }, woodStatus, 'does anyone have wood').includes('3 oak_log'),
  'a true supply question must whisper real inventory',
);
assert.equal(
  inventoryStatusReply({ name: 'Steve' }, woodStatus, 'come to me and build the house'),
  '',
  'an ordinary order must not trigger a resource whisper',
);

const regroupAction = loadFunction('regroupAction', houseHelpers);
const farFromVillage = JSON.stringify({ data: { position: { x: 50, y: 70, z: 50 } } });
assert.equal(
  regroupAction({ name: 'Reed' }, farFromVillage, { x: 0, y: 70, z: 0 }),
  'mc bg_goto 56 63 85',
  'a drifter returns to its yard rally spot outside the house, never into the house block',
);
assert.equal(
  regroupAction({ name: 'Steve' }, farFromVillage, { x: 0, y: 70, z: 0 }),
  'mc bg_goto 44 63 85',
  'democratic yard: even Steve returns to his rally spot outside the walls',
);

const builderWithLogs = JSON.stringify({
  data: {
    position: { x: 0, y: 70, z: 0 },
    inventory: [{ name: 'oak_log', count: 4 }],
    scene: { visible_block_hits: [] },
    notableBlocks: [],
  },
});
assert.equal(
  fallbackAction({ role: 'house builder and path maker' }, builderWithLogs, 'NONE', 1),
  'mc craft oak_planks',
  'a builder holding logs must craft planks before attempting another gather task',
);

const builderWithStrippedLogs = JSON.stringify({
  data: {
    position: { x: 0, y: 70, z: 0 },
    inventory: [{ name: 'stripped_cherry_wood', count: 4 }],
    scene: { visible_block_hits: [] },
    notableBlocks: [],
  },
});
assert.equal(
  fallbackAction({ role: 'house builder and path maker' }, builderWithStrippedLogs, 'NONE', 1),
  'mc collect oak_log 6',
  'stripped wood must make builders gather usable logs instead of retrying an impossible craft',
);

const minerVisibleStone = JSON.stringify({
  data: {
    position: { x: 0, y: 70, z: 0 }, inventory: [], notableBlocks: [],
    scene: { visible_block_hits: [{ name: 'stone', position: { x: 2, y: 70, z: 0 } }] },
  },
});
assert.equal(
  fallbackAction({ role: 'miner and resource gatherer' }, minerVisibleStone, 'NONE', 2),
  'mc collect stone 12',
  'miners must collect a sustained batch instead of stopping after two blocks',
);

const shouldRunBackgroundWork = loadFunction('shouldRunBackgroundWork');
assert.equal(
  shouldRunBackgroundWork({ pending: true, activity_pending: false }),
  true,
  'a minion waiting for inference must keep a background work loop active',
);
assert.equal(
  shouldRunBackgroundWork({ pending: false, activity_pending: false }),
  false,
  'a minion with an active decision turn must not run duplicate background work',
);
assert.equal(
  shouldRunBackgroundWork({ pending: true, activity_pending: true }),
  false,
  'background work must not overlap another command for the same minion',
);

const queuedFallbackAction = loadFunction('queuedFallbackAction', `${houseHelpers}\nconst fallbackAction = ${fallbackAction.toString()};`);
assert.equal(
  queuedFallbackAction({ role: 'house builder and path maker' }, blockedGatherStatus, 'NONE', 5, 1),
  'mc goto_near 8 70 0',
  'a bot waiting behind another model request must still receive a deterministic physical task',
);
assert.equal(
  queuedFallbackAction({ role: 'house builder and path maker' }, blockedGatherStatus, 'NONE', 5, 0),
  '',
  'the currently reasoning bot must not receive an unnecessary queued fallback task',
);

const staleTargetStatus = JSON.stringify({
  data: {
    position: { x: 0, y: 70, z: 0 },
    inventory: [],
    scene: { visible_block_hits: [{ name: 'jungle_log', position: { x: 2, y: 70, z: 0 } }] },
    notableBlocks: [{ name: 'oak_log', position: { x: 20, y: 70, z: 0 } }],
  },
});
assert.equal(
  fallbackAction({ role: 'house builder and path maker' }, staleTargetStatus, "ERROR: Can't see any oak_log right now.", 5),
  'mc goto_near 2 70 0',
  'gather recovery must prefer a currently visible role resource instead of navigating to a stale remembered target',
);

const humanMessages = loadFunction('humanMessages');
assert.deepEqual(
  humanMessages(JSON.stringify({ data: { unreadChat: [
    { from: 'Alex', message: 'please build a shelter' },
    { from: 'Steve', message: 'I am gathering logs' },
  ] } }), ['Steve', 'Reed', 'Moss', 'Flint', 'Ember']),
  [{ from: 'Alex', message: 'please build a shelter' }],
  'messages from every non-bot player must be treated as human requests, not only one username',
);

console.log('minion-controller regression tests: PASS');
