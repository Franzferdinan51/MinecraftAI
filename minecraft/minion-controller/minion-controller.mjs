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
const BRIDGE_PORT = parseInt(process.env.MINION_BRIDGE_PORT || '3003', 10);

const PROMPT_TMPL = (name) => `You are ${name}, an AI player in a Minecraft world.

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
1. Survival first. If health is below 10, \`mc eat\`.
2. After three observations in a row, take an action.
3. If a player asked for something in chat, do that.
4. Do not destroy other players' builds.
5. Be brief. THINK in one sentence, ACT in one line.`;

function callMc(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(MC_CLI, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', (c) => { out += c.toString(); });
    proc.stderr.on('data', (c) => { err += c.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`mc exit ${code}: ${err.trim()}`));
      resolve(out.trim());
    });
  });
}

async function lmsComplete(model, observation) {
  const res = await fetch(`${LMS_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: PROMPT_TMPL(model.includes('/') ? model.split('/').pop() : model) },
        { role: 'user', content: observation },
      ],
      max_tokens: 200,
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`lms ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}

const state = new Map();
for (const m of minions) {
  state.set(m.name, { last_observation: '', last_action: 'NONE — initialized', pending: false, ticks: 0 });
}

async function tick(minion) {
  const entry = state.get(minion.name);
  if (entry.pending) return;
  entry.pending = true;
  try {
    const status = await callMc(['status']);
    const chat = await callMc(['read_chat', '5']);
    const observation = `STATUS:\n${status}\n\nCHAT:\n${chat}\n\nLAST ACTION: ${entry.last_action}`;
    entry.last_observation = observation;
    entry.ticks += 1;
    const reply = await lmsComplete(minion.model, observation);
    const think = (reply.match(/THINK:\s*(.+)/) || [, ''])[1].trim();
    const act = (reply.match(/ACT:\s*(.+)/) || [, ''])[1].trim();
    if (!act || act.toUpperCase() === 'NONE') {
      entry.last_action = `NONE — ${think || 'no action'}`;
      return;
    }
    const tokens = act.split(/\s+/);
    if (tokens[0] !== 'mc') {
      entry.last_action = `rejected: ${act}`;
      return;
    }
    try {
      const out = await callMc(tokens.slice(1));
      entry.last_action = `${think || ''} | ${act} -> ${out.slice(0, 120)}`;
    } catch (err) {
      entry.last_action = `${act} -> ERROR ${err.message}`;
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