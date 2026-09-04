#!/usr/bin/env node
/**
 * HermesCraft Minion Controller
 *
 * Spawns one Mineflayer bot body per "minion" character, each with its own
 * Minecraft username, its own inventory, and its own LM Studio reasoning
 * loop. Designed to populate a vanilla Minecraft world with several
 * AI-driven characters running in parallel, alongside your Hermes companion.
 *
 * Configuration is a JSON list passed via the MINION_CONFIG env var or the
 * `--config <path>` CLI flag.
 *
 * Example MINION_CONFIG:
 *
 *   [
 *     { "name": "Steve",       "model": "google/gemma-4-26b-a4b-qat", "interval_ms": 6000 },
 *     { "name": "Reed",        "model": "google/gemma-4-26b-a4b-qat", "interval_ms": 8000 },
 *     { "name": "Moss",        "model": "ornith-1.5-35b-a3b",        "interval_ms": 8000 },
 *     { "name": "Flint",       "model": "ornith-1.5-35b-a3b",        "interval_ms": 7000 },
 *     { "name": "Ember",       "model": "ornith-1.5-9b",            "interval_ms": 7000 }
 *   ]
 *
 * Run:
 *   node minion-controller.mjs --config ~/minecraft/minion-config.json
 *   MINION_CONFIG="$(cat ~/minecraft/minion-config.json)" node minion-controller.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createIntelligenceJournal } from '../intelligence/journal.mjs';
import { auditAction } from '../intelligence/shadow-audit.mjs';

const args = process.argv.slice(2);
let cfgPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config') cfgPath = args[i + 1];
}
const raw = cfgPath ? fs.readFileSync(cfgPath, 'utf8') : (process.env.MINION_CONFIG || '[]');
let minions;
try { minions = JSON.parse(raw); }
catch (err) {
  console.error('MINION_CONFIG is not valid JSON:', err.message);
  process.exit(2);
}
if (!Array.isArray(minions) || minions.length === 0) {
  console.error('MINION_CONFIG must be a non-empty array of {name,model,interval_ms}');
  process.exit(2);
}

const LMS_URL = (process.env.LMS_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
const MC_CLI = process.env.MC_CLI || `${process.env.HOME}/.local/bin/mc`;
const LMS_API_KEY = process.env.LMS_API_KEY || '';
const LMS_HEADERS = { 'content-type': 'application/json', ...(LMS_API_KEY ? { authorization: `Bearer ${LMS_API_KEY}` } : {}) };
const BRIDGE_PORT = parseInt(process.env.MINION_BRIDGE_PORT || '3003', 10);
const DEFAULT_MC_API = process.env.MC_API_URL || 'http://127.0.0.1:3001';
const configuredIntelligenceMode = process.env.INTELLIGENCE_MODE || 'observe';
const INTELLIGENCE_MODE = ['observe', 'shadow', 'canary', 'active'].includes(configuredIntelligenceMode)
  ? configuredIntelligenceMode
  : 'observe';
const INTELLIGENCE_CANARY = String(process.env.INTELLIGENCE_CANARY || '').slice(0, 20);
const intelligenceJournal = createIntelligenceJournal();
const shadowJournal = createIntelligenceJournal({ limit: 200 });
// Parallel model calls allowed per user 2026-09-03: all minions think at once.
// lmsQueueDepth is kept only for health visibility / queued fallback prefix.
let lmsQueueDepth = 0;
const teamChat = [];
let villageCenter = null;
const handledHumanChat = new Map();
// Shared eyes: every bot's nearbyPlayers feed one map, so a bot that cannot
// see you can still walk to your last-seen coords (players unload beyond
// render distance, so no single bot can track you alone).
// Web-UI injection: messages sent from mission control arrive here and join
// the same human-chat flow as in-game talk (same claims, replies, actions).
// Optional `target` limits handling to one bot (a DM); otherwise all can claim.
const injectedHuman = [];
function injectHumanMessage(from, message, target = '') {
  injectedHuman.push({ from, message, target, at: Date.now() });
  while (injectedHuman.length > 50) injectedHuman.shift();
}
function takeInjectedHuman(minionName) {
  const now = Date.now();
  while (injectedHuman.length > 0 && now - injectedHuman[0].at > 600000) injectedHuman.shift();
  return injectedHuman
    .filter((m) => !m.target || m.target === minionName)
    .map((m) => ({ from: m.from, message: m.message, ago: `${Math.round((now - m.at) / 1000)}s` }));
}
// Shared eyes: every bot's nearbyPlayers feed one map, so a bot that cannot
// see you can still walk to your last-seen coords (players unload beyond
// render distance, so no single bot can track you alone).
const playerSightings = new Map();
// Anti-spam: public chat is team-shared and rate-limited. Whispers are always
// allowed; public barks require per-bot + team cooldowns. Direct REPLIES to a
// human bypass cooldowns (first claimer wins) — answering a person is never spam.
const lastPublicChatByBot = new Map();
let lastTeamPublicChat = 0;
const publicReplyClaimed = new Set();
function canPublicChat(botName, botCooldownMs = 120000, teamCooldownMs = 15000) {
  const now = Date.now();
  if (now - lastTeamPublicChat < teamCooldownMs) return false;
  if (now - (lastPublicChatByBot.get(botName) || 0) < botCooldownMs) return false;
  return true;
}
function markPublicChat(botName) {
  const now = Date.now();
  lastPublicChatByBot.set(botName, now);
  lastTeamPublicChat = now;
}
// Returns true only for the first bot to answer this human message publicly.
function claimPublicReply(from, message) {
  const key = `reply:${from}:${message}`;
  if (publicReplyClaimed.has(key)) return false;
  publicReplyClaimed.add(key);
  if (publicReplyClaimed.size > 100) publicReplyClaimed.delete(publicReplyClaimed.keys().next().value);
  return true;
}
// Plain-words activity for chat — never the robotic status line.
function plainDoing(minion, statusJson, lastAction = '') {
  let d = {};
  try { d = JSON.parse(statusJson).data || {}; } catch {}
  const act = (lastAction || '').split('->')[0].replace(/^(background work \||queued inference \||human request \||rejected:)\s*/, '').trim();
  if (/sleep/i.test(act)) return 'getting some sleep';
  if (/goto|follow|walk|heading/i.test(act)) return 'on my way over';
  if (/collect|mine|dig|harvest/i.test(act)) return 'out gathering';
  if (/craft|smelt|cook|build|place/i.test(act)) return 'making stuff at the village';
  if (/fight|flee|attack/i.test(act)) return 'dealing with a mob';
  if (/fish/i.test(act)) return 'out fishing';
  if (/till|sow|breed|shear|milk|farm/i.test(act)) return 'working the farm';
  if (/eat/i.test(act)) return 'grabbing a bite';
  return 'working on the village';
}

// ── Village goal (set live from Mission Control; the prompt reads it every tick) ──
let villageGoal = 'Build a safe starter village with the other players.';
const pausedBots = new Set();
function setVillageGoal(goal, author = 'Duckets (web)') {
  villageGoal = String(goal).slice(0, 800);
  rememberTeamChat('PLAN', `New village goal set by ${author}: ${villageGoal} — make your next actions advance it.`);
  return villageGoal;
}

const PROMPT_TMPL = (name, role = 'village resident') => `You are ${name}, the ${role}, an AI player in a Minecraft world.

MISSION: ${villageGoal} Follow this loop forever: assess threats and health; answer human and team chat; scout a safe flat site; gather the resources your role needs; craft useful tools, food, torches and building materials; construct a small house, farm, path, storage area or defenses; light the area; report exactly what you did; then choose the next task. Never stand still just because the scene is unfamiliar.

DETAILED GAMEPLAY: Minecraft is a survival game. Look around, move deliberately, collect drops, use crafting recipes, make tools before mining, eat when hungry, avoid falls and hostile mobs, sleep or shelter at night, and return to the village area after scouting. Builders gather logs, convert logs to planks, and place walls/floors/roofs. Farmers gather grass/seeds and food, plant and harvest crops, and share food. Miners gather stone, coal, iron and useful ores and report locations. Scouts check terrain and danger, escort teammates, light paths, and defend the village. Claim tasks in chat so two bots do not duplicate work. Use only materials you possess and never grief existing player builds.

ACTION PRIORITIES: (1) When a hostile is close, equip the best weapon available, fight if healthy, or flee and warn the team if injured. (2) When safe, eat if hungry; craft planks from logs, then crafting tools, weapons, food and torches when materials permit. Cook raw food and smelt ores with mc smelt ITEM whenever a furnace is near; miners with 8+ cobblestone craft a furnace at a crafting table and place one at the yard. (3) Builders must turn planks into an actual shelter, paths, storage or defensive walls, not just carry resources. (4) Farmers keep food and seeds available. (5) Miners supply stone/ores. (6) Scouts light and defend routes. After every completed action, report useful results and choose the next physical task—never remain idle.

You observe the world with shell commands and act with shell commands.
Use the literal program \`mc\` for everything. Never use code fences; just
plain text commands.

Format your reply like this and NOTHING else:

THINK: one short sentence about what you noticed.
ACT: a single \`mc\` command with arguments, OR \`NONE\` if no action is
warranted this turn.

Available observations (read-only):
  mc status
  mc inventory
  mc nearby [radius]
  mc map [radius]
  mc look
  mc scene [radius]
  mc read_chat [count]

Available actions:
  mc chat "message"
  mc chat_to PLAYName "message"
  mc collect BLOCK n
  mc craft ITEM
  mc recipes ITEM
  mc goto x y z
  mc goto_near x y z
  mc attack MOB
  mc fight MOB
  mc eat
  mc equip ITEM
  mc place BLOCK x y z
  mc dig x y z
  mc find_blocks BLOCK
  mc find_entities MOB
  mc follow PLAYName
  mc pickup
  mc smelt ITEM
  mc flee [radius]
  mc sleep (our beds are at x=46..54, y=63, z=77 — walk there first)
  mc till [n] (hoe dirt/grass/coarse_dirt into farmland)
  mc sow [SEED] [n] (plant seeds on empty farmland; break short_grass for wheat_seeds)
  mc harvest (cut ripe crops: wheat age 7 golden, carrots/potatoes 7, beetroot 3)
  mc breed cow|sheep|pig|chicken (needs 2 nearby + wheat/carrots/seeds; makes babies)
  mc shear (wool from sheep; regrows after grazing)
  mc milk (milk_bucket from cow; cures poison)
  mc fish [seconds] (needs fishing_rod + open water + sky; run long casts in background)
  mc door (open nearest wooden door — USE THIS, never dig walls) / mc door close
  mc inspect x y z (what block is there? growth age, door open/closed)
  mc bg_goto x y z (long walks, runs in background — this action EXISTS, use it)
  mc wait N

FOOD CHAINS (how the village eats — run these loops, don't wait for food to appear):
- FARM: mc till → mc sow → wait for daylight growth (~20 min, faster wet) → mc harvest → mc sow again. Wheat → bread via crafting table; feed wheat to cows/sheep.
- RANCH: keep 2+ cows/sheep together near the house (lure with held wheat: mc equip wheat, walk slowly). mc breed cow with wheat → calves → more beef/leather. mc shear sheep → wool → beds/clothes. mc milk cow → milk_bucket.
- FISH: craft rod (3 sticks + 2 string from night spiders), stand at open shore water with sky above, mc fish. Cook raw_cod/salmon in furnace.
- WILD: break short_grass/tall_grass for wheat_seeds; kill pigs/chickens for pork/chicken; NEVER eat raw chicken (hunger risk) — cook it.
- A farmer with no seeds breaks grass first; a rancher with no animals explores with wheat in hand; a fisher with no rod hunts spiders at night. Hunger below 14 means drop everything and get food.

DOORS ARE THE ONLY WAY THROUGH WALLS. Digging through a wall, fence, or door to get inside is griefing and is FORBIDDEN — no exceptions, even if pathfinding says "no path". The pattern is: walk to the door → mc door → mc goto_near to a point PAST it → mc door close. If no door exists, walk AROUND the building. mc dig refuses doors and beds; if you see that refusal, you were about to grief — use the door.

MINECRAFT BASICS (how this world works): Days and nights are ~10 min each. Sunlight burns zombies/skeletons/husks but NOT creepers, spiders, or endermen. Hunger drains over time — mc eat always picks your best food, so keep food on you. Tool tiers: wood < stone < iron < diamond; each tier mines faster and unlocks ores (stone pick for iron ore, iron pick for diamond/gold). A crafting table unlocks 3x3 recipes and mc craft needs one within 4 blocks; the table itself costs 4 planks and needs NO table. A furnace costs 8 cobblestone at a table and needs fuel (coal, charcoal, planks, or logs) — cook raw meat/potatoes, smelt raw iron/gold. Fall damage kills: never jump off heights, water breaks falls. Doors/gates must be walked through, never broken; a closed door blocks pathfinding, so route around or ask the player. Beds skip the night AND set spawn, but only work at night within 4 blocks. Chests, furnaces, and tables are shared: deposit spares, take what the job needs, say what you took.
ERROR RECOVERY (read your LAST ACTION error, fix the cause, NEVER retry the identical failing command): "No X in inventory" → gather or craft X first. "can't see / not visible" → mc goto_near the target, then collect/dig. "Task already running" → wait one turn, never stack movement. "No furnace within 4 blocks" → walk to a furnace or craft one. "No bed within 4 blocks" → mc goto_near 50 63 77 then mc sleep (night only). "it's not night" → work until evening. "Need a crafting table" → mc craft crafting_table anywhere (4 planks). "Missing ingredients" → check mc recipes ITEM, then gather. "No path / unreachable" → move to open ground and route around; water, cliffs, and leaves strand pathfinding. "No door within 4 blocks" → walk to the door first. "That's a door/bed" → you were about to grief: use mc door / mc sleep. "Only found 1" → need 2 adults, find more. "No hoe/seeds/rod/bucket/shears" → craft it (mc recipes) or ask the team. "no bite yet" → wrong spot: move to open shore water with sky above and recast.

Rules:
1. SURVIVAL OVERRIDES EVERYTHING: if a hostile mob is close, fight it when healthy and equipped, otherwise flee; if health is low, eat or flee to safety; never continue gathering while being attacked.
2. PROTECT PLAYER BUILDS — fences, walls, paths, crops, chests, doors, torches, and decorations that any player placed are theirs. Do NOT dig, break, or replace them. ENTER THROUGH DOORS AND GATES ONLY: never break a wall, fence, or door to get inside — use mc door on closed doors, then walk through and close it. Do not walk through fences or crops. Stay at your yard spot outside the house unless the player invites you in. Never run \`mc dig\` or \`mc collect\` within 8 blocks of the house (50,63,85). Breaking into a build is the worst thing you can do; a teammate who does it must repair the damage immediately with matching blocks.
3. Treat every \`Human request to NAME ...\` / \`Human question to ALL ...\` message in TEAM CHAT as a shared team plan. If NAME is you (or ALL), acknowledge it in chat and make your next physical action advance that request; if another teammate is named, choose a supporting task and report what you can contribute.
4. The mission above has priority. Do not choose \`NONE\` or an observation command as your turn; take a movement, gathering, crafting, building, defense, food, or communication action.
5. Communication is required at least every second turn: claim tasks, report discoveries/resources, request supplies, warn of danger, and report completed work. If a human names one specific player, only that player answers and acts — everyone else stays silent and keeps working. To find a player you cannot see, walk to their KNOWN PLAYER POSITION coords with mc goto_near, then mc follow <name> once close.
6. Follow the gameplay loop: observe once, decide, act, verify the result, then continue. Never loop observations or stand still.
7. Be brief. THINK in one sentence, ACT in one line.
8. Talk like a person, not a status report. When you use mc chat, write what a friendly player would actually type: short, warm, specific ("got it, bringing wood!", "careful, creeper by the farm"). Never emit robotic lines like "on it — NAME (role) at X holding Y". Vary your words; never repeat the same line twice in a row.
9. USER TASK QUEUE: if STATUS shows user_queue with a running action or depth above 0, the player gave direct orders through Mission Control — do NOT start competing movement, digging, or gathering. Support with chat, crafting at your spot, eating, or mc wait, and let the queue finish.`;

function callMc(args, apiUrl = DEFAULT_MC_API) {
  return new Promise((resolve, reject) => {
    const proc = spawn(MC_CLI, args, {
      env: { ...process.env, MC_API_URL: apiUrl },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', err = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.stderr.on('data', (c) => { err += c.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`mc exit ${code}: ${err.trim()}`));
      resolve(out.trim());
    });
  });
}

async function lmsComplete(model, observation, name, role) {
  lmsQueueDepth += 1;
  try { return await lmsCompleteUnlocked(model, observation, name, role); }
  finally { lmsQueueDepth -= 1; }
}

async function lmsCompleteUnlocked(model, observation, name, role) {
  const res = await fetch(`${LMS_URL}/chat/completions`, {
    method: 'POST',
    headers: LMS_HEADERS,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: PROMPT_TMPL(name, role) },
        { role: 'user', content: observation },
      ],
      max_tokens: 512,
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`lms ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || j.choices?.[0]?.message?.reasoning_content || '').trim();
}

const state = new Map();
for (const m of minions) {
  state.set(m.name, { name: m.name, last_observation: '', last_action: 'NONE — initialized', pending: false, activity_pending: false, action_busy: false, ticks: 0, last_pos: '', stuck_count: 0, safetyVitals: {} });
}

// Same rounded position across ticks while trying to move = stuck (cave/wall).
// Cancel the jammed task and turn to find a new path instead of pushing forever.
function stuckNudge(entry, statusJson) {
  let key = '';
  try {
    const p = JSON.parse(statusJson).data?.position;
    if (!p) return '';
    key = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
  } catch { return ''; }
  if (key && key === entry.last_pos) entry.stuck_count = (entry.stuck_count || 0) + 1;
  else { entry.last_pos = key; entry.stuck_count = 0; }
  if ((entry.stuck_count || 0) >= 3 && /goto|collect|dig|follow/.test(entry.last_action)) {
    entry.stuck_count = 0;
    return 'STUCK';
  }
  return '';
}

function rememberTeamChat(from, message) {
  teamChat.push({ from, message, time: new Date().toISOString() });
  while (teamChat.length > 20) teamChat.shift();
}

function parseCommand(line) {
  const tokens = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(line)) !== null) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

function survivalAction(statusJson, lastAction = '') {
  let d = {};
  try { d = JSON.parse(statusJson).data || {}; } catch {}
  const hostile = (d.nearbyEntities || []).find((e) => e.kind === 'hostile');
  const food = (d.inventory || []).some((i) => /bread|apple|carrot|potato|beef|pork|chicken|mutton|fish|stew/i.test(i.name) && i.count > 0);
  if (d.isInWater === true || /submerged|in water/i.test(String(d.hazard || ''))) {
    return /mc stop\b/.test(lastAction || '') ? 'mc jump' : 'mc stop';
  }
  if (hostile && hostile.distance <= 10 && (d.health || 0) >= 10) return `mc fight ${hostile.type}`;
  if ((d.health || 0) < 10 && food) return 'mc eat';
  if (hostile && hostile.distance <= 18) return (d.health || 0) >= 14 ? `mc fight ${hostile.type}` : 'mc flee 20';
  // At night with no threat near home, sleep to set spawn (beds at the house).
  // Two-step: a failed sleep means no bed in reach, so walk to the bed row first.
  if (d.isDay === false && !hostile && d.position && typeof nearHouse === 'function' && nearHouse(d.position, 20)) {
    return /No bed within 4 blocks/.test(lastAction || '') ? 'mc goto_near 50 63 77' : 'mc sleep';
  }
  return '';
}

function humanMessages(statusJson, botNames = []) {
  let d = {};
  try { d = JSON.parse(statusJson).data || {}; } catch {}
  const bots = new Set(botNames.map((name) => name.toLowerCase()));
  return (d.unreadChat || []).filter((m) => {
    if (!m.from || bots.has(m.from.toLowerCase())) return false;
    const age = Number.parseInt(m.ago, 10);
    // The APIs retain chat history. Ignore stale requests after a controller
    // restart, while allowing a generous window (slow 30-54s thinkers).
    return Number.isNaN(age) || age <= 600;
  });
}

function assignedMinionName(message) {
  const text = (message || '').toLowerCase();
  const named = minions.find((m) => text.includes(m.name.toLowerCase()));
  if (named) return named.name;
  if (/kill|enemy|mob|defend|attack|guard|torch|light|scout/.test(text)) return 'Ember';
  if (/farm|food|seed|crop|plant|harvest/.test(text)) return 'Moss';
  if (/mine|ore|stone|coal|iron|cave/.test(text)) return 'Flint';
  if (/build|house|shelter|wall|roof|path|road|storage/.test(text)) return 'Reed';
  return 'Steve';
}

// Execute unambiguous player requests directly. This prevents the model from
// turning a spoken request into an acknowledgement without gameplay.
function directRequestAction(message, sender) {
  const text = (message || '').toLowerCase();
  const coords = (message || '').match(/(?:xyz|coords?|coordinates?)?\s*:\s*(-?\d+(?:\.\d+)?)\s*[/, ]+\s*(-?\d+(?:\.\d+)?)\s*[/, ]+\s*(-?\d+(?:\.\d+)?)/i);
  if (coords && /\b(come|go|meet|follow|here|xyz|coord)/.test(text)) {
    return `mc goto_near ${Math.floor(Number(coords[1]))} ${Math.floor(Number(coords[2]))} ${Math.floor(Number(coords[3]))}`;
  }
  if (/\bfollow me\b/.test(text)) return `mc follow ${sender}`;
  if (/\bcome (with|to|here)\b/.test(text)) return `mc follow ${sender}`;
  if (/\b(run|flee|retreat)\b/.test(text)) return 'mc flee 20';
  if (/\b(make|craft)\b.*\bsword\b|\bsword\b/.test(text)) return 'mc craft wooden_sword';
  if (/\b(bed|respawn|sleep|set (your |their |his |her )?spawn)\b/.test(text)) return 'mc sleep';
  if (/\b(kill|attack|fight)\b.*\b(zombie|skeleton|creeper|spider)\b/.test(text)) {
    const mob = (text.match(/\b(zombie|skeleton|creeper|spider)\b/) || [])[1];
    return mob ? `mc fight ${mob}` : '';
  }
  return '';
}

function rememberHumanMessage(minionName, message) {
  const key = `${minionName}:${message.from}:${message.message}`;
  if (handledHumanChat.has(key)) return false;
  handledHumanChat.set(key, Date.now());
  while (handledHumanChat.size > 100) handledHumanChat.delete(handledHumanChat.keys().next().value);
  return true;
}

// Name-gating: "Reed come here" is for Reed only — the rest stay silent and
// keep working. DuckBot is included as the fleet leader so leader-directed
// traffic cannot be claimed by a Landfolk controller turn.
function landfolkKnownNames() {
  return ['DuckBot', ...minions.map((m) => m.name)];
}
function namedMinions(message, botNames) {
  const text = (message || '').toLowerCase();
  return (botNames || []).filter((n) => text.includes(String(n).toLowerCase()));
}
function canClaimHumanMessage(minionName, message, botNames) {
  const named = namedMinions(message, botNames);
  return named.length === 0 || named.includes(minionName);
}

// Shared player tracking. Record every visible player per tick; report
// sightings fresher than 5 minutes as walkable coords.
function updatePlayerSightings(sightings, minionName, statusJson, now = Date.now()) {
  try {
    const players = JSON.parse(statusJson).data?.nearbyPlayers || [];
    for (const p of players) {
      if (!p.name || !p.position) continue;
      sightings.set(p.name, {
        x: Math.floor(p.position.x), y: Math.floor(p.position.y), z: Math.floor(p.position.z),
        by: minionName, at: now,
      });
    }
  } catch {}
}
function playerSightingLine(sightings, now = Date.now()) {
  const fresh = [...sightings.entries()].filter(([, s]) => now - s.at <= 300000);
  if (fresh.length === 0) return '';
  return 'KNOWN PLAYER POSITIONS (shared eyes — walk to these coords with mc goto_near to find them): ' +
    fresh.map(([name, s]) => `${name} last seen at ${s.x},${s.y},${s.z} by ${s.by} ${Math.round((now - s.at) / 1000)}s ago`).join('; ');
}

// Short truthful progress line so chatter describes real work, not canned spam.
function progressSummary(minion, statusJson, lastAction = '') {
  let d = {};
  try { d = JSON.parse(statusJson).data || {}; } catch {}
  const pos = d.position ? `${Math.floor(d.position.x)},${Math.floor(d.position.y)},${Math.floor(d.position.z)}` : 'unknown';
  const inv = (d.inventory || []).filter((i) => i.count > 0).slice(0, 3).map((i) => `${i.count} ${i.name}`).join(', ') || 'empty hands';
  const act = (lastAction || '').split('->')[0].replace(/^(background work \||queued inference \||human request \|)\s*/, '').trim().slice(0, 90) || 'village work';
  return `${minion.name} (${minion.role || 'villager'}) at ${pos} holding ${inv} — last did: ${act}`;
}
// Answer "does anyone have X / who has X / I need X" with real inventory truth.
// Without this the model turns supply questions into silence or vague promises.
function inventoryStatusReply(minion, statusJson, message) {
  const text = (message || '').toLowerCase();
  // Only true supply questions — not every order containing "have/has".
  if (!/(does anyone have|does anybody have|who has|who('| i)s got|do you have|have you got|have any|need (any )?(wood|stone|food|dirt|coal|iron|torch|plank|log|sticks?)|give me|spare|extra)/.test(text)) return '';
  let wanted = null;
  if (/wood|log|plank|stick/.test(text)) wanted = /log|wood|plank|stick/;
  else if (/stone|cobble|deepslate|diorite/.test(text)) wanted = /stone|cobble|deepslate|diorite/;
  else if (/food|bread|apple|carrot|potato|beef|pork|chicken|eat|hungry/.test(text)) wanted = /bread|apple|carrot|potato|beef|pork|chicken|mutton|fish|stew|wheat|seed/;
  else if (/coal|iron|ore|diamond|torch|dirt|seed|crop/.test(text)) wanted = /coal|iron|ore|diamond|torch|dirt|seed/;
  else if (/have|has|need|give|spare/.test(text)) wanted = /./;
  if (!wanted) return '';
  let inv = [];
  try { inv = JSON.parse(statusJson).data?.inventory || []; } catch {}
  const have = inv.filter((i) => wanted.test(i.name) && i.count > 0);
  if (have.length > 0) {
    const list = have.map((i) => `${i.count} ${i.name}`).join(', ');
    return `${minion.name}: I have ${list}. Tell me where to meet and I'll share.`;
  }
  return `${minion.name}: I don't have any spare ${/food|eat|hungry/.test(text) ? 'food' : /stone/.test(text) ? 'stone' : /wood|log|plank/.test(text) ? 'wood' : 'supplies'} on me — I'll gather some now.`;
}
// Home anchor (user 2026-09-03: "this is our house"): stragglers regroup to the
// house yard, NEVER into the house block itself. Per-bot yard spots keep them
// out of walls/doors; they must use doors, never dig through.
const HOUSE = { x: 50, y: 63, z: 85 };
const HOUSE_SAFE_RADIUS = 8;
function houseRally(minionName) {
  switch (minionName) {
    case 'Steve': return { x: 44, y: 63, z: 85 };
    case 'Reed': return { x: 56, y: 63, z: 85 };
    case 'Moss': return { x: 50, y: 63, z: 79 };
    case 'Flint': return { x: 50, y: 63, z: 91 };
    default: return { x: 47, y: 63, z: 82 };
  }
}
function nearHouse(pos, r = HOUSE_SAFE_RADIUS) {
  if (!pos) return false;
  return Math.hypot(pos.x - HOUSE.x, pos.y - HOUSE.y, pos.z - HOUSE.z) < r;
}
const villagePositions = new Map();
function updateVillageCenter(minion, statusJson) {
  try {
    const pos = JSON.parse(statusJson).data?.position;
    if (!pos) return;
    villagePositions.set(minion.name, { x: pos.x, y: pos.y, z: pos.z });
  } catch {}
  villageCenter = { ...HOUSE };
}

function regroupAction(minion, statusJson, center) {
  if (!center) return '';
  try {
    const pos = JSON.parse(statusJson).data?.position;
    if (!pos) return '';
    // Close enough to home: stay in the yard, never push into the house.
    if (nearHouse(pos)) return '';
    const rally = houseRally(minion.name);
    const distance = Math.hypot(pos.x - rally.x, pos.y - rally.y, pos.z - rally.z);
    if (distance <= 6) return '';
    // Long trek to yard: background task so walking isn't cancelled next turn.
    if (distance > 30) return `mc bg_goto ${rally.x} ${rally.y} ${rally.z}`;
    return `mc goto_near ${rally.x} ${rally.y} ${rally.z}`;
  } catch {}
  return '';
}

function coordinatedAction(minion, statusJson, lastAction, tick) {
  return regroupAction(minion, statusJson, villageCenter) || fallbackAction(minion, statusJson, lastAction, tick);
}

// Furnace workflow, cherry-picked from yuniko-software/minecraft-mcp-server's
// smelt-item tool design (Apache-2.0): the bot API auto-selects fuel from
// inventory and waits for output, so the controller only has to notice
// "raw material + furnace nearby". Cooks raw food when hungry (or when the
// kitchen has nothing ready), smelts ores otherwise, and has miners/builders
// prepare a furnace at a crafting table when they hold 8+ cobblestone.
function furnaceAction(minion, statusJson) {
  const SMELT_FOOD = ['raw_porkchop', 'raw_beef', 'raw_chicken', 'raw_mutton', 'raw_rabbit', 'raw_salmon', 'raw_cod', 'potato'];
  const SMELT_ORE = ['raw_iron', 'raw_gold', 'raw_copper'];
  const COOKED_FOOD = /cooked_|baked_potato|bread|apple|carrot|steak|porkchop|chicken|mutton|salmon|fish|stew|melon|cookie|pumpkin_pie/i;
  let parsed = {};
  try { parsed = JSON.parse(statusJson); } catch { return ''; }
  const data = parsed.data || {};
  const seen = [...(data.scene?.visible_block_hits || []), ...(data.notableBlocks || [])].map((b) => b.name);
  const inv = Object.fromEntries((data.inventory || []).map((i) => [i.name, i.count]));
  if (seen.includes('furnace') || seen.includes('lit_furnace')) {
    const rawFood = SMELT_FOOD.find((n) => inv[n] > 0);
    const hasCooked = (data.inventory || []).some((i) => COOKED_FOOD.test(i.name) && i.count > 0);
    if (rawFood && ((data.food ?? 20) < 14 || !hasCooked)) return `mc smelt ${rawFood}`;
    const ore = SMELT_ORE.find((n) => inv[n] > 0);
    if (ore) return `mc smelt ${ore}`;
    return '';
  }
  // No furnace in sight: miners/builders holding 8+ cobblestone prepare one
  // at a nearby crafting table instead of wandering. Placement stays
  // model-driven via mc place_fill at the yard.
  if ((inv.cobblestone || 0) >= 8 && !inv.furnace && seen.includes('crafting_table')) {
    const role = (minion.role || '').toLowerCase();
    if (role.includes('miner') || role.includes('builder') || role.includes('planner')) return 'mc craft furnace';
  }
  return '';
}

function fallbackAction(minion, statusJson, lastAction = '', tick = 0) {
  const furnace = furnaceAction(minion, statusJson);
  if (furnace) return furnace;
  let parsed = {};
  try { parsed = JSON.parse(statusJson); } catch {}
  const data = parsed.data || {};
  const hits = data.scene?.visible_block_hits || [];
  const visible = hits.map((b) => b.name);
  const known = data.notableBlocks || [];
  const recovery = /can't see|not visible/i.test(lastAction);
  const rawTargets = recovery && hits.length > 0 ? hits : (known.length > 0 ? known : hits);
  // Never mine/gather the house itself: drop any target inside the safe radius.
  const targets = rawTargets.filter((b) => !nearHouse(b.position));
  const role = (minion.role || '').toLowerCase();
  const pos = data.position || { x: 0, y: 70, z: 0 };
  const inv = Object.fromEntries((data.inventory || []).map((i) => [i.name, i.count]));
  // Builders work at their yard spot, never inside the house walls.
  const yard = houseRally(minion.name);
  // Stripped logs/wood are not valid plank ingredients in this server build.
  // Treat them as salvage, then gather fresh normal logs rather than retrying
  // an impossible craft forever.
  const logs = Object.entries(inv).find(([n, c]) => !n.startsWith('stripped_') && (n.endsWith('_log') || n.endsWith('_wood')) && c > 0);
  const woodType = logs?.[0]?.replace(/_(log|wood)$/, '');
  const craftable = woodType ? `${woodType}_planks` : null;
  const planks = Object.entries(inv).find(([n, c]) => n.endsWith('_planks') && c >= 4);
  const builder = role.includes('builder') || role.includes('planner');
  if (builder && planks) {
    return `mc place_fill ${planks[0]} ${yard.x} ${Math.floor(pos.y) - 1} ${yard.z} ${yard.x + 2} ${Math.floor(pos.y)} ${yard.z + 2} hollow`;
  }
  if (builder && craftable) return `mc craft ${craftable}`;
  const wanted = role.includes('farmer') ? ['grass_block', 'dirt']
    : role.includes('miner') ? ['stone', 'deepslate', 'diorite']
    : ['oak_log', 'jungle_log', 'birch_log', 'cherry_log'];
  const target = targets.find((b) => wanted.includes(b.name)) || targets[0];
  if (target?.position && (recovery || tick % 5 === 1)) {
    return `mc goto_near ${target.position.x} ${target.position.y} ${target.position.z}`;
  }
  if ((role.includes('builder') || role.includes('planner')) && tick % 5 === 3) {
    if (planks) return `mc place_fill ${planks[0]} ${yard.x} ${Math.floor(pos.y) - 1} ${yard.z} ${yard.x + 2} ${Math.floor(pos.y)} ${yard.z + 2} hollow`;
    if (craftable) return `mc craft ${craftable}`;
  }
  const choices = role.includes('farmer') ? ['grass_block', 'dirt']
    : role.includes('miner') ? ['stone', 'deepslate', 'diorite']
    : ['oak_log', 'jungle_log', 'birch_log', 'cherry_log'];
  const chosen = choices.find((name) => visible.includes(name));
  if (!chosen && !target?.position) return 'mc look';
  if (!chosen && target?.position) return `mc goto_near ${target.position.x} ${target.position.y} ${target.position.z}`;
  const batchSize = role.includes('miner') ? 12 : role.includes('farmer') ? 8 : 6;
  return `mc collect ${chosen || choices[0]} ${batchSize}`;
}

function shouldRunBackgroundWork(entry) {
  return entry.pending && !entry.activity_pending;
}

function queuedFallbackAction(minion, statusJson, lastAction, tick, queueDepth) {
  return queueDepth > 0 ? fallbackAction(minion, statusJson, lastAction, tick) : '';
}

function nudgeSafety(statusJson) {
  try {
    const data = JSON.parse(statusJson).data || {};
    const health = Number(data.health ?? 0);
    const food = Number(data.food ?? 0);
    if (health < 12) return { ok: false, reason: `health ${health}/20 is below the 12/20 recovery threshold` };
    if (food < 10) return { ok: false, reason: `food ${food}/20 is below the 10/20 recovery threshold` };
    return { ok: true, health, food, isDay: data.isDay === true };
  } catch { return { ok: false, reason: 'status observation was invalid' }; }
}

function recoveryAfterFailedAction(minion, statusJson, attemptedAction, errorMessage, tick) {
  if (/^mc sleep\b/.test(attemptedAction || '') && /No bed within 4 blocks/i.test(errorMessage || '')) {
    return 'mc goto_near 50 63 77';
  }
  // Follow fails when the player is out of entity range (unloaded). Walk to
  // their last shared-eyes sighting first, then follow once close.
  const followMatch = (attemptedAction || '').match(/^mc follow (.+)/);
  if (followMatch && /not found nearby/i.test(errorMessage || '')) {
    const sighting = playerSightings.get(followMatch[1].trim());
    if (sighting && Date.now() - sighting.at <= 300000) {
      return `mc bg_goto ${sighting.x} ${sighting.y} ${sighting.z}`;
    }
    return '';
  }
  if (!/^mc collect\b/.test(attemptedAction) || !/can't see|not visible/i.test(errorMessage)) return '';
  return fallbackAction(minion, statusJson, errorMessage, tick);
}

// Different bots may act together. Commands for one bot must not overlap: a
// second navigation command otherwise cancels the first with "goal changed".
function shouldDeferToRunningTask(args, task) {
  if (task?.status !== 'running') return false;
  const action = Array.isArray(args) ? args[0] : '';
  return new Set(['bg_goto', 'goto', 'goto_near', 'follow', 'collect', 'fight', 'flee', 'dig', 'pickup', 'place', 'place_fill', 'till', 'sow', 'harvest', 'craft', 'smelt', 'eat']).has(action);
}

async function runMinionAction(entry, args, apiUrl) {
  while (entry.action_busy) await new Promise((resolve) => setTimeout(resolve, 50));
  entry.action_busy = true;
  // Shadow-mode audit: record what the deterministic pipeline WOULD have
  // decided about this action. Observe-only — never gates or alters it.
  // Any audit failure is swallowed so it cannot break a live tick.
  try {
    const audit = auditAction({
      bot: entry.name, actionArgs: args,
      vitals: entry.safetyVitals || {},
      house: { ...HOUSE, radius: HOUSE_SAFE_RADIUS },
    });
    shadowJournal.recordShadow({
      source: audit.bot, action: audit.action, verdict: audit.verdict,
      reasons: [...audit.reasons], recoveryAction: audit.recoveryAction,
    });
  } catch {}
  try {
    try {
      const taskRes = await fetch(`${apiUrl}/task`, { signal: AbortSignal.timeout(3000) });
      const taskJson = await taskRes.json();
      const task = taskJson.data?.task;
      if (shouldDeferToRunningTask(args, task)) return `deferred: ${task.action} is already running`;
    } catch {}
    const out = await callMc(args, apiUrl);
    // Navigation commands are launched as Mineflayer tasks and return before
    // their pathfinder is finished. Hold this bot's slot until that task has
    // stopped, so a later controller turn cannot replace its goal.
    if (['goto', 'goto_near'].includes(args[0])) {
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        const taskRes = await fetch(`${apiUrl}/task`);
        const taskJson = await taskRes.json();
        const task = taskJson.data?.task;
        if (!task || !['running'].includes(task.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return out;
  } finally { entry.action_busy = false; }
}

async function tick(minion) {
  const entry = state.get(minion.name);
  if (entry.pending) return;
  if (pausedBots.has(minion.name)) { entry.last_action = 'paused from Mission Control — standing by'; return; }
  entry.pending = true;
  try {
    const apiUrl = minion.api_url || DEFAULT_MC_API;
    let status = await callMc(['status', '--json'], apiUrl);
    // /status carries world data; /task carries transient safety state (water,
    // task errors, queue). Merge the latter before deciding anything so a
    // submerged bot cannot be sent back to collect or navigate.
    try {
      const taskRes = await fetch(`${apiUrl}/task`, { signal: AbortSignal.timeout(3000) });
      const taskJson = await taskRes.json();
      const safetyState = taskJson.state || {};
      if (safetyState.hazard || safetyState.task_error || safetyState.task_done) {
        const parsed = JSON.parse(status);
        parsed.data = { ...(parsed.data || {}), ...safetyState };
        status = JSON.stringify(parsed);
      }
    } catch {}
    try {
      const sd = JSON.parse(status).data || {};
      entry.safetyVitals = { health: sd.health, food: sd.food };
    } catch { entry.safetyVitals = {}; }
    updateVillageCenter(minion, status);
    updatePlayerSightings(playerSightings, minion.name, status);
    if (stuckNudge(entry, status) === 'STUCK') {
      try { await fetch(`${apiUrl}/task/cancel`, { method: 'POST' }); } catch {}
      try {
        const out = await runMinionAction(entry, ['look'], apiUrl);
        entry.last_action = `stuck reset | task cancelled, looked around -> ${out.slice(0, 120)}`;
      } catch (err) { entry.last_action = `stuck reset | task cancelled -> ${err.message.slice(0, 120)}`; }
    }
    const botNames = landfolkKnownNames();
    // The raw read_chat API retains old entries forever. Feed the model only
    // current human messages; controller teamChat remains its bot coordination feed.
    // Web-UI injections join the same flow (targeted DMs only reach their bot).
    const freshHumanMessages = [...takeInjectedHuman(minion.name), ...humanMessages(status, botNames)];
    const chat = freshHumanMessages.map((m) => `<${m.from}> ${m.message}`).join('\n') || '(no new player chat)';
    const human = freshHumanMessages.find((m) => canClaimHumanMessage(minion.name, m.message, botNames) && rememberHumanMessage(minion.name, m));
    if (human) {
      const named = namedMinions(human.message, botNames);
      const teamRequest = named.length > 0
        ? `Human request to ${named.join('+')}, handled by ${minion.name}: ${human.message}`
        : `Human question to ALL, answered by ${minion.name}: ${human.message}`;
      rememberTeamChat('PLAN', teamRequest);
      const directAction = directRequestAction(human.message, human.from);
      if (directAction) {
        // Say it OUT LOUD (first claimer; replies bypass cooldowns) + whisper.
        const doing = plainDoing(minion, status, directAction);
        const reply = `${minion.name}: ${doing} — on it!`;
        try { await callMc(['chat_to', human.from, reply], apiUrl); rememberTeamChat(minion.name, `to ${human.from}: ${reply}`); } catch {}
        if (claimPublicReply(human.from, human.message)) {
          try { await callMc(['chat', reply], apiUrl); rememberTeamChat(minion.name, reply); markPublicChat(minion.name); } catch {}
        }
        try {
          const out = await runMinionAction(entry, parseCommand(directAction).slice(1), apiUrl);
          entry.ticks += 1;
          entry.last_action = `human request | ${directAction} -> ${out.slice(0, 160)}`;
        } catch (err) {
          entry.last_action = `human request | ${directAction} -> ERROR ${err.message}`;
          // Follow-failover: player out of range → walk to last sighting instead.
          const failover = recoveryAfterFailedAction(minion, status, directAction, err.message, entry.ticks);
          if (failover) {
            try {
              const out = await runMinionAction(entry, parseCommand(failover).slice(1), apiUrl);
              entry.ticks += 1;
              entry.last_action = `human request | ${directAction} -> ERROR ${err.message} | failover ${failover} -> ${out.slice(0, 120)}`;
              const coming = `${minion.name}: Can't see you from here — heading to where you were last spotted.`;
              try { await callMc(['chat_to', human.from, coming], apiUrl); } catch {}
              return;
            } catch {}
          }
          const failure = `${minion.name}: I tried that, but ${err.message.slice(0, 100)}.`;
          try { await callMc(['chat_to', human.from, failure], apiUrl); } catch {}
        }
        return;
      }
      const stock = inventoryStatusReply(minion, status, human.message);
      if (stock) {
        // Whisper only — no public echo. That restores the old whisper behavior.
        try { await callMc(['chat_to', human.from, stock], apiUrl); rememberTeamChat(minion.name, `to ${human.from}: ${stock}`); } catch {}
        entry.last_action = `human request | inventory whisper -> ${stock.slice(0, 160)}`;
      } else {
        // Guaranteed answer, in plain words. First claimer says it OUT LOUD
        // (replies bypass cooldowns); everyone else whispers so nothing echoes.
        const doing = plainDoing(minion, status, entry.last_action);
        const ack = `${minion.name}: heard you — ${doing}.`;
        try { await callMc(['chat_to', human.from, ack], apiUrl); rememberTeamChat(minion.name, `to ${human.from}: ${ack}`); } catch {}
        entry.last_action = `human request | whisper ack -> ${ack.slice(0, 160)}`;
        if (claimPublicReply(human.from, human.message)) {
          try { await callMc(['chat', ack], apiUrl); rememberTeamChat(minion.name, ack); markPublicChat(minion.name); } catch {}
        }
        // One public progress note per team per 15s, per bot per 120s. Otherwise stay silent and work.
        else if (canPublicChat(minion.name)) {
          const summary = progressSummary(minion, status, entry.last_action);
          const reply = `${minion.name}: on it — ${summary}.`;
          try { await callMc(['chat', reply], apiUrl); rememberTeamChat(minion.name, reply); markPublicChat(minion.name); } catch {}
        }
      }
    }
    const urgent = survivalAction(status, entry.last_action);
    if (urgent) {
      try {
        const out = await runMinionAction(entry, parseCommand(urgent).slice(1), apiUrl);
        entry.ticks += 1;
        entry.last_action = `${urgent} -> ${out.slice(0, 180)} | priority survival`;
      } catch (err) { entry.last_action = `${urgent} -> ERROR ${err.message} | priority survival`; }
      return;
    }
    const queuedAction = queuedFallbackAction(minion, status, entry.last_action, entry.ticks + 1, lmsQueueDepth);
    if (queuedAction) {
      try {
        const out = await runMinionAction(entry, parseCommand(queuedAction).slice(1), apiUrl);
        entry.last_action = `queued inference | ${queuedAction} -> ${out.slice(0, 120)}`;
      } catch (err) {
        entry.last_action = `queued inference | ${queuedAction} -> ERROR ${err.message}`;
      }
    }
    const team = teamChat.slice(-10).map((m) => `<${m.from}> ${m.message}`).join('\n') || '(no controller team messages yet)';
    const center = villageCenter ? `${villageCenter.x}, ${villageCenter.y}, ${villageCenter.z}` : 'not established yet';
    const sightings = playerSightingLine(playerSightings);
    const observation = `VILLAGE CENTER (stay within about 16 blocks unless scouting): ${center}\n${sightings ? sightings + '\n' : ''}\nSTATUS:\n${status}\n\nCHAT:\n${chat}\n\nTEAM CHAT (reliable controller feed):\n${team}\n\nLAST ACTION: ${entry.last_action}`;
    entry.last_observation = observation;
    entry.ticks += 1;
    const reply = await lmsComplete(minion.model, observation, minion.name, minion.role);
    const think = (reply.match(/THINK:\s*(.+)/) || [, ''])[1].trim();
    let act = (reply.match(/ACT:\s*(.+)/) || [, ''])[1].trim();
    if (!act || act.toUpperCase() === 'NONE') act = coordinatedAction(minion, status, entry.last_action, entry.ticks);
    let tokens = parseCommand(act);
    if (tokens[0] !== 'mc') act = coordinatedAction(minion, status, entry.last_action, entry.ticks);
    tokens = parseCommand(act);
    const nonGameplay = ['chat', 'chat_to', 'wait', 'scene', 'look', 'status', 'nearby', 'map', 'read_chat', 'inventory', 'recipes', 'find_blocks', 'find_entities'];
    if (nonGameplay.includes(tokens[1])) {
      try {
        const out = await callMc(tokens.slice(1), apiUrl);
        if (tokens[1] === 'chat') rememberTeamChat(minion.name, tokens.slice(2).join(' '));
        if (tokens[1] === 'chat_to') rememberTeamChat(minion.name, `to ${tokens[2]}: ${tokens.slice(3).join(' ')}`);
        entry.last_action = `${think || ''} | ${act} -> ${out.slice(0, 120)}`;
      } catch (err) {
        entry.last_action = `${act} -> ERROR ${err.message}`;
      }
      act = coordinatedAction(minion, status, entry.last_action, entry.ticks);
      tokens = parseCommand(act);
    }
    if (tokens[0] !== 'mc') {
      entry.last_action = `rejected: ${act}`;
      return;
    }
    try {
      const out = await runMinionAction(entry, tokens.slice(1), apiUrl);
      entry.last_action = `${think || ''} | ${act} -> ${out.slice(0, 120)}`;
    } catch (err) {
      const recovery = recoveryAfterFailedAction(minion, status, act, err.message, entry.ticks);
      if (recovery) {
        try {
          const out = await runMinionAction(entry, parseCommand(recovery).slice(1), apiUrl);
          entry.last_action = `${act} -> ERROR ${err.message} | recovery ${recovery} -> ${out.slice(0, 120)}`;
        } catch (recoveryErr) {
          entry.last_action = `${act} -> ERROR ${err.message} | recovery ${recovery} -> ERROR ${recoveryErr.message}`;
        }
      } else {
        entry.last_action = `${act} -> ERROR ${err.message}`;
      }
    }
    if (entry.ticks % 6 === 0 && canPublicChat(minion.name, 180000, 30000)) {
      const update = progressSummary(minion, status, entry.last_action);
      try {
        await callMc(['chat', update], apiUrl);
        rememberTeamChat(minion.name, update);
        markPublicChat(minion.name);
        entry.last_action += ' | chat update sent';
      } catch (err) {
        entry.last_action += ` | chat update failed: ${err.message}`;
      }
    }
  } catch (err) {
    entry.last_action = `turn error: ${err.message}`;
  } finally {
    entry.pending = false;
  }
}

async function backgroundWork(minion) {
  const entry = state.get(minion.name);
  if (!shouldRunBackgroundWork(entry)) return;
  if (pausedBots.has(minion.name)) return;
  entry.activity_pending = true;
  try {
    const apiUrl = minion.api_url || DEFAULT_MC_API;
    const status = await callMc(['status', '--json'], apiUrl);
    updateVillageCenter(minion, status);
    const action = survivalAction(status) || coordinatedAction(minion, status, entry.last_action, entry.ticks + 1);
    if (!action) return;
    const out = await runMinionAction(entry, parseCommand(action).slice(1), apiUrl);
    entry.last_action = `background work | ${action} -> ${out.slice(0, 120)}`;
  } catch (err) {
    entry.last_action = `background work error: ${err.message}`;
  } finally {
    entry.activity_pending = false;
  }
}

for (const m of minions) {
  const loop = async () => {
    while (true) {
      await tick(m);
      await new Promise((r) => setTimeout(r, m.interval_ms || 7000));
    }
  };
  loop().catch((err) => console.error(`${m.name} crashed`, err.message));
  setInterval(() => backgroundWork(m).catch((err) => console.error(`${m.name} background error`, err.message)), 8000);
}

const server = http.createServer((req, res) => {
  const readJsonBody = (limit = 4000) => new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > limit) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(new Error('bad json')); } });
  });
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  // Village goal: GET returns it, POST sets it live (prompt reads it every tick).
  if (req.url === '/goal') {
    if (req.method === 'GET') return send(200, { ok: true, goal: villageGoal });
    if (req.method === 'POST') {
      readJsonBody().then((body) => {
        if (!body.goal || String(body.goal).trim().length < 10) return send(400, { ok: false, error: 'goal too short (min 10 chars)' });
        send(200, { ok: true, goal: setVillageGoal(body.goal, body.from || 'Duckets (web)') });
      }).catch((e) => send(400, { ok: false, error: e.message }));
      return;
    }
  }
  // Pause/resume one bot: POST /pause {"name":"Moss","paused":true}
  if (req.method === 'POST' && req.url === '/pause') {
    readJsonBody().then((body) => {
      if (!minions.some((m) => m.name === body.name)) return send(400, { ok: false, error: 'unknown bot' });
      if (body.paused) { pausedBots.add(body.name); rememberTeamChat('PLAN', `${body.name} paused from Mission Control — standing by.`); }
      else { pausedBots.delete(body.name); rememberTeamChat('PLAN', `${body.name} resumed — back to the mission.`); }
      send(200, { ok: true, name: body.name, paused: pausedBots.has(body.name) });
    }).catch((e) => send(400, { ok: false, error: e.message }));
    return;
  }
  // Safe activity nudge: observe first, clear one stale task, then resume only
  // Landfolk whose current vitals are safe. This is deliberately not a blind
  // fleet-wide movement loop.
  if (req.method === 'POST' && req.url === '/nudge') {
    readJsonBody().then(async (body) => {
      const names = body.name ? [String(body.name)] : minions.map((m) => m.name);
      if (names.some((name) => !minions.some((m) => m.name === name))) return send(400, { ok: false, error: 'unknown bot' });
      const receipts = [];
      for (const name of names) {
        const minion = minions.find((m) => m.name === name);
        const entry = state.get(name);
        const apiUrl = minion.api_url || DEFAULT_MC_API;
        try {
          const before = await callMc(['status', '--json'], apiUrl);
          const safety = nudgeSafety(before);
          if (!safety.ok) {
            pausedBots.add(name);
            entry.last_action = `nudge blocked | ${safety.reason}`;
            receipts.push({ name, ok: false, state: 'recovery-required', reason: safety.reason });
            continue;
          }
          try { await fetch(`${apiUrl}/task/cancel`, { method: 'POST' }); } catch {}
          // `/status` already includes a bounded scene snapshot. Do not issue a
          // concurrent `look` action here: a body can still be releasing a
          // prior pathfinder command, and competing observations would block.
          const observation = before;
          const after = await callMc(['status', '--json'], apiUrl);
          pausedBots.delete(name);
          const action = safety.isDay
            ? coordinatedAction(minion, after, entry.last_action, entry.ticks + 1)
            : 'mc goto_near 50 63 77';
          if (action) {
            const out = await runMinionAction(entry, parseCommand(action).slice(1), apiUrl);
            entry.last_action = `nudge | observation refreshed; ${action} -> ${out.slice(0, 120)}`;
          } else {
            entry.last_action = `nudge | observation refreshed; waiting for next assigned village action`;
          }
          rememberTeamChat('PLAN', `${name} safely nudged from Mission Control: ${entry.last_action}`);
          receipts.push({ name, ok: true, state: 'active', safety, observation: String(observation).slice(0, 120), action: entry.last_action });
        } catch (err) {
          entry.last_action = `nudge failed | ${err.message}`;
          receipts.push({ name, ok: false, state: 'error', reason: err.message });
        }
      }
      send(200, { ok: receipts.some((r) => r.ok), receipts });
    }).catch((e) => send(400, { ok: false, error: e.message }));
    return;
  }
  // Think pace: POST /interval {"name":"Moss","interval_ms":60000} (10s–300s)
  if (req.method === 'POST' && req.url === '/interval') {
    readJsonBody().then((body) => {
      const m = minions.find((x) => x.name === body.name);
      if (!m) return send(400, { ok: false, error: 'unknown bot' });
      const ms = Math.max(10000, Math.min(300000, Number(body.interval_ms) || m.interval_ms));
      m.interval_ms = ms;
      send(200, { ok: true, name: m.name, interval_ms: ms });
    }).catch((e) => send(400, { ok: false, error: e.message }));
    return;
  }
  // Change one controller bot's model live. Validate against LM Studio first.
  if (req.method === 'POST' && req.url === '/model') {
    readJsonBody().then(async (body) => {
      const m = minions.find((x) => x.name === body.name);
      const model = String(body.model || '').trim();
      if (!m || !model) return send(400, { ok: false, error: 'unknown bot or missing model' });
      const mr = await fetch(`${LMS_URL}/models`, { headers: LMS_HEADERS, signal: AbortSignal.timeout(5000) });
      const models = (await mr.json()).data || [];
      if (!models.some((x) => x.id === model)) return send(400, { ok: false, error: 'model is not currently exposed by LM Studio' });
      m.model = model;
      rememberTeamChat('PLAN', `${m.name} model changed to ${model} from Mission Control.`);
      send(200, { ok: true, name: m.name, model });
    }).catch((e) => send(400, { ok: false, error: e.message }));
    return;
  }
  // Team radio: recent controller feed (plans, claims, acks) for Mission Control.
  if (req.method === 'GET' && req.url === '/team') {
    return send(200, { ok: true, messages: teamChat.slice(-30) });
  }
  // Observe-only intelligence ledger. Proposals are validated and audited here,
  // never converted to mc commands or queue actions by this endpoint.
  if (req.method === 'GET' && req.url === '/intelligence') {
    return send(200, {
      ok: true,
      mode: INTELLIGENCE_MODE,
      canaryBot: INTELLIGENCE_CANARY || null,
      dispatchEnabled: false,
      records: [...intelligenceJournal.list(), ...shadowJournal.list()],
    });
  }
  if (req.method === 'POST' && req.url === '/intelligence/proposal') {
    readJsonBody(12000).then((body) => {
      const source = String(body.source || '').trim();
      const knownActors = new Set([...minions.map((m) => m.name), 'DuckBot']);
      if (!knownActors.has(source)) return send(400, { ok: false, error: 'unknown source actor' });
      if (typeof body.content !== 'string') return send(400, { ok: false, error: 'missing proposal content' });
      const record = intelligenceJournal.recordModelOutput({
        source,
        content: body.content,
        mode: INTELLIGENCE_MODE,
        policy: { house: { ...HOUSE, radius: HOUSE_SAFE_RADIUS }, canaryBot: INTELLIGENCE_CANARY },
      });
      return send(record.status === 'accepted' ? 200 : 400, {
        ok: record.status === 'accepted',
        mode: INTELLIGENCE_MODE,
        dispatchEnabled: false,
        record,
      });
    }).catch((e) => send(400, { ok: false, error: e.message }));
    return;
  }
  if (req.method === 'POST' && req.url === '/say') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4000) req.destroy(); });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        if (!body.message) throw new Error('missing message');
        const from = String(body.from || 'Duckets (web)').slice(0, 40);
        const target = String(body.target || '').slice(0, 20);
        if (target && !minions.some((m) => m.name === target)) throw new Error(`unknown bot "${target}"`);
        injectHumanMessage(from, String(body.message).slice(0, 500), target);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, queued: true, target: target || 'all' }));
      } catch (err) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }
  if (req.url === '/' || req.url === '/health') {
    const body = {
      ok: true,
      lms_url: LMS_URL,
      goal: villageGoal,
      paused: [...pausedBots],
      minion_count: minions.length,
      minions: Array.from(state.entries()).map(([name, e]) => ({
        name,
        model: minions.find((m) => m.name === name).model,
        role: minions.find((m) => m.name === name).role || '',
        interval_ms: minions.find((m) => m.name === name).interval_ms,
        paused: pausedBots.has(name),
        ticks: e.ticks,
        pending: e.pending,
        last_action: e.last_action,
      })),
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body, null, 2));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
server.listen(BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`HermesCraft Minion Controller`);
  console.log(`   minions : ${minions.map((m) => m.name).join(', ')}`);
  console.log(`   lms url : ${LMS_URL}`);
  console.log(`   http    : http://127.0.0.1:${BRIDGE_PORT}/`);
});