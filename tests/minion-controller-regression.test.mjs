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
const furnaceAction = loadFunction('furnaceAction');
const furnaceDep = `\nconst furnaceAction = ${furnaceAction.toString()};`;
const fallbackAction = loadFunction('fallbackAction', `${houseHelpers}${furnaceDep}`);
const recoveryAfterFailedAction = loadFunction('recoveryAfterFailedAction', `${houseHelpers}${furnaceDep}\nconst fallbackAction = ${fallbackAction.toString()};`);
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

const queuedFallbackAction = loadFunction('queuedFallbackAction', `${houseHelpers}${furnaceDep}\nconst fallbackAction = ${fallbackAction.toString()};`);
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

// Furnace workflow (cherry-picked from minecraft-mcp-server smelt-item design).
const hungryCookStatus = JSON.stringify({
  data: {
    position: { x: 44, y: 63, z: 85 },
    food: 8,
    inventory: [{ name: 'raw_porkchop', count: 3 }, { name: 'coal', count: 2 }],
    scene: { visible_block_hits: [{ name: 'furnace', position: { x: 45, y: 63, z: 85 } }] },
    notableBlocks: [],
  },
});
assert.equal(
  furnaceAction({ role: 'farmer and food keeper' }, hungryCookStatus),
  'mc smelt raw_porkchop',
  'a hungry bot with raw food near a furnace must cook instead of wandering',
);
const oreSmeltStatus = JSON.stringify({
  data: {
    position: { x: 44, y: 63, z: 85 },
    food: 18,
    inventory: [{ name: 'bread', count: 2 }, { name: 'raw_iron', count: 4 }, { name: 'oak_planks', count: 5 }],
    scene: { visible_block_hits: [] },
    notableBlocks: [{ name: 'lit_furnace', position: { x: 45, y: 63, z: 85 } }],
  },
});
assert.equal(
  furnaceAction({ role: 'miner and resource gatherer' }, oreSmeltStatus),
  'mc smelt raw_iron',
  'a fed miner with raw ore near a lit furnace must smelt it',
);
assert.equal(
  furnaceAction({ role: 'miner and resource gatherer' }, blockedGatherStatus),
  '',
  'no furnace and no cobblestone means no furnace task',
);
const furnacePrepStatus = JSON.stringify({
  data: {
    position: { x: 0, y: 70, z: 0 },
    food: 20,
    inventory: [{ name: 'cobblestone', count: 9 }],
    scene: { visible_block_hits: [{ name: 'crafting_table', position: { x: 1, y: 70, z: 0 } }] },
    notableBlocks: [],
  },
});
assert.equal(
  furnaceAction({ role: 'miner and resource gatherer' }, furnacePrepStatus),
  'mc craft furnace',
  'a miner with 8+ cobblestone at a crafting table must prepare a furnace',
);
assert.equal(
  fallbackAction({ role: 'farmer and food keeper' }, hungryCookStatus, 'NONE', 5),
  'mc smelt raw_porkchop',
  'the fallback chain must prefer cooking over gathering when a furnace is near',
);

// Name-gating: a message naming one bot belongs to that bot alone.
const namedMinions = loadFunction('namedMinions');
const canClaimHumanMessage = loadFunction('canClaimHumanMessage', `\nconst namedMinions = ${namedMinions.toString()};`);
const BOT_NAMES = ['Steve', 'Reed', 'Moss', 'Flint', 'Ember'];
assert.deepEqual(
  namedMinions('Reed come here please', BOT_NAMES),
  ['Reed'],
  'a message naming Reed must resolve to Reed only',
);
assert.deepEqual(
  namedMinions('does anyone have wood?', BOT_NAMES),
  [],
  'an unnamed message must resolve to nobody so the shared behavior applies',
);
assert.equal(
  canClaimHumanMessage('Steve', 'Reed come here please', BOT_NAMES),
  false,
  'Steve must not claim a message addressed to Reed',
);
assert.equal(
  canClaimHumanMessage('Reed', 'Reed come here please', BOT_NAMES),
  true,
  'Reed must claim a message addressed to Reed',
);
assert.equal(
  canClaimHumanMessage('Moss', 'does anyone have wood?', BOT_NAMES),
  true,
  'unnamed messages stay shared so every bot can answer',
);

// Shared player tracking: sightings become walkable coords, stale ones drop.
const updatePlayerSightings = loadFunction('updatePlayerSightings');
const playerSightingLine = loadFunction('playerSightingLine');
const sightings = new Map();
const seenStatus = JSON.stringify({
  data: { nearbyPlayers: [{ name: 'Duckets', distance: 6, position: { x: 50.7, y: 63, z: 85.2 } }] },
});
updatePlayerSightings(sightings, 'Reed', seenStatus, 1000000);
const line = playerSightingLine(sightings, 1040000);
assert.ok(
  line.includes('Duckets last seen at 50,63,85 by Reed'),
  'a fresh sighting must render as walkable coords with the spotting bot',
);
assert.equal(
  playerSightingLine(sightings, 1000000 + 300001),
  '',
  'sightings older than 5 minutes must expire so bots stop walking to ghosts',
);
assert.equal(
  playerSightingLine(new Map()),
  '',
  'no sightings means no tracking line in the observation',
);

// Game knowledge: both prompts must teach mechanics + error recovery + beds.
const promptSource = fs.readFileSync(sourcePath, 'utf8');
for (const needle of ['MINECRAFT BASICS', 'ERROR RECOVERY', '46..54', 'crafting_table', 'furnace', 'FOOD CHAINS', 'mc till', 'mc harvest', 'mc breed', 'mc fish', 'mc door', 'mc inspect', 'DOORS ARE THE ONLY WAY THROUGH WALLS']) {
  assert.ok(promptSource.includes(needle), `controller prompt must teach ${needle}`);
}
const bridgeSource = fs.readFileSync(new URL('../lmstudio-bridge/bridge.mjs', import.meta.url), 'utf8');
for (const needle of ['Mechanics you must know', 'Errors tell you the fix', '46..54', 'mc door', 'mc harvest', 'ENTER THROUGH DOORS ONLY']) {
  assert.ok(bridgeSource.includes(needle), `bridge prompt must teach ${needle}`);
}

// Bot server: farm/ranch/door/inspect actions must exist with helpful errors.
const botSource = fs.readFileSync(new URL('../minecraft/bot-server/server.js', import.meta.url), 'utf8');
for (const needle of ['async till(', 'async sow(', 'async harvest(', 'async breed(', 'async shear(', 'async milk(', 'async fish(', 'async door(', 'async inspect(', 'async bg_goto(', '_scanNear', "That's a door", 'never break beds']) {
  assert.ok(botSource.includes(needle), `bot server must implement ${needle}`);
}

// Chat responsiveness: night sleep must walk to beds after failing; "come with
// me" must follow; failed follows must walk to the last player sighting.
const nightStatus = JSON.stringify({
  data: { health: 20, food: 20, inventory: [], nearbyEntities: [], isDay: false, position: { x: 50, y: 63, z: 85 } },
});
const survivalNearHouse = loadFunction('survivalAction', houseHelpers);
assert.equal(
  survivalNearHouse(nightStatus, ''),
  'mc sleep',
  'first night tick near home must sleep',
);
assert.equal(
  survivalNearHouse(nightStatus, 'mc sleep -> ERROR mc exit 1: ERROR: No bed within 4 blocks. | priority survival'),
  'mc goto_near 50 63 77',
  'a failed sleep must walk to the bed row instead of failing forever',
);
assert.equal(
  directRequestAction('come with me', 'Duckets'),
  'mc follow Duckets',
  '"come with me" must follow the speaker',
);
const sightingDeps = `const playerSightings = new Map([['Duckets', { x: 60, y: 64, z: 80, by: 'Steve', at: Date.now() }]]);\n${houseHelpers}${furnaceDep}\nconst fallbackAction = ${fallbackAction.toString()};`;
const recoveryWithSightings = loadFunction('recoveryAfterFailedAction', sightingDeps);
assert.equal(
  recoveryWithSightings(
    { name: 'Steve' },
    nightStatus,
    'mc follow Duckets',
    'mc exit 1: ERROR: Player/entity "Duckets" not found nearby.',
    5,
  ),
  'mc bg_goto 60 64 80',
  'a failed follow must walk to the last player sighting instead of giving up',
);

// Natural talk: first claimer answers publicly; plain-words doing lines.
const claimPublicReply = loadFunction('claimPublicReply', 'const publicReplyClaimed = new Set();');
assert.equal(claimPublicReply('Duckets', 'hello'), true, 'first claimer wins the public reply');
assert.equal(claimPublicReply('Duckets', 'hello'), false, 'second claimer stays quiet — no echo');
const plainDoing = loadFunction('plainDoing');
assert.equal(plainDoing({ name: 'Steve' }, '{}', 'mc follow Duckets -> ok'), 'on my way over');
assert.equal(plainDoing({ name: 'Moss' }, '{}', 'mc sleep -> ok'), 'getting some sleep');
assert.ok(!plainDoing({ name: 'Reed' }, '{}', 'whatever').includes('('), 'doing line must not be a robotic status report');

console.log('minion-controller regression tests: PASS');
