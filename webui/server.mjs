import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WEBUI_PORT || 3100);

const BOTS = [
  { name: 'HermesBot', port: 3001, role: 'Coordinator', color: '#5865f2' },
  { name: 'Steve', port: 3011, role: 'Planner · Carpenter', color: '#57a25c' },
  { name: 'Reed', port: 3012, role: 'Builder', color: '#c98a3b' },
  { name: 'Moss', port: 3013, role: 'Farmer', color: '#6abe30' },
  { name: 'Flint', port: 3014, role: 'Miner', color: '#8e8e93' },
  { name: 'Ember', port: 3015, role: 'Scout · Defender', color: '#e0643a' },
];
const YARD = {
  HermesBot: [50, 63, 85], Steve: [44, 63, 85], Reed: [56, 63, 85],
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
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'text/plain' });
    res.end(data);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 8000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const botByName = (n) => BOTS.find((b) => b.name === n);

  // ── state: one snapshot for the whole village ──
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const ctrl = await botFetch(3003, '/health');
    const ctrlByName = Object.fromEntries((ctrl.minions || []).map((m) => [m.name, m]));
    const bots = await Promise.all(BOTS.map(async (b) => {
      const [st, task, deaths] = await Promise.all([
        botFetch(b.port, '/status'),
        botFetch(b.port, '/task'),
        botFetch(b.port, '/deaths'),
      ]);
      const d = st.data || {};
      const c = ctrlByName[b.name] || {};
      // HermesBot runs via the bridge, not the controller — no thinks/last_action.
      // Fall back to its live task so the dashboard never shows "?".
      const liveTask = task.data?.task;
      const fallbackAction = liveTask
        ? `task | ${liveTask.action}${liveTask.status ? ` (${liveTask.status})` : ''} -> ${String(liveTask.result?.result || liveTask.error || 'running').slice(0, 100)}`
        : 'bridge-driven — see team radio';
      return {
        name: b.name, role: c.role || b.role, color: b.color, port: b.port,
        online: st.ok === true,
        paused: !!c.paused, interval_ms: c.interval_ms || null, ticks: c.ticks ?? null,
        last_action: ((c.last_action || '') || fallbackAction).slice(0, 160),
        health: d.health ?? null, food: d.food ?? null,
        pos: d.position ? [Math.floor(d.position.x), Math.floor(d.position.y), Math.floor(d.position.z)] : null,
        holding: d.holding?.name || 'empty',
        invCount: d.inventoryCount ?? (d.inventory || []).length,
        time: d.timePhase || (d.isDay ? 'day' : 'night'),
        task: task.data?.task || null,
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
  // ── team radio: controller PLAN/claim/ack feed ──
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
      const queueAll = (action, argsFor) => Promise.all(BOTS.filter((b) => b.name !== 'HermesBot').map((b) =>
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
      const systemOrders = system + `\nYou can also ACT. To act, end your reply with a fenced block like:\n\`\`\`orders\n[{"do":"say","message":"come with me"},{"do":"queue","bot":"Moss","action":"till","args":{"count":4}},{"do":"goal","goal":"..."},{"do":"pause","bot":"Flint","paused":true}]\n\`\`\`\nRules: "say" sends chat to ALL bots unless "target" names one bot (must be HermesBot, Steve, Reed, Moss, Flint or Ember). "queue" action must be one of bg_goto, goto_near, collect, craft, smelt, eat, sleep_bed, till, sow, harvest, breed, shear, milk, fish, follow, flee, wait. Only include orders the user actually asked for; at most 6.`;
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

  // ── manage: one-click bot care ──
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

  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/api/'))) {
    if (req.url === '/') return serveStatic(req, res);
    return json(res, 404, { ok: false, error: 'nope' });
  }
  return serveStatic(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`HermesCraft Mission Control: http://127.0.0.1:${PORT}/`);
});
