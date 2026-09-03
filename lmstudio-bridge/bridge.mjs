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

const LMS_URL = (process.env.LMS_URL || 'http://127.0.0.1:1234/v1').replace(/\/$/, '');
const LMS_MODEL = process.env.LMS_MODEL || 'google/gemma-4-26b-a4b-qat';
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
  mc wait N

Rules:
1. Survival first. If health is below 10, \`mc eat\`.
2. After three observations in a row, take an action. Never loop observations.
3. If the player asked for something in chat, do that. Player chat overrides
   idle plans.
4. Do not destroy other players' builds. Do not steal from chests.
5. Be brief. THINK in one sentence, ACT in one line. No code fences.`;

let lastObservation = '';
let lastAction = '';
let pending = false;

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
    const status = await callMc(['status']);
    const chat = await callMc(['read_chat', '5']);
    const observation = `STATUS:\n${status}\n\nCHAT:\n${chat}\n\nLAST ACTION: ${lastAction || '(none)'}`;
    lastObservation = observation;

    const body = {
      model: LMS_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: observation },
      ],
      max_tokens: 512,
      temperature: 0.4,
    };

    const res = await fetch(`${LMS_URL}/chat/completions`, {
      method: 'POST',
      headers: LMS_HEADERS,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('LM Studio error', res.status, text.slice(0, 200));
      return;
    }
    const json = await res.json();
    const reply = (json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning_content || '').trim();

    const think = (reply.match(/THINK:\s*(.+)/) || [, ''])[1].trim();
    const act = (reply.match(/ACT:\s*(.+)/) || [, ''])[1].trim();

    if (!act || act.toUpperCase() === 'NONE') {
      lastAction = 'NONE — ' + (think || 'no action');
      return;
    }

    const tokens = act.split(/\s+/);
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
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      mode: BRIDGE_MODE,
      model: LMS_MODEL,
      last_observation: lastObservation.slice(-800),
      last_action: lastAction,
      pending,
    }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
server.listen(BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`LM Studio Minecraft Bridge`);
  console.log(`   mode     : ${BRIDGE_MODE}`);
  console.log(`   model    : ${LMS_MODEL}`);
  console.log(`   lms url  : ${LMS_URL}`);
  console.log(`   mc cli   : ${MC_CLI}`);
  console.log(`   http     : http://127.0.0.1:${BRIDGE_PORT}/`);
  console.log(`   interval : ${DECISION_INTERVAL_MS} ms`);
});

setInterval(runTurn, DECISION_INTERVAL_MS);
runTurn();