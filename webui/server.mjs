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

  // ── state: one snapshot for the whole village ──
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const ctrl = await botFetch(3003, '/health');
    const ctrlByName = Object.fromEntries((ctrl.minions || []).map((m) => [m.name, m]));
    const bots = await Promise.all(BOTS.map(async (b) => {
      const [st, task] = await Promise.all([
        botFetch(b.port, '/status'),
        botFetch(b.port, '/task'),
      ]);
      const d = st.data || {};
      const c = ctrlByName[b.name] || {};
      return {
        name: b.name, role: c.role || b.role, color: b.color, port: b.port,
        online: st.ok === true,
        paused: !!c.paused, interval_ms: c.interval_ms || null, ticks: c.ticks ?? null,
        last_action: (c.last_action || '').slice(0, 160),
        health: d.health ?? null, food: d.food ?? null,
        pos: d.position ? [Math.floor(d.position.x), Math.floor(d.position.y), Math.floor(d.position.z)] : null,
        holding: d.holding?.name || 'empty',
        invCount: d.inventoryCount ?? (d.inventory || []).length,
        time: d.timePhase || (d.isDay ? 'day' : 'night'),
        task: task.data?.task || null,
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
  // ── queue: line up tasks per bot (FIFO on the bot server) ──
  const QUEUE_ACTIONS = {
    bg_goto: ['x', 'y', 'z'], goto_near: ['x', 'y', 'z'], collect: ['block', 'count'],
    dig: ['x', 'y', 'z'], craft: ['item'], smelt: ['item'], eat: [], sleep_bed: [],
    till: ['count'], sow: ['seed', 'count'], harvest: [], breed: ['animal'],
    shear: [], milk: [], fish: ['seconds'], follow: ['name'], flee: ['radius'], wait: ['seconds'],
  };
  const botByName = (n) => BOTS.find((b) => b.name === n);
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
      const r = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'ornith-1.5-9b', messages: [{ role: 'system', content: system }, { role: 'user', content: question }], max_tokens: 400, temperature: 0.7 }),
        signal: AbortSignal.timeout(90000),
      });
      const data = await r.json().catch(() => ({}));
      let text = data.choices?.[0]?.message?.content?.trim() || data.choices?.[0]?.message?.reasoning_content?.trim() || '';
      if (!text) return json(res, 502, { ok: false, error: 'empty answer from model' });
      return json(res, 200, { ok: true, reply: text.slice(0, 2000) });
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
