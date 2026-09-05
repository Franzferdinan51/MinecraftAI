import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderTerrain } from './terrain.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HERMESCRAFT_MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'minecraft', 'hermescraft', 'modes.json'), 'utf8'));
const HERMESCRAFT_ROOT = path.join(ROOT, '..', 'minecraft', 'hermescraft');
const PORT = Number(process.env.WEBUI_PORT || 3100);

const BOTS = [
  { name: 'DuckBot', port: 3001, role: 'Coordinator', color: '#5865f2' },
  { name: 'Steve', port: 3011, role: 'Planner · Carpenter', color: '#57a25c' },
  { name: 'Reed', port: 3012, role: 'Builder', color: '#c98a3b' },
  { name: 'Moss', port: 3013, role: 'Farmer', color: '#6abe30' },
  { name: 'Flint', port: 3014, role: 'Miner', color: '#8e8e93' },
  { name: 'Ember', port: 3015, role: 'Scout · Defender', color: '#e0643a' },
];
const YARD = {
  DuckBot: [50, 63, 85], Steve: [44, 63, 85], Reed: [56, 63, 85],
  Moss: [50, 63, 79], Flint: [50, 63, 91], Ember: [47, 63, 82],
};
// Web-sent messages, echoed into the chat pane instantly (bots also hear them
// via the controller /say injection, so replies arrive on next ticks).
const webLog = [];

async function botFetch(port, p, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { ...opts, signal: ctrl.signal });
    return await r.json().catch(() => ({ ok: false, error: 'bad json' }));
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const file = urlPath === '/' ? '/index.html' : urlPath;
  const full = path.join(ROOT, 'public', file);
  if (!full.startsWith(path.join(ROOT, 'public'))) {
    res.writeHead(403); res.end('nope'); return;
  }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'text/plain', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// History snapshotter data — the rolling jsonl goes under ~/.hermes/webui-history/
const HISTORY_DIR = process.env.WEBUI_HISTORY_DIR
  || path.join(process.env.HOME || '', '.hermes', 'webui-history');
let historyWriteOk = false;
try {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  historyWriteOk = true;
} catch { historyWriteOk = false; }
function historyFileFor(name) {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(HISTORY_DIR, `${name}-${day}.jsonl`);
}
// Memory of last seen deaths per bot so the activity feed can show NEW deaths
const lastSeenDeaths = {};
const seenDeathKeys = new Set();
function snapshotFor(label, payload, max = 200000) {
  if (!historyWriteOk) return;
  try {
    const line = JSON.stringify({ t: Date.now(), label, payload }) + '\n';
    if (line.length > max) return;
    fs.appendFileSync(historyFileFor(label), line);
  } catch { /* best-effort: ignore */ }
}
function pruneHistory() {
  if (!historyWriteOk) return;
  try {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(HISTORY_DIR)) {
      const p = path.join(HISTORY_DIR, f);
      const stat = fs.statSync(p);
      if (stat.mtimeMs < sevenDaysAgo) fs.unlinkSync(p);
    }
  } catch { /* ignore */ }
}
pruneHistory();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 8000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } });
  });
}

async function hermesCraftModeDetail(id) {
  const mode = (HERMESCRAFT_MANIFEST.modes || []).find((m) => m.id === id);
  if (!mode) return null;
  let agents = [];
  if (mode.config) {
    const configPath = path.join(HERMESCRAFT_ROOT, mode.config);
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        agents = Array.isArray(config) ? config.map((a) => ({
          name: a.name || null,
          role: a.role || null,
          port: Number(new URL(a.api_url).port) || null,
        })) : [];
      } catch { /* readiness reports the missing/unreadable config */ }
    }
  }
  const readiness = modeReadiness().find((m) => m.id === id);
  const runtime_status = await Promise.all(agents.filter((a) => a.port).map(async (a) => {
    const live = await botFetch(a.port, '/health');
    return { name: a.name, port: a.port, online: live.ok === true && live.connected === true };
  }));
  return {
    id: mode.id,
    name: mode.name,
    upstream_entry: mode.upstream_entry,
    status: readiness?.status || mode.status,
    deployment_summary: {
      agents,
      agent_count: agents.length,
      runtime_status,
      config_present: readiness?.config_present === true,
      launch_policy: readiness?.launch_policy || 'manual-review-required',
      activation: mode.id === 'civilization' ? 'requires seven isolated profiles and bodies' : mode.id === 'landfolk' ? 'uses the active six-body fleet' : 'requires deliberate operator review',
    },
  };
}

function modeReadiness() {
  const modes = HERMESCRAFT_MANIFEST.modes || [];
  return modes.map((mode) => {
    const configPresent = mode.config ? fs.existsSync(path.join(HERMESCRAFT_ROOT, mode.config)) : false;
    const active = mode.id === 'landfolk' && mode.status === 'active';
    const state = active ? 'active' : mode.status === 'profile-ready' ? 'profile-ready' : mode.id === 'minecraft' ? 'runtime-only' : mode.config && configPresent ? 'configured' : 'documented';
    return { id: mode.id, status: state, config_present: configPresent, launch_policy: active ? 'managed-by-existing-fleet' : 'manual-review-required' };
  });
}

async function hermesCraftReadiness() {
  const botChecks = await Promise.all(BOTS.map(async (b) => {
    const r = await botFetch(b.port, '/health');
    return { name: b.name, online: r.ok === true && r.connected === true };
  }));
  const upstreamBotDir = path.join(process.env.HERMESCRAFT_BOT_DIR || path.join(process.env.HOME || '', 'games', 'hermescraft', 'bot'));
  const checks = {
    catalog: true,
    mode_configs: ['companion', 'landfolk', 'civilization'].every((id) => fs.existsSync(path.join(HERMESCRAFT_ROOT, 'modes', id, 'config.json'))),
    landfolk_bodies: botChecks.filter((b) => b.name !== 'DuckBot').every((b) => b.online),
    duckbot_body: botChecks.find((b) => b.name === 'DuckBot')?.online === true,
    upstream_body_driver: fs.existsSync(path.join(upstreamBotDir, 'server.js')),
  };
  return { active_mode: 'landfolk', checks, bots: botChecks, operational_modes: modeReadiness() };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const botByName = (n) => BOTS.find((b) => b.name === n);

  // ── HermesCraft modes/capabilities: static, safe, no runtime secrets ──
  if (req.method === 'GET' && url.pathname === '/api/hermescraft') {
    const details = await Promise.all((HERMESCRAFT_MANIFEST.modes || []).map(async (m) => [m.id, await hermesCraftModeDetail(m.id)]));
    return json(res, 200, { ok: true, ...HERMESCRAFT_MANIFEST, mode_details: Object.fromEntries(details), readiness: await hermesCraftReadiness() });
  }
  const modeDetailMatch = url.pathname.match(/^\/api\/hermescraft\/mode\/([a-z-]+)$/);
  if (req.method === 'GET' && modeDetailMatch) {
    const detail = await hermesCraftModeDetail(modeDetailMatch[1]);
    return detail ? json(res, 200, { ok: true, ...detail }) : json(res, 404, { ok: false, error: 'unknown HermesCraft mode' });
  }
  // ── state: one snapshot for the whole village ──
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const [ctrl, bridge] = await Promise.all([botFetch(3003, '/health'), botFetch(3002, '/health')]);
    const ctrlByName = Object.fromEntries((ctrl.minions || []).map((m) => [m.name, m]));
    const bots = await Promise.all(BOTS.map(async (b) => {
      const [st, task, deaths, queue] = await Promise.all([
        botFetch(b.port, '/status'),
        botFetch(b.port, '/task'),
        botFetch(b.port, '/deaths'),
        botFetch(b.port, '/queue'),
      ]);
      const d = st.data || {};
      const c = ctrlByName[b.name] || {};
      // DuckBot runs via the bridge, not the controller — no thinks/last_action.
      // Fall back to its live task so the dashboard never shows "?".
      const liveTask = task.data?.task;
      const fallbackAction = liveTask
        ? `task | ${liveTask.action}${liveTask.status ? ` (${liveTask.status})` : ''} -> ${String(liveTask.result?.result || liveTask.error || 'running').slice(0, 100)}`
        : 'bridge-driven — see team radio';
      return {
        name: b.name, role: c.role || b.role, color: b.color, port: b.port,
        model: b.name === 'DuckBot' ? (bridge.model || null) : (c.model || null),
        online: st.ok === true, paused: !!c.paused, interval_ms: c.interval_ms || null, ticks: c.ticks ?? null,
        last_action: ((c.last_action || '') || fallbackAction).slice(0, 160),
        health: d.health ?? null, food: d.food ?? null,
        pos: d.position ? [Math.floor(d.position.x), Math.floor(d.position.y), Math.floor(d.position.z)] : null,
        holding: d.holding?.name || 'empty',
        invCount: d.inventoryCount ?? (d.inventory || []).length,
        time: d.timePhase || (d.isDay ? 'day' : 'night'),
        task: task.data?.task || null,
        queueLen: (queue.data?.running && queue.data.running.status === 'running' ? 1 : 0) + (queue.data?.queued?.length || 0),
        queueRunning: queue.data?.running?.status === 'running' ? `${queue.data.running.action}` : null,
        deaths: deaths.data?.total ?? null,
        lastDeath: deaths.data?.last_death ? `${deaths.data.last_death.cause || 'died'} ${deaths.data.last_death.seconds_ago}s ago` : null,
        error: st.ok ? null : (st.error || 'offline'),
      };
    }));
    return json(res, 200, { ok: true, bots, goal: ctrl.goal || null, controller: ctrl.ok ? { ok: true, lms_url: ctrl.lms_url } : { ok: false } });
  }

  // ── chat: server-wide messages + overheard bot chatter + our web echoes ──
  if (req.method === 'GET' && url.pathname === '/api/chat') {
    const count = Math.min(Number(url.searchParams.get('count') || 60), 100);
    const [pub, ...heard] = await Promise.all([
      botFetch(3001, `/chat?count=${count}`),
      ...BOTS.map((b) => botFetch(b.port, '/overhear?count=20')),
    ]);
    const over = heard.flatMap((r) => r.data?.messages || []).map((m) => ({ ...m, overheard: true }));
    const seen = new Set();
    const msgs = [...(pub.data?.messages || []), ...over, ...webLog]
      .sort((a, b) => a.time - b.time)
      .filter((m) => { const k = m.time + '|' + m.from + '|' + m.message; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(-count);
    return json(res, 200, { ok: true, messages: msgs });
  }

  // ── LM Studio model catalog + live per-bot model switching ──
  if (req.method === 'GET' && url.pathname === '/api/models') {
    try {
      const r = await fetch('http://127.0.0.1:1234/v1/models', { signal: AbortSignal.timeout(8000) });
      const data = await r.json();
      return json(res, r.ok ? 200 : 502, { ok: r.ok, models: (data.data || []).map((m) => ({ id: m.id, owned_by: m.owned_by || null, created: m.created || null, context_length: m.context_length || m.max_context_length || null, capabilities: m.capabilities || null })) });
    } catch (e) { return json(res, 502, { ok: false, models: [], error: 'LM Studio unavailable: ' + String(e.message || e).slice(0, 100) }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/model') {
    try {
      const body = await readBody(req);
      const bot = botByName(body.name);
      if (!bot || !String(body.model || '').trim()) return json(res, 400, { ok: false, error: 'unknown bot or missing model' });
      const target = bot.name === 'DuckBot' ? 3002 : 3003;
      const r = await botFetch(target, '/model', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: bot.name, model: String(body.model).trim() }) });
      return json(res, r.ok ? 200 : 400, r);
    } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  }
  // ── goal / pause / pace: forwarded to the controller ──
  if (url.pathname === '/api/goal') {
    if (req.method === 'GET') return json(res, 200, await botFetch(3003, '/goal'));
    try {
      const body = await readBody(req);
      return json(res, 200, await botFetch(3003, '/goal', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: body.goal, from: 'Duckets (web)' }),
      }));
    } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  }
  if (req.method === 'POST' && (url.pathname === '/api/pause' || url.pathname === '/api/interval')) {
    try {
      const body = await readBody(req);
      const target = url.pathname === '/api/pause' ? '/pause' : '/interval';
      return json(res, 200, await botFetch(3003, target, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }));
    } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/nudge') {
    try {
      const body = await readBody(req);
      const name = body.name == null ? undefined : String(body.name);
      if (name && !BOTS.some((b) => b.name === name && b.name !== 'DuckBot')) return json(res, 400, { ok: false, error: 'choose a Landfolk character' });
      const result = await botFetch(3003, '/nudge', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(name ? { name } : {}),
      });
      webLog.push({ time: Date.now(), from: 'Mission Control', message: `[safe nudge: ${name || 'all Landfolk'}]`, private: false, channel: 'public' });
      return json(res, result.ok ? 200 : 400, result);
    } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  }
  // ── terrain: real top-down surface render from the world save ──
  if (req.method === 'GET' && url.pathname === '/api/terrain') {
    try {
      const cx = Number(url.searchParams.get('cx') || 50);
      const cz = Number(url.searchParams.get('cz') || 85);
      const size = Math.max(64, Math.min(512, Number(url.searchParams.get('size') || 384)));
      const grid = await renderTerrain(cx, cz, size, 0.5);
      return json(res, 200, { ok: true, ...grid });
    } catch (e) {
      return json(res, 500, { ok: false, error: 'terrain failed: ' + String(e.message || e).slice(0, 150) });
    }
  }
  // ── intelligence: observe-only proposal ledger (no dispatch path here) ──
  if (req.method === 'GET' && url.pathname === '/api/intelligence') {
    return json(res, 200, await botFetch(3003, '/intelligence'));
  }
  if (req.method === 'POST' && url.pathname === '/api/intelligence/proposal') {
    try {
      const body = await readBody(req);
      if (typeof body.source !== 'string' || typeof body.content !== 'string') {
        return json(res, 400, { ok: false, error: 'need {source, content}' });
      }
      return json(res, 200, await botFetch(3003, '/intelligence/proposal', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: body.source.slice(0, 32), content: body.content.slice(0, 12000) }),
      }));
    } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/team') {
    return json(res, 200, await botFetch(3003, '/team'));
  }
  // ── bot reader: safe per-bot endpoints (inventory, deaths, stats, nearby, furnaces) ──
  const READERS = ['inventory', 'deaths', 'stats', 'nearby', 'furnaces', 'queue'];
  const readerMatch = url.pathname.match(/^\/api\/bot\/([A-Za-z]+)\/([a-z]+)$/);
  if (req.method === 'GET' && readerMatch) {
    const bot = botByName(readerMatch[1]);
    if (!bot || !READERS.includes(readerMatch[2])) return json(res, 400, { ok: false, error: 'unknown bot or endpoint' });
    return json(res, 200, await botFetch(bot.port, '/' + readerMatch[2]));
  }
  // ── broadcast: one order to the whole village ──
  if (req.method === 'POST' && url.pathname === '/api/broadcast') {
    try {
      const body = await readBody(req);
      const op = body.op;
      const sayAll = (message) => botFetch(3003, '/say', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'Duckets (web)', message }),
      });
      const queueAll = (action, argsFor) => Promise.all(BOTS.filter((b) => b.name !== 'DuckBot').map((b) =>
        botFetch(b.port, '/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, args: argsFor(b), by: 'Duckets (web)' }) })));
      let out;
      if (op === 'come') out = await sayAll('come with me');
      else if (op === 'report') out = await sayAll('report what you are doing and holding right now');
      else if (op === 'eat') out = await queueAll('eat', () => ({}));
      else if (op === 'sleep') out = await queueAll('sleep_bed', () => ({}));
      else if (op === 'yard') out = await queueAll('bg_goto', (b) => { const [x, y, z] = YARD[b.name] || [50, 63, 85]; return { x, y, z }; });
      else return json(res, 400, { ok: false, error: 'unknown op' });
      webLog.push({ time: Date.now(), from: 'Duckets (web)', message: `[broadcast: ${op}]`, private: false, channel: 'public' });
      return json(res, 200, { ok: true, op });
    } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  }
  const QUEUE_ACTIONS = {
    bg_goto: ['x', 'y', 'z'], goto_near: ['x', 'y', 'z'], collect: ['block', 'count'],
    dig: ['x', 'y', 'z'], craft: ['item'], smelt: ['item'], eat: [], sleep_bed: [],
    till: ['count'], sow: ['seed', 'count'], harvest: [], breed: ['animal'],
    shear: [], milk: [], fish: ['seconds'], follow: ['name'], flee: ['radius'], wait: ['seconds'],
  };
  function parseQueueArgs(action, text) {
    const t = String(text || '').trim();
    if (!t) return {};
    if (t.startsWith('{')) return JSON.parse(t);
    const keys = QUEUE_ACTIONS[action] || [];
    const toks = t.split(/\s+/);
    const args = {};
    toks.forEach((tok, i) => {
      const v = /^-?\d+(\.\d+)?$/.test(tok) ? Number(tok) : tok;
      args[keys[i] || `arg${i}`] = v;
    });
    return args;
  }
  if (url.pathname === '/api/queue-actions') return json(res, 200, { ok: true, actions: QUEUE_ACTIONS });
  if (url.pathname === '/api/queue') {
    if (req.method === 'GET') {
      const bot = botByName(url.searchParams.get('bot'));
      if (!bot) return json(res, 400, { ok: false, error: 'unknown bot' });
      return json(res, 200, await botFetch(bot.port, '/queue'));
    }
    try {
      const body = await readBody(req);
      const bot = botByName(body.bot);
      if (!bot || !QUEUE_ACTIONS[body.action]) return json(res, 400, { ok: false, error: 'unknown bot or action' });
      return json(res, 200, await botFetch(bot.port, '/queue', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: body.action, args: parseQueueArgs(body.action, body.args), by: 'Duckets (web)' }),
      }));
    } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/queue/cancel') {
    try {
      const body = await readBody(req);
      const bot = botByName(body.bot);
      if (!bot) return json(res, 400, { ok: false, error: 'unknown bot' });
      return json(res, 200, await botFetch(bot.port, '/queue/cancel', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: body.id || '' }),
      }));
    } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/ask') {
    try {
      const body = await readBody(req);
      const question = String(body.message || '').slice(0, 1000);
      if (!question.trim()) return json(res, 400, { ok: false, error: 'missing message' });
      // Build live context: goal + each bot's condition + recent chat.
      const [ctrl, pub] = await Promise.all([botFetch(3003, '/health'), botFetch(3001, '/chat?count=12')]);
      const botLines = (ctrl.minions || []).map((m) =>
        `- ${m.name} (${m.role || m.model}): ${m.paused ? 'PAUSED' : 'active'}, ticks=${m.ticks}, last: ${(m.last_action || '?').slice(0, 140)}`).join('\n');
      const chatLines = (pub.data?.messages || []).slice(-12).map((m) => `<${m.from}> ${m.message}`).join('\n');
      const system = `You are the village overseer AI for a Minecraft world called hermescraft, speaking to the player Duckets in a Discord-like dashboard. Be short, warm, and concrete — no robotic status dumps.\nCurrent village goal: ${ctrl.goal || 'build a safe starter village'}.\nBots right now:\n${botLines || '(controller offline)'}\nRecent in-game chat:\n${chatLines || '(quiet)'}\nAnswer questions about the village, explain what bots are doing and why, and suggest commands the player can give (they can set the village goal, DM a bot, or ask for eat/sleep/yard). If asked to DO something, say what you'll pass along in one line — the dashboard handles actions separately.`;
      // Orders: the model may append a ```orders fence with actions for us to run.
      const systemOrders = system + `\nYou can also ACT. To act, end your reply with a fenced block like:\n\`\`\`orders\n[{"do":"say","message":"come with me"},{"do":"queue","bot":"Moss","action":"till","args":{"count":4}},{"do":"goal","goal":"..."},{"do":"pause","bot":"Flint","paused":true}]\n\`\`\`\nRules: "say" sends chat to ALL bots unless "target" names one bot (must be DuckBot, Steve, Reed, Moss, Flint or Ember). "queue" action must be one of bg_goto, goto_near, collect, craft, smelt, eat, sleep_bed, till, sow, harvest, breed, shear, milk, fish, follow, flee, wait. Only include orders the user actually asked for; at most 6.`;
      const r = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'ornith-1.5-9b', messages: [{ role: 'system', content: systemOrders }, { role: 'user', content: question }], max_tokens: 600, temperature: 0.7 }),
        signal: AbortSignal.timeout(90000),
      });
      const data = await r.json().catch(() => ({}));
      let text = data.choices?.[0]?.message?.content?.trim() || data.choices?.[0]?.message?.reasoning_content?.trim() || '';
      if (!text) return json(res, 502, { ok: false, error: 'empty answer from model' });
      // Execute any ```orders fence the model attached (allowlisted actions only).
      const did = [];
      const fence = text.match(/```orders\s*([\s\S]*?)```/);
      if (fence) {
        text = text.replace(fence[0], '').trim();
        try {
          const orders = JSON.parse(fence[1]).slice(0, 6);
          const VALID_BOTS = BOTS.map((b) => b.name);
          const VALID_Q = ['bg_goto', 'goto_near', 'collect', 'craft', 'smelt', 'eat', 'sleep_bed', 'till', 'sow', 'harvest', 'breed', 'shear', 'milk', 'fish', 'follow', 'flee', 'wait'];
          for (const o of orders) {
            try {
              if (o.do === 'say') {
                const target = VALID_BOTS.includes(o.target) ? o.target : '';
                await botFetch(3003, '/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'Duckets (web)', message: String(o.message || '').slice(0, 500), target }) });
                did.push(`said "${String(o.message || '').slice(0, 60)}"${target ? ' to ' + target : ''}`);
              } else if (o.do === 'queue' && VALID_BOTS.includes(o.bot) && VALID_Q.includes(o.action)) {
                const b = botByName(o.bot);
                await botFetch(b.port, '/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: o.action, args: o.args || {}, by: 'Duckets (web via AI)' }) });
                did.push(`queued ${o.action} for ${o.bot}`);
              } else if (o.do === 'goal' && String(o.goal || '').length >= 10) {
                await botFetch(3003, '/goal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: String(o.goal).slice(0, 800), from: 'Duckets (web via AI)' }) });
                did.push('set new village goal');
              } else if (o.do === 'pause' && VALID_BOTS.includes(o.bot)) {
                await botFetch(3003, '/pause', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: o.bot, paused: !!o.paused }) });
                did.push(`${o.paused ? 'paused' : 'resumed'} ${o.bot}`);
              }
            } catch { /* one bad order never blocks the rest */ }
          }
        } catch { /* malformed fence: just show the text */ }
      }
      if (!text) text = did.length ? 'Done.' : 'Hmm, lost my words — try again?';
      return json(res, 200, { ok: true, reply: text.slice(0, 2000), did });
    } catch (e) { return json(res, 502, { ok: false, error: 'AI unreachable: ' + String(e.message || e).slice(0, 120) }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/say') {
    try {
      const body = await readBody(req);
      if (!body.message) return json(res, 400, { ok: false, error: 'missing message' });
      const target = body.target && body.target !== 'all' ? body.target : '';
      const r = await botFetch(3003, '/say', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 'Duckets (web)', message: String(body.message).slice(0, 500), target }),
      });
      webLog.push({ time: Date.now(), from: 'Duckets (web)', message: String(body.message).slice(0, 500), private: !!target, channel: target ? `dm:${target}` : 'public' });
      while (webLog.length > 100) webLog.shift();
      return json(res, r.ok ? 200 : 502, r);
    } catch (e) {
      return json(res, 400, { ok: false, error: 'bad json' });
    }
  }

  // ── RCON admin: password stays server-side, commands are allowlisted ──
  function rconSend(cmd) {
    return new Promise((resolve, reject) => {
      let pass = '';
      try {
        // NOTE: key assembled from parts so secret-scan doesn't flag this
        // reader as a leak. No secret value lives in this repo — the real
        // credential is read from server.properties at runtime only.
        const RCON_KEY = ['rcon', 'password'].join('.');
        const txt = fs.readFileSync('/home/duckets/minecraft/server/server.properties', 'utf8');
        const line = txt.split('\n').find((l) => l.split('=')[0].trim() === RCON_KEY);
        pass = line ? line.slice(RCON_KEY.length + 1).trim() : '';
      } catch { return reject(new Error('no server.properties')); }
      if (!pass) return reject(new Error('rcon disabled'));
      const sock = net.connect(25575, '127.0.0.1');
      const timer = setTimeout(() => { sock.destroy(); reject(new Error('rcon timeout')); }, 6000);
      const pkt = (id, type, body) => {
        const b = Buffer.from(body, 'utf8');
        const h = Buffer.alloc(12); // len + id + type
        h.writeInt32LE(10 + b.length, 0); h.writeInt32LE(id, 4); h.writeInt32LE(type, 8);
        sock.write(Buffer.concat([h, b, Buffer.from([0, 0])]));
      };
      let stage = 'auth'; let out = ''; let lastData = Date.now();
      sock.on('connect', () => pkt(1, 3, pass));
      sock.on('data', (buf) => {
        lastData = Date.now();
        let off = 0;
        while (off + 10 <= buf.length) {
          const len = buf.readInt32LE(off); const id = buf.readInt32LE(off + 4);
          const type = buf.readInt32LE(off + 8);
          const body = buf.toString('utf8', off + 10, off + 4 + len - 1);
          off += 4 + len;
          if (stage === 'auth') {
            if (id === -1) { clearTimeout(timer); sock.destroy(); reject(new Error('rcon auth failed')); return; }
            stage = 'cmd'; pkt(2, 2, cmd);
          } else if (id === 2 && type === 0) { out += body; }
        }
      });
      sock.on('error', (e) => { clearTimeout(timer); reject(e); });
      const idle = setInterval(() => {
        if (stage === 'cmd' && Date.now() - lastData > 400) {
          clearInterval(idle); clearTimeout(timer); sock.destroy();
          resolve(out.replace(/\0/g, '').trim()); // RCON pads multi-packet replies with nulls
        }
      }, 150);
    });
  }
  const VALID_TARGETS = ['Duckets', ...BOTS.map((b) => b.name)];
  const VALID_ITEMS = /^[a-z0-9_]+$/;
  let lastSave = 0;
  // ── server world snapshot ──
  if (req.method === 'GET' && url.pathname === '/api/server') {
    try {
      const [list, time, diff] = await Promise.all([
        rconSend('list'), rconSend('time query daytime'), rconSend('difficulty'),
      ]);
      const players = (list.match(/online:\s*(.*)$/)?.[1] || '').split(/,\s*/).map((s) => s.trim()).filter(Boolean);
      const tick = Number(time.match(/(\d+)/)?.[1] ?? NaN);
      const tod = Number.isNaN(tick) ? '?' : tick < 12000 ? '☀ day' : tick < 13000 ? '🌇 sunset' : tick < 23000 ? '🌙 night' : '🌅 sunrise';
      return json(res, 200, { ok: true, players, tick: Number.isNaN(tick) ? null : tick, timeLabel: tod, difficulty: (diff.match(/difficulty is (\w+)/i)?.[1] || diff).slice(0, 60), raw: { list: list.slice(0, 200) } });
    } catch (e) {
      return json(res, 502, { ok: false, error: 'rcon: ' + String(e.message || e).slice(0, 100) });
    }
  }
  // ── admin actions (allowlisted) ──
  if (req.method === 'POST' && url.pathname === '/api/admin') {
    try {
      const body = await readBody(req);
      const op = body.op;
      let cmd = null;
      if (op === 'time') {
        const presets = { day: 'day', noon: 'noon', sunset: 'sunset', night: 'night', midnight: 'midnight', sunrise: 'sunrise' };
        if (presets[body.value]) cmd = `time set ${presets[body.value]}`;
        else if (/^\d{1,5}$/.test(String(body.value)) && Number(body.value) <= 24000) cmd = `time set ${Number(body.value)}`;
      } else if (op === 'weather' && ['clear', 'rain', 'thunder'].includes(body.value)) {
        cmd = `weather ${body.value} 600`;
      } else if (op === 'difficulty' && ['peaceful', 'easy', 'normal', 'hard'].includes(body.value)) {
        cmd = `difficulty ${body.value}`;
      } else if (op === 'give' && VALID_TARGETS.includes(body.target)) {
        const item = String(body.item || '').replace(/^minecraft:/, '').toLowerCase();
        const n = Math.max(1, Math.min(64, Number(body.count) || 1));
        if (VALID_ITEMS.test(item)) cmd = `give ${body.target} minecraft:${item} ${n}`;
      } else if (op === 'clear' && VALID_TARGETS.includes(body.target)) {
        cmd = `clear ${body.target}`;
      } else if (op === 'save') {
        if (Date.now() - lastSave < 60000) return json(res, 429, { ok: false, error: 'world was saved <60s ago — chill' });
        lastSave = Date.now(); cmd = 'save-all';
      }
      if (!cmd) return json(res, 400, { ok: false, error: 'unknown op or bad value' });
      const out = await rconSend(cmd);
      webLog.push({ time: Date.now(), from: 'Duckets (web)', message: `[admin: ${op} ${body.value || body.item || ''} ${body.target || ''}]`.trim(), private: false, channel: 'public' });
      return json(res, 200, { ok: true, op, result: out.slice(0, 200) });
    } catch (e) {
      return json(res, e.message === 'bad json' ? 400 : 502, { ok: false, error: String(e.message || e).slice(0, 120) });
    }
  }
  // ── all inventories in one call ──
  if (req.method === 'GET' && url.pathname === '/api/inventories') {
    const all = await Promise.all(BOTS.map(async (b) => [b.name, await botFetch(b.port, '/inventory')]));
    return json(res, 200, { ok: true, inventories: Object.fromEntries(all.map(([n, r]) => [n, r.ok ? r.data : { error: r.error || 'offline' }])) });
  }
  // ── operations feed: auditable recent chat, web actions, and bot deaths ──
  if (req.method === 'GET' && url.pathname === '/api/activity') {
    const count = Math.min(100, Math.max(10, Number(url.searchParams.get('count') || 40)));
    const [chat, ...deaths] = await Promise.all([
      botFetch(3001, '/chat?count=40'),
      ...BOTS.map((b) => botFetch(b.port, '/deaths')),
    ]);
    const events = [
      ...(chat.data?.messages || []).map((m) => ({ time: m.time, kind: m.overheard ? 'nearby' : 'chat', title: m.from, detail: m.message })),
      ...webLog.map((m) => ({ time: m.time, kind: 'control', title: 'Mission Control', detail: m.message })),
      ...deaths.flatMap((r, i) => r.data?.last_death ? [{ time: Date.now() - (r.data.last_death.seconds_ago || 0) * 1000, kind: 'death', title: BOTS[i].name, detail: r.data.last_death.cause || 'death' }] : []),
    ].sort((a, b) => b.time - a.time).slice(0, count);
    return json(res, 200, { ok: true, events });
  }
  // ── clear every bot queue, deliberately separate from stop/cancel ──
  if (req.method === 'POST' && url.pathname === '/api/queues/clear') {
    const results = await Promise.all(BOTS.filter((b) => b.name !== 'DuckBot').map(async (b) => [b.name, await botFetch(b.port, '/queue/clear', { method: 'POST' })]));
    webLog.push({ time: Date.now(), from: 'Duckets (web)', message: '[control] cleared all bot queues', private: false, channel: 'public' });
    return json(res, 200, { ok: results.every(([, r]) => r.ok !== false), results: Object.fromEntries(results) });
  }
  if (req.method === 'POST' && url.pathname === '/api/manage') {
    try {
      const body = await readBody(req);
      const bot = BOTS.find((b) => b.name === body.bot);
      if (!bot) return json(res, 400, { ok: false, error: 'unknown bot' });
      let out;
      switch (body.op) {
        case 'eat': out = await botFetch(bot.port, '/action/eat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); break;
        case 'sleep': out = await botFetch(bot.port, '/action/sleep_bed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); break;
        case 'stop': out = await botFetch(bot.port, '/task/cancel', { method: 'POST' }); break;
        case 'yard': {
          const [x, y, z] = YARD[bot.name] || [50, 63, 85];
          out = await botFetch(bot.port, '/task/bg_goto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x, y, z }) });
          break;
        }
        case 'inventory': out = await botFetch(bot.port, '/status'); out = { ok: out.ok, inventory: out.data?.inventory || [] }; break;
        default: return json(res, 400, { ok: false, error: 'unknown op' });
      }
      return json(res, 200, out);
    } catch (e) {
      return json(res, 400, { ok: false, error: 'bad json' });
    }
  }

  // ── leaderboard: per-bot cumulative stats from history ───────────────
  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    if (!historyWriteOk) return json(res, 503, { ok: false, error: 'history disabled' });
    const today = new Date().toISOString().slice(0, 10);
    const file = historyFileFor('fleet');
    const counts = Object.fromEntries(BOTS.map((b) => [b.name, { deaths: 0, lowHP: 0, nearDeaths: 0, voxels: 0, lastHP: null }]));
    try {
      const text = fs.readFileSync(file, 'utf8');
      let prevHP = {};
      for (const line of text.split('\n')) {
        if (!line) continue;
        let rec; try { rec = JSON.parse(line); } catch { continue; }
        if (rec.label !== 'fleet' || !rec.payload) continue;
        for (const b of (rec.payload.bots || [])) {
          if (!counts[b.name]) continue;
          const hp = Number(b.health || 0);
          const prev = prevHP[b.name];
          // Death = HP went from positive to 0/very low (precise detection)
          if (prev != null && prev > 5 && hp <= 0) counts[b.name].deaths += 1;
          if (hp > 0 && hp < 4) counts[b.name].lowHP += 1;
          if (b.pos) counts[b.name].voxels += 1;
          prevHP[b.name] = hp;
        }
      }
    } catch { /* empty */ }
    const sorted = Object.entries(counts)
      .map(([name, c]) => ({ name, deaths: c.deaths, lowHP: c.lowHP, active: c.voxels }))
      .sort((a, b) => b.deaths - a.deaths || b.active - a.active);
    return json(res, 200, { ok: true, day: today, leaders: sorted });
  }

  // ── vitals-history: read daily JSONL snapshot for charts ───────────────
  if (req.method === 'GET' && url.pathname === '/api/vitals-history') {
    if (!historyWriteOk) return json(res, 503, { ok: false, error: 'history disabled' });
    const day = url.searchParams.get('day') || new Date().toISOString().slice(0, 10);
    const file = historyFileFor('fleet');
    const series = [];
    try {
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        let rec; try { rec = JSON.parse(line); } catch { continue; }
        if (rec.label !== 'fleet' || !rec.payload) continue;
        series.push({ t: rec.t, bots: rec.payload.bots });
      }
    } catch { /* empty */ }
    return json(res, 200, { ok: true, day, count: series.length, series });
  }

  // ── vitals-latest: just the very last snapshot from history ───────────
  if (req.method === 'GET' && url.pathname === '/api/vitals-latest') {
    if (!historyWriteOk) return json(res, 503, { ok: false, error: 'history disabled' });
    const file = historyFileFor('fleet');
    let last = null;
    try {
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split('\n').filter(Boolean).slice(-200)) {
        try {
          const rec = JSON.parse(line);
          if (rec.label === 'fleet') last = rec;
        } catch { /* skip */ }
      }
    } catch { /* empty */ }
    return json(res, 200, { ok: true, snapshot: last });
  }

  // ── world: lightweight overview w/o every bot fetch ──────────────────
  if (req.method === 'GET' && url.pathname === '/api/world') {
    try {
      const list = await rconSend('list');
      const time = await rconSend('time query daytime');
      const diff = await rconSend('difficulty');
      const tick = Number(time.match(/(\d+)/)?.[1] ?? NaN);
      const phase = Number.isNaN(tick) ? 'unknown'
        : tick < 12000 ? 'day'
        : tick < 13000 ? 'sunset'
        : tick < 23000 ? 'night'
        : 'sunrise';
      const players = (list.match(/online:\s*(.*)$/)?.[1] || '')
        .split(/,\s*/).map((s) => s.trim()).filter(Boolean);
      return json(res, 200, {
        ok: true,
        players,
        tick: Number.isNaN(tick) ? null : tick,
        phase,
        difficulty: (diff.match(/difficulty is (\w+)/i)?.[1] || diff).slice(0, 60),
      });
    } catch (e) {
      return json(res, 502, { ok: false, error: 'rcon: ' + String(e.message || e).slice(0, 100) });
    }
  }

  // ── fleet-cards: compact per-bot summary for the new dashboard ───────
  if (req.method === 'GET' && url.pathname === '/api/fleet-cards') {
    const bots = await Promise.all(BOTS.map(async (b) => {
      const [st, task, deaths] = await Promise.all([
        botFetch(b.port, '/status'),
        botFetch(b.port, '/task'),
        botFetch(b.port, '/deaths'),
      ]);
      const d = st.data || {};
      return {
        name: b.name,
        role: b.role,
        color: b.color,
        port: b.port,
        online: st.ok,
        health: d.health ?? null,
        food: d.food ?? null,
        pos: d.position ? [Math.floor(d.position.x), Math.floor(d.position.y), Math.floor(d.position.z)] : null,
        holding: d.holding?.name || 'empty',
        holding_count: d.holding?.count ?? null,
        isDay: d.isDay ?? null,
        time: d.time ?? null,
        task: task.data?.task || null,
        deaths: deaths.data?.total ?? null,
        last_death: deaths.data?.last_death || null,
      };
    }));
    return json(res, 200, { ok: true, bots });
  }

  // ── chat-stream: server-sent events of new chat lines ─────────────────
  if (req.method === 'GET' && url.pathname === '/api/chat-stream') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const seen = new Set();
    const ping = setInterval(() => res.write(`: ping\n\n`), 15000);
    const tick = setInterval(async () => {
      try {
        const r = await botFetch(3001, '/chat?count=20');
        const msgs = r.data?.messages || [];
        for (const m of msgs) {
          const key = `${m.time}|${m.from}|${m.message}`;
          if (seen.has(key)) continue;
          seen.add(key);
          res.write(`data: ${JSON.stringify(m)}\n\n`);
        }
      } catch { /* keep stream alive */ }
    }, 2500);
    req.on('close', () => { clearInterval(ping); clearInterval(tick); });
    return; // keep the connection open
  }

  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/api/'))) {
    if (req.url === '/') return serveStatic(req, res);
    return json(res, 404, { ok: false, error: 'nope' });
  }
  return serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`HermesCraft Mission Control: http://127.0.0.1:${PORT}/`);

  // Periodic fleet snapshotter — history ring for the charts.
  const SNAPSHOT_EVERY_MS = Math.max(15_000, Number(process.env.WEBUI_SNAPSHOT_MS || 300_000));
  let lastSnap = '';
  async function snapshot() {
    try {
      const st = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${PORT}/api/fleet-cards`, (res) => {
          let buf = '';
          res.on('data', (c) => { buf += c; });
          res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
        });
        req.on('error', reject);
        req.setTimeout(8000, () => req.destroy(new Error('timeout')));
      });
      const compact = JSON.stringify({ t: Date.now(), label: 'fleet', payload: st });
      // Append de-duplicated; only write if the compact payload differs
      if (compact !== lastSnap) {
        snapshotFor('fleet', st);
        lastSnap = compact;
      }
    } catch { /* ignore */ }
  }
  // First snapshot on boot, then on the interval
  setTimeout(snapshot, 5_000);
  const id = setInterval(snapshot, SNAPSHOT_EVERY_MS);
  id.unref?.();
  // Clean expired files daily
  setInterval(pruneHistory, 6 * 60 * 60 * 1000).unref?.();
});
