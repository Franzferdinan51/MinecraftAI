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
// Parallel model calls allowed per user 2026-09-03: all minions think at once.
// lmsQueueDepth is kept only for health visibility / queued fallback prefix.
let lmsQueueDepth = 0;
const teamChat = [];
let villageCenter = null;
const handledHumanChat = new Map();

const PROMPT_TMPL = (name, role = 'village resident') => `You are ${name}, the ${role}, an AI player in a Minecraft world.

MISSION: Build a safe starter village with the other players. Follow this loop forever: assess threats and health; answer human and team chat; scout a safe flat site; gather the resources your role needs; craft useful tools, food, torches and building materials; construct a small house, farm, path, storage area or defenses; light the area; report exactly what you did; then choose the next task. Never stand still just because the scene is unfamiliar.

DETAILED GAMEPLAY: Minecraft is a survival game. Look around, move deliberately, collect drops, use crafting recipes, make tools before mining, eat when hungry, avoid falls and hostile mobs, sleep or shelter at night, and return to the village area after scouting. Builders gather logs, convert logs to planks, and place walls/floors/roofs. Farmers gather grass/seeds and food, plant and harvest crops, and share food. Miners gather stone, coal, iron and useful ores and report locations. Scouts check terrain and danger, escort teammates, light paths, and defend the village. Claim tasks in chat so two bots do not duplicate work. Use only materials you possess and never grief existing player builds.

ACTION PRIORITIES: (1) When a hostile is close, equip the best weapon available, fight if healthy, or flee and warn the team if injured. (2) When safe, eat if hungry; craft planks from logs, then crafting tools, weapons, food and torches when materials permit. (3) Builders must turn planks into an actual shelter, paths, storage or defensive walls, not just carry resources. (4) Farmers keep food and seeds available. (5) Miners supply stone/ores. (6) Scouts light and defend routes. After every completed action, report useful results and choose the next physical task—never remain idle.

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
  mc sleep
  mc wait N

Rules:
1. SURVIVAL OVERRIDES EVERYTHING: if a hostile mob is close, fight it when healthy and equipped, otherwise flee; if health is low, eat or flee to safety; never continue gathering while being attacked.
2. PROTECT PLAYER BUILDS — fences, walls, paths, crops, chests, doors, torches, and decorations that any player placed are theirs. Do NOT dig, break, or replace them. Do not walk through fences or crops. If your move or build target would overlap an existing player block, choose a different position. Never run \`mc dig\` or \`mc collect\` against a block another player placed.
3. Treat every \`Human request ... assigned to NAME\` message in TEAM CHAT as a shared team plan. If NAME is you, acknowledge it in chat and make your next physical action advance that request; if another teammate is assigned, choose a supporting task and report what you can contribute.
4. The village mission has priority. Do not choose \`NONE\` or an observation command as your turn; take a movement, gathering, crafting, building, defense, food, or communication action.
5. Communication is required at least every second turn: claim tasks, report discoveries/resources, request supplies, warn of danger, and report completed work.
6. Follow the gameplay loop: observe once, decide, act, verify the result, then continue. Never loop observations or stand still.
7. Be brief. THINK in one sentence, ACT in one line.`;

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
  state.set(m.name, { last_observation: '', last_action: 'NONE — initialized', pending: false, activity_pending: false, action_busy: false, ticks: 0 });
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

function survivalAction(statusJson) {
  let d = {};
  try { d = JSON.parse(statusJson).data || {}; } catch {}
  const hostile = (d.nearbyEntities || []).find((e) => e.kind === 'hostile');
  const food = (d.inventory || []).some((i) => /bread|apple|carrot|potato|beef|pork|chicken|mutton|fish|stew/i.test(i.name) && i.count > 0);
  if (hostile && hostile.distance <= 10 && (d.health || 0) >= 10) return `mc fight ${hostile.type}`;
  if ((d.health || 0) < 10 && food) return 'mc eat';
  if (hostile && hostile.distance <= 18) return (d.health || 0) >= 14 ? `mc fight ${hostile.type}` : 'mc flee 20';
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
    // restart, while allowing a full model-turn window for new messages.
    return Number.isNaN(age) || age <= 300;
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
  if (/\b(run|flee|retreat)\b/.test(text)) return 'mc flee 20';
  if (/\b(make|craft)\b.*\bsword\b|\bsword\b/.test(text)) return 'mc craft wooden_sword';
  if (/\b(kill|attack|fight)\b.*\b(zombie|skeleton|creeper|spider)\b/.test(text)) {
    const mob = (text.match(/\b(zombie|skeleton|creeper|spider)\b/) || [])[1];
    return mob ? `mc fight ${mob}` : '';
  }
  return '';
}

function rememberHumanMessage(message) {
  const key = `${message.from}:${message.message}`;
  if (handledHumanChat.has(key)) return false;
  handledHumanChat.set(key, Date.now());
  while (handledHumanChat.size > 100) handledHumanChat.delete(handledHumanChat.keys().next().value);
  return true;
}
function updateVillageCenter(minion, statusJson) {
  if (minion.name !== 'Steve') return;
  try {
    const pos = JSON.parse(statusJson).data?.position;
    if (pos) villageCenter = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
  } catch {}
}

function regroupAction(minion, statusJson, center) {
  if (!center || minion.name === 'Steve') return '';
  try {
    const pos = JSON.parse(statusJson).data?.position;
    if (!pos) return '';
    const distance = Math.hypot(pos.x - center.x, pos.y - center.y, pos.z - center.z);
    if (distance > 16) return `mc goto_near ${center.x} ${center.y} ${center.z}`;
  } catch {}
  return '';
}

function coordinatedAction(minion, statusJson, lastAction, tick) {
  return regroupAction(minion, statusJson, villageCenter) || fallbackAction(minion, statusJson, lastAction, tick);
}

function fallbackAction(minion, statusJson, lastAction = '', tick = 0) {
  let parsed = {};
  try { parsed = JSON.parse(statusJson); } catch {}
  const data = parsed.data || {};
  const hits = data.scene?.visible_block_hits || [];
  const visible = hits.map((b) => b.name);
  const known = data.notableBlocks || [];
  const recovery = /can't see|not visible/i.test(lastAction);
  const targets = recovery && hits.length > 0 ? hits : (known.length > 0 ? known : hits);
  const role = (minion.role || '').toLowerCase();
  const pos = data.position || { x: 0, y: 70, z: 0 };
  const inv = Object.fromEntries((data.inventory || []).map((i) => [i.name, i.count]));
  // Stripped logs/wood are not valid plank ingredients in this server build.
  // Treat them as salvage, then gather fresh normal logs rather than retrying
  // an impossible craft forever.
  const logs = Object.entries(inv).find(([n, c]) => !n.startsWith('stripped_') && (n.endsWith('_log') || n.endsWith('_wood')) && c > 0);
  const woodType = logs?.[0]?.replace(/_(log|wood)$/, '');
  const craftable = woodType ? `${woodType}_planks` : null;
  const planks = Object.entries(inv).find(([n, c]) => n.endsWith('_planks') && c >= 4);
  const builder = role.includes('builder') || role.includes('planner');
  if (builder && planks) {
    return `mc place_fill ${planks[0]} ${Math.floor(pos.x) + 1} ${Math.floor(pos.y) - 1} ${Math.floor(pos.z) + 1} ${Math.floor(pos.x) + 3} ${Math.floor(pos.y)} ${Math.floor(pos.z) + 3} hollow`;
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
    if (planks) return `mc place_fill ${planks[0]} ${Math.floor(pos.x) + 1} ${Math.floor(pos.y) - 1} ${Math.floor(pos.z) + 1} ${Math.floor(pos.x) + 3} ${Math.floor(pos.y)} ${Math.floor(pos.z) + 3} hollow`;
    if (craftable) return `mc craft ${craftable}`;
  }
  const choices = role.includes('farmer') ? ['grass_block', 'dirt']
    : role.includes('miner') ? ['stone', 'deepslate', 'diorite']
    : ['oak_log', 'jungle_log', 'birch_log', 'cherry_log'];
  const chosen = choices.find((name) => visible.includes(name));
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

function recoveryAfterFailedAction(minion, statusJson, attemptedAction, errorMessage, tick) {
  if (!/^mc collect\b/.test(attemptedAction) || !/can't see|not visible/i.test(errorMessage)) return '';
  return fallbackAction(minion, statusJson, errorMessage, tick);
}

// Different bots may act together. Commands for one bot must not overlap: a
// second navigation command otherwise cancels the first with "goal changed".
async function runMinionAction(entry, args, apiUrl) {
  while (entry.action_busy) await new Promise((resolve) => setTimeout(resolve, 50));
  entry.action_busy = true;
  try {
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
  entry.pending = true;
  try {
    const apiUrl = minion.api_url || DEFAULT_MC_API;
    const status = await callMc(['status', '--json'], apiUrl);
    updateVillageCenter(minion, status);
    const botNames = minions.map((m) => m.name);
    // The raw read_chat API retains old entries forever. Feed the model only
    // current human messages; controller teamChat remains its bot coordination feed.
    const freshHumanMessages = humanMessages(status, botNames);
    const chat = freshHumanMessages.map((m) => `<${m.from}> ${m.message}`).join('\n') || '(no new player chat)';
    const human = freshHumanMessages.find((m) => assignedMinionName(m.message) === minion.name && rememberHumanMessage(m));
    if (human) {
      const teamRequest = `Human request from ${human.from}, assigned to ${minion.name}: ${human.message}`;
      rememberTeamChat('PLAN', teamRequest);
      const directAction = directRequestAction(human.message, human.from);
      if (directAction) {
        const reply = `${minion.name}: Executing your request now: ${directAction.replace(/^mc /, '')}.`;
        // Acknowledge before a long navigation/crafting action so the player
        // gets an immediate, truthful response instead of a delayed silence.
        try { await callMc(['chat', reply], apiUrl); rememberTeamChat(minion.name, reply); } catch {}
        try {
          const out = await runMinionAction(entry, parseCommand(directAction).slice(1), apiUrl);
          entry.ticks += 1;
          entry.last_action = `human request | ${directAction} -> ${out.slice(0, 160)}`;
        } catch (err) {
          entry.last_action = `human request | ${directAction} -> ERROR ${err.message}`;
          const failure = `${minion.name}: I tried that, but ${err.message.slice(0, 100)}.`;
          try { await callMc(['chat', failure], apiUrl); rememberTeamChat(minion.name, failure); } catch {}
        }
        return;
      }
      const reply = `${minion.name}: I received your request and am assigning the team work now.`;
      try { await callMc(['chat', reply], apiUrl); rememberTeamChat(minion.name, reply); } catch {}
    }
    const urgent = survivalAction(status);
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
    const observation = `VILLAGE CENTER (stay within about 16 blocks unless scouting): ${center}\n\nSTATUS:\n${status}\n\nCHAT:\n${chat}\n\nTEAM CHAT (reliable controller feed):\n${team}\n\nLAST ACTION: ${entry.last_action}`;
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
    if (entry.ticks % 2 === 0) {
      const update = `${minion.name}: ${minion.role || 'village resident'} reporting. I am working on the village mission; tell me what you found.`;
      try {
        await callMc(['chat', update], apiUrl);
        rememberTeamChat(minion.name, update);
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
  if (req.url === '/' || req.url === '/health') {
    const body = {
      ok: true,
      lms_url: LMS_URL,
      minion_count: minions.length,
      minions: Array.from(state.entries()).map(([name, e]) => ({
        name,
        model: minions.find((m) => m.name === name).model,
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