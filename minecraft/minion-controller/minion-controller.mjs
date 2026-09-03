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
let lmsTail = Promise.resolve();
const teamChat = [];
const handledHumanChat = new Map();

const PROMPT_TMPL = (name, role = 'village resident') => `You are ${name}, the ${role}, an AI player in a Minecraft world.

MISSION: Build a safe starter village with the other players. Follow this loop forever: assess threats and health; answer human and team chat; scout a safe flat site; gather the resources your role needs; craft useful tools, food, torches and building materials; construct a small house, farm, path, storage area or defenses; light the area; report exactly what you did; then choose the next task. Never stand still just because the scene is unfamiliar.

DETAILED GAMEPLAY: Minecraft is a survival game. Look around, move deliberately, collect drops, use crafting recipes, make tools before mining, eat when hungry, avoid falls and hostile mobs, sleep or shelter at night, and return to the village area after scouting. Builders gather logs, convert logs to planks, and place walls/floors/roofs. Farmers gather grass/seeds and food, plant and harvest crops, and share food. Miners gather stone, coal, iron and useful ores and report locations. Scouts check terrain and danger, escort teammates, light paths, and defend the village. Claim tasks in chat so two bots do not duplicate work. Use only materials you possess and never grief existing player builds.

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
2. Answer every new message from the human player or a teammate with a short chat reply before doing the requested work.
3. The village mission has priority. Do not choose \`NONE\` or an observation command as your turn; take a movement, gathering, crafting, building, defense, food, or communication action.
4. Communication is required at least every second turn: claim tasks, report discoveries/resources, request supplies, warn of danger, and report completed work.
5. Follow the gameplay loop: observe once, decide, act, verify the result, then continue. Never loop observations or stand still.
6. Do not destroy other players' builds or steal from chests.
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
  const run = lmsTail.then(() => lmsCompleteUnlocked(model, observation, name, role));
  lmsTail = run.catch(() => {});
  return run;
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
  state.set(m.name, { last_observation: '', last_action: 'NONE — initialized', pending: false, ticks: 0 });
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
  if ((d.health || 0) < 10) return food ? 'mc eat' : 'mc flee 20';
  if (hostile && hostile.distance <= 18) return (d.health || 0) >= 14 ? `mc fight ${hostile.type}` : 'mc flee 20';
  return '';
}

function humanMessages(statusJson) {
  let d = {};
  try { d = JSON.parse(statusJson).data || {}; } catch {}
  return (d.unreadChat || []).filter((m) => /ducket/i.test(m.from || ''));
}

function rememberHumanMessage(botName, message) {
  const key = `${botName}:${message.from}:${message.message}`;
  if (handledHumanChat.has(key)) return false;
  handledHumanChat.set(key, Date.now());
  while (handledHumanChat.size > 100) handledHumanChat.delete(handledHumanChat.keys().next().value);
  return true;
}
function fallbackAction(minion, statusJson, lastAction = '', tick = 0) {
  let parsed = {};
  try { parsed = JSON.parse(statusJson); } catch {}
  const data = parsed.data || {};
  const hits = data.scene?.visible_block_hits || [];
  const visible = hits.map((b) => b.name);
  const notable = data.notableBlocks || hits;
  const role = (minion.role || '').toLowerCase();
  const pos = data.position || { x: 0, y: 70, z: 0 };
  const inv = Object.fromEntries((data.inventory || []).map((i) => [i.name, i.count]));
  const logs = Object.entries(inv).find(([n, c]) => (n.endsWith('_log') || n.endsWith('_wood')) && c > 0);
  const woodType = logs?.[0]?.replace(/_(log|wood)$/, '');
  const craftable = woodType ? `${woodType}_planks` : null;
  const planks = Object.entries(inv).find(([n, c]) => n.endsWith('_planks') && c >= 4);
  const wanted = role.includes('farmer') ? ['grass_block', 'dirt']
    : role.includes('miner') ? ['stone', 'deepslate', 'diorite']
    : ['oak_log', 'jungle_log', 'birch_log', 'cherry_log'];
  const target = notable.find((b) => wanted.includes(b.name)) || notable[0];
  if (target?.position && (/can't see|not visible/i.test(lastAction) || tick % 5 === 1)) {
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
  return `mc collect ${chosen || choices[0]} 2`;
}

async function tick(minion) {
  const entry = state.get(minion.name);
  if (entry.pending) return;
  entry.pending = true;
  try {
    const apiUrl = minion.api_url || DEFAULT_MC_API;
    const status = await callMc(['status', '--json'], apiUrl);
    const chat = await callMc(['read_chat', '5'], apiUrl);
    const human = humanMessages(status).find((m) => rememberHumanMessage(minion.name, m));
    if (human) {
      const reply = /kill|enemy|mob|defend|attack/i.test(human.message)
        ? `${minion.name}: I hear you. I am assessing threats and defending the village now.`
        : `${minion.name}: I hear you. I will handle that and report back in chat.`;
      try { await callMc(['chat', reply], apiUrl); rememberTeamChat(minion.name, reply); } catch {}
    }
    const urgent = survivalAction(status);
    if (urgent) {
      try {
        const out = await callMc(parseCommand(urgent).slice(1), apiUrl);
        entry.ticks += 1;
        entry.last_action = `${urgent} -> ${out.slice(0, 180)} | priority survival`;
      } catch (err) { entry.last_action = `${urgent} -> ERROR ${err.message} | priority survival`; }
      return;
    }
    const team = teamChat.slice(-10).map((m) => `<${m.from}> ${m.message}`).join('\n') || '(no controller team messages yet)';
    const observation = `STATUS:\n${status}\n\nCHAT:\n${chat}\n\nTEAM CHAT (reliable controller feed):\n${team}\n\nLAST ACTION: ${entry.last_action}`;
    entry.last_observation = observation;
    entry.ticks += 1;
    const reply = await lmsComplete(minion.model, observation, minion.name, minion.role);
    const think = (reply.match(/THINK:\s*(.+)/) || [, ''])[1].trim();
    let act = (reply.match(/ACT:\s*(.+)/) || [, ''])[1].trim();
    if (!act || act.toUpperCase() === 'NONE') act = fallbackAction(minion, status, entry.last_action, entry.ticks);
    let tokens = parseCommand(act);
    if (tokens[0] !== 'mc') act = fallbackAction(minion, status, entry.last_action, entry.ticks);
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
      act = fallbackAction(minion, status, entry.last_action, entry.ticks);
      tokens = parseCommand(act);
    }
    if (tokens[0] !== 'mc') {
      entry.last_action = `rejected: ${act}`;
      return;
    }
    try {
      const out = await callMc(tokens.slice(1), apiUrl);
      entry.last_action = `${think || ''} | ${act} -> ${out.slice(0, 120)}`;
    } catch (err) {
      entry.last_action = `${act} -> ERROR ${err.message}`;
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

for (const m of minions) {
  const loop = async () => {
    while (true) {
      await tick(m);
      await new Promise((r) => setTimeout(r, m.interval_ms || 7000));
    }
  };
  loop().catch((err) => console.error(`${m.name} crashed`, err.message));
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