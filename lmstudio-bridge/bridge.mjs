#!/usr/bin/env node
/**
 * LM Studio Minecraft Bridge
 *
 * Wraps an LM Studio chat model (e.g. google/gemma-4-26b-a4b-qat) so it can
 * drive the same HermesCraft bot body any other agent can drive. No
 * modifications to the Minecraft server, no Mineflayer code of our own,
 * just an HTTP relay that translates LM Studio chat completions into
 * `mc` calls.
 *
 * Two operating modes:
 *
 *   --mode=alongside   Run *both* Hermes and LM Studio against the same bot
 *                      body. Hermes stays in charge; the LM Studio model
 *                      observes and proposes actions through the bridge
 *                      but does not directly execute. Use this when you
 *                      want a second opinion or a coach model.
 *
 *   --mode=independent Run the LM Studio model as a *separate* bot body
 *                      alongside Hermes. Each gets its own login, its
 *                      own inventory, its own memory. Use this when you
 *                      want two distinct AI agents playing in the same
 *                      world.
 *
 * Run with:
 *   LMS_MODEL=google/gemma-4-26b-a4b-qat node bridge.mjs
 *
 * Environment:
 *   LMS_URL         LM Studio OpenAI-compatible base URL (default: http://127.0.0.1:1234/v1)
 *   LMS_MODEL       Model id (default: google/gemma-4-26b-a4b-qat)
 *   MC_CLI          Path to the `mc` CLI (default: ~/.local/bin/mc)
 *   BRIDGE_PORT     HTTP HTTP port for the bridge inspector (default: 3002)
 *   BRIDGE_MODE     alongside | independent (default: alongside)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { createRequestPolicy } from './request-policy.mjs';

const lmPolicy = createRequestPolicy();

const LMS_URL = (process.env.LMS_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.LMS_MODEL || 'ornith-1.5-9b';
let activeModel = DEFAULT_MODEL;
const LMS_API_KEY = process.env.LMS_API_KEY || '';
const LMS_HEADERS = { 'content-type': 'application/json', ...(LMS_API_KEY ? { authorization: `Bearer ${LMS_API_KEY}` } : {}) };
const MC_CLI = process.env.MC_CLI || `${process.env.HOME}/.local/bin/mc`;
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '3002', 10);
const BRIDGE_MODE = process.env.BRIDGE_MODE || 'alongside';
const BOT_USERNAME = process.env.BOT_USERNAME || 'GemmaBot';
const DECISION_INTERVAL_MS = parseInt(process.env.DECISION_INTERVAL_MS || '6000', 10);

if (!['alongside', 'independent'].includes(BRIDGE_MODE)) {
  console.error(`Unknown mode: ${BRIDGE_MODE}`);
  process.exit(1);
}

const SYSTEM_PROMPT = `You are ${BOT_USERNAME}, an AI player in a Minecraft world.

You observe the world with shell commands and act with shell commands.
Use the literal program \`mc\` for everything. Never use code fences; just
plain text commands.

Format your reply like this and NOTHING else:

THINK: one short sentence about what you noticed.
ACT: a single \`mc\` command with arguments, OR \`NONE\` if no action is
warranted this turn (e.g. you are waiting on a craft, the world is empty,
or the player has not asked for anything).

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
  mc till [n] / mc sow [SEED] [n] / mc harvest (farm loop)
  mc breed cow|sheep|pig|chicken / mc shear / mc milk (ranch loop)
  mc fish [seconds] (rod + open water + sky)
  mc door (open nearest wooden door — NEVER dig through walls) / mc door close
  mc inspect x y z (block name, crop age, door state)
  mc bg_goto x y z (long walks — this action EXISTS, use it)
  mc wait N

Rules:
1. Survival first. If health is below 10, \`mc eat\`. If hostiles are near and you are not on the player, fight when healthy, otherwise flee.
2. After three observations in a row, take an action. Never loop observations.
3. If the player asked for something in chat, do that. Player chat overrides idle plans.
4. PROTECT PLAYER BUILDS — fences, walls, paths, crops, chests, doors, torches and decorations placed by any player are theirs. Do NOT dig, break, or replace them. ENTER THROUGH DOORS ONLY: walk to a door → mc door → mc goto_near past it → mc door close. Digging through a wall/door/fence is griefing and FORBIDDEN, even if pathfinding says "no path" — walk around instead. If your move/build target would overlap an existing player block, pick a different position. Never run \`mc dig\`, \`mc collect\`, or \`mc place\` against a block you did not place yourself in this session.
5. Do not destroy other players' builds. Do not steal from chests.
6. Eat from the farm/ranch: harvest ripe crops (wheat age 7 golden), breed cows with wheat, fish at open water. Hunger below 14 means get food first.
7. Talk like a person, not a status report. When you chat, write what a friendly player would type: short, warm, specific ("got it, bringing wood!", "careful, creeper by the farm"). Never robotic status lines. Vary your words.
8. Be brief. THINK in one sentence, ACT in one line. No code fences.
Mechanics you must know: daylight burns zombies/skeletons, not creepers/spiders. Tools tier wood < stone < iron < diamond; iron ore needs a stone pick and a furnace (fuel: coal/planks/logs) to become usable iron. Crafting table (4 planks, needs no table) unlocks 3x3 recipes within 4 blocks. Fall damage kills — use water, never jump heights. Closed doors block pathfinding: route around, never break them. Our beds are at x=46..54, y=63, z=77 — sleep there at night (within 4 blocks) to skip night and set spawn.
Errors tell you the fix — never retry the identical failing command: "No X in inventory" → gather/craft X. "can't see" → goto_near first. "Task already running" → wait. "No bed within 4 blocks" → goto_near 50 63 77 first. "it's not night" → work till evening. "Need a crafting table" → craft one anywhere.`;

// Compact observation: the full raw status JSON (~8KB with scene/stats) was
// choking the LM Studio engine (400 parse errors). Send essentials only.
function compactObservation(statusJson, chatText, lastActionText) {
  let d = {};
  try { d = JSON.parse(statusJson).data || {}; } catch {}
  const pos = d.position ? `${Math.floor(d.position.x)},${Math.floor(d.position.y)},${Math.floor(d.position.z)}` : 'unknown';
  const inv = (d.inventory || []).filter((i) => i.count > 0).map((i) => `${i.name}x${i.count}`).join(', ') || 'empty';
  const hostiles = (d.nearbyEntities || []).filter((e) => e.kind === 'hostile').map((e) => `${e.type}@${Math.floor(e.distance)}m`).join(', ') || 'none';
  const blocks = [...(d.scene?.visible_block_hits || []), ...(d.notableBlocks || [])].slice(0, 8).map((b) => b.name).join(', ') || 'none seen';
  const chat = (chatText || '').slice(-500);
  return `HP:${d.health ?? '?'} FOOD:${d.food ?? '?'} POS:${pos} HOLD:${d.holding || 'empty'} INV:[${inv}] HOSTILES:[${hostiles}] SEEN:[${blocks}]\nCHAT:${chat}\nLAST:${(lastActionText || '(none)').slice(0, 200)}`;
}

let lastObservation = '';
let lastAction = '';
let pending = false;
let lastAcknowledgedWhisper = '';
let whisperCheckBusy = false;

function latestHumanWhisper(chatText, botNames = new Set()) {
  const lines = String(chatText || '').split('\n').reverse();
  for (const line of lines) {
    const match = line.match(/^\s*<([^>]+)>\s*(.*?)\s*\[whisper\]\s*$/i);
    if (!match) continue;
    const from = match[1].trim();
    if (!from || botNames.has(from.toLowerCase())) continue;
    return { from, message: match[2].trim() };
  }
  return null;
}

async function acknowledgeHumanWhisper(chatText) {
  const whisper = latestHumanWhisper(chatText, new Set(['duckbot', 'steve', 'reed', 'moss', 'flint', 'ember']));
  if (!whisper) return false;
  const key = `${whisper.from}:${whisper.message}`;
  if (key === lastAcknowledgedWhisper) return false;
  await callMc(['chat_to', whisper.from, 'I hear you — I’m leading the village and checking the team now.']);
  lastAcknowledgedWhisper = key;
  lastAction = `whisper acknowledgement sent to ${whisper.from}`;
  return true;
}

function parseCommand(line) {
  const tokens = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = re.exec(line)) !== null) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

function fallbackAction(statusJson) {
  let data = {};
  try { data = JSON.parse(statusJson).data || {}; } catch {}
  const hostile = (data.nearbyEntities || []).find((e) => e.kind === 'hostile');
  const edible = (data.inventory || []).some((i) => /bread|apple|carrot|potato|beef|pork|chicken|mutton|fish|stew/i.test(i.name) && i.count > 0);
  if (hostile && (data.health || 0) >= 12) return `mc fight ${hostile.type}`;
  if ((data.health || 0) < 10 && edible) return 'mc eat';
  if (hostile) return 'mc flee 20';
  const blocks = [...(data.scene?.visible_block_hits || []), ...(data.notableBlocks || [])];
  const wood = blocks.find((b) => /^(dark_oak|oak|birch|jungle|cherry)_log$/.test(b.name));
  if (wood?.position) return `mc goto_near ${wood.position.x} ${wood.position.y} ${wood.position.z}`;
  if (wood) return `mc collect ${wood.name} 8`;
  return 'mc collect dark_oak_log 8';
}

function callMc(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(MC_CLI, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (chunk) => { out += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { err += chunk.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`mc exit ${code}: ${err.trim()}`));
      }
      resolve(out.trim());
    });
  });
}

async function runTurn() {
  if (pending) return;
  pending = true;
  try {
    const status = await callMc(['status', '--json']);
    const chat = await callMc(['read_chat', '5']);
    const observation = compactObservation(status, chat, lastAction);
    lastObservation = observation;

    const body = {
      model: activeModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: observation },
      ],
      max_tokens: 512,
      temperature: 0.4,
    };

    async function runFallback(reason) {
      const fb = fallbackAction(status);
      try {
        const out = await callMc(parseCommand(fb).slice(1));
        lastAction = `${fb} -> ${out.slice(0, 120)} | fallback (${reason})`;
      } catch (err) {
        lastAction = `${fb} -> ERROR ${err.message} | fallback (${reason})`;
      }
    }

    // Consecutive LM failures open a cooldown: skip the model call and act
    // deterministically instead of hammering a sick server or idling.
    if (lmPolicy.shouldSkip()) {
      await runFallback('lm cooldown');
      return;
    }

    let res;
    try {
      res = await fetch(`${LMS_URL}/chat/completions`, {
        method: 'POST',
        headers: LMS_HEADERS,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
    } catch (err) {
      lmPolicy.recordFailure();
      console.error('LM Studio fetch error', String(err.message || err).slice(0, 200));
      await runFallback('lm unreachable');
      return;
    }
    if (!res.ok) {
      const text = await res.text();
      lmPolicy.recordFailure();
      console.error('LM Studio error', res.status, text.slice(0, 200));
      await runFallback(`lm ${res.status}`);
      return;
    }
    lmPolicy.recordSuccess();
    const json = await res.json();
    const reply = (json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning_content || '').trim();

    const think = (reply.match(/THINK:\s*(.+)/) || [, ''])[1].trim();
    let act = (reply.match(/ACT:\s*(.+)/) || [, ''])[1].trim();

    if (!act || act.toUpperCase() === 'NONE') {
      act = fallbackAction(status);
    }

    let tokens = parseCommand(act);
    if (tokens[0] !== 'mc') {
      act = fallbackAction(status);
      tokens = parseCommand(act);
    }
    if (tokens[0] !== 'mc') {
      lastAction = `rejected: ${act}`;
      return;
    }

    const cmdArgs = tokens.slice(1);
    try {
      const out = await callMc(cmdArgs);
      lastAction = `${think || ''} | ${act} -> ${out.slice(0, 120)}`;
    } catch (err) {
      lastAction = `${act} -> ERROR ${err.message}`;
    }
  } catch (err) {
    console.error('turn error', err.message);
  } finally {
    pending = false;
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/model') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 2000) req.destroy(); });
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}');
        const requested = String(body.model || '').trim();
        const modelsRes = await fetch(`${LMS_URL}/models`, { headers: LMS_HEADERS, signal: AbortSignal.timeout(5000) });
        const models = (await modelsRes.json()).data || [];
        if (!requested || !models.some((m) => m.id === requested)) throw new Error('model is not currently exposed by LM Studio');
        activeModel = requested;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, model: activeModel }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 180) }));
      }
    });
    return;
  }
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      mode: BRIDGE_MODE,
      model: activeModel,
      last_observation: lastObservation.slice(-800),
      last_action: lastAction,
      pending,
      lm_errors: lmPolicy.state(),
    }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
server.listen(BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`LM Studio Minecraft Bridge`);
  console.log(`   mode     : ${BRIDGE_MODE}`);
  console.log(`   model    : ${activeModel}`);
  console.log(`   lms url  : ${LMS_URL}`);
  console.log(`   mc cli   : ${MC_CLI}`);
  console.log(`   http     : http://127.0.0.1:${BRIDGE_PORT}/`);
  console.log(`   interval : ${DECISION_INTERVAL_MS} ms`);
});

setInterval(runTurn, DECISION_INTERVAL_MS);
// Direct whispers are leader traffic. Poll them independently from model turns
// so a slow/cancelled completion cannot leave a player without a DuckBot reply.
setInterval(async () => {
  if (whisperCheckBusy) return;
  whisperCheckBusy = true;
  try {
    const chat = await callMc(['read_chat', '8']);
    await acknowledgeHumanWhisper(chat);
  } catch (err) {
    console.error('whisper acknowledgement error', String(err.message || err).slice(0, 160));
  } finally {
    whisperCheckBusy = false;
  }
}, 2000);
runTurn();