// ─────────────────────────────────────────────────────────────────────
// HermesCraft Mission Control 2.0 — single-file SPA client
// ─────────────────────────────────────────────────────────────────────
// Renders the Linear-inspired dark dashboard. Talks to:
//   GET  /api/fleet-cards   — compact bot snapshot (HP, food, pos, task)
//   GET  /api/world         — server-wide status (time, players, difficulty)
//   GET  /api/chat          — live chat (poll fallback)
//   GET  /api/chat-stream   — server-sent events (preferred)
//   GET  /api/leaderboard   — daily death counts from history
//   GET  /api/vitals-history — line chart samples
//   POST /api/say           — public chat / DM
//   POST /api/ask           — AI advisor
//   POST /api/goal          — set the village goal
//   POST /api/admin         — time / weather / difficulty / save / give
//   POST /api/broadcast     — queue-all shortcuts
//   POST /api/queue         — queue a bot task
//   GET  /api/terrain       — top-down surface render
//   GET  /api/activity      — chat + control + deaths feed
//   GET  /api/inventories   — every bot's bag
//   GET  /api/hermescraft   — HermesCraft modes catalog
//   GET  /api/models        — LM Studio
//   POST /api/model         — switch model
//   GET  /api/intelligence  — observe-only ledger
//   POST /api/intelligence/proposal
//   GET  /api/state         — legacy overview (used by sidebar)
// ─────────────────────────────────────────────────────────────────────

const API = '/api';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const PALETTE = {
  DuckBot: '#5e6ad2', Steve: '#57a25c', Reed: '#c98a3b',
  Moss: '#6abe30', Flint: '#8e8e93', Ember: '#e0643a',
};
const ROLES = {
  DuckBot: 'Coordinator', Steve: 'Foreman · Carpenter', Reed: 'Builder',
  Moss: 'Farmer', Flint: 'Miner', Ember: 'Scout · Defender',
};

const SETTINGS = {
  refreshMs: 3000,
  chatTarget: '',
};
try {
  const raw = localStorage.getItem('mc2.settings');
  if (raw) Object.assign(SETTINGS, JSON.parse(raw));
} catch { /* ignore */ }
function saveSettings() {
  try { localStorage.setItem('mc2.settings', JSON.stringify(SETTINGS)); } catch {}
}

const STATE = {
  fleet: [], // last fleet-cards payload
  world: null,
  chat: [], messages: [],
  selectedBot: null,
  view: 'live',
  filters: { chat: '', chatOverheard: true },
  history: [], // {t, bots}
  fleetCache: new Map(), // name -> last seen
  inFlight: new Set(),
};

// ── helpers ───────────────────────────────────────────────────────────

function fetchJSON(path, opts = {}) {
  return fetch(API + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(async (r) => {
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return { ok: false, status: r.status, error: `${r.status} ${r.statusText}` };
    const data = await r.json().catch(() => ({ ok: false, error: 'bad json' }));
    return data;
  }).catch((e) => ({ ok: false, error: String(e.message || e) }));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, args), ms); };
}

function fmtClock(tick) {
  if (tick == null) return '—';
  const phase = (tick % 24000);
  const hour = Math.floor(phase / 1000);
  const min = Math.floor((phase % 1000) * 60 / 1000);
  return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function fmtSince(ms) {
  if (!ms) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

function toast(msg, kind = 'ok', ttl = 3500) {
  const wrap = $('#toast');
  const div = document.createElement('div');
  div.className = `toast ${kind}`;
  div.textContent = msg;
  wrap.appendChild(div);
  setTimeout(() => div.remove(), ttl);
}

// ── world + clock + phase ────────────────────────────────────────────

function renderWorld(w) {
  if (!w) return;
  const tick = w.tick ?? 0;
  const phase = w.phase || 'day';
  const phaseEl = $('#phase-arc');
  if (phaseEl) phaseEl.style.transform = `rotate(${(tick / 24000) * 360}deg)`;
  const timeStr = fmtClock(tick);
  const timeEl = $('#phase-time');
  if (timeEl) timeEl.textContent = timeStr;
  const subEl = $('#phase-sub');
  if (subEl) subEl.textContent = phase;
  $('#w-players').textContent = (w.players || []).join(', ') || '—';
  $('#w-difficulty').textContent = w.difficulty || '—';
  $('#w-phase').textContent = phase;
  $('#w-tick').textContent = tick ?? '—';
  $('#world-updated').textContent = `updated ${new Date().toLocaleTimeString()}`;

  // top pills
  $('#pill-world-text').textContent = `${phase} • ${(w.players || []).length} online`;
  $('#pill-world').dataset.state = (w.players || []).length > 0 ? 'ok' : 'warn';
  $('#dot-world').className = 'dot ' + ((w.players || []).length > 0 ? 'dot-ok' : 'dot-warn');

  // sun-on-track
  const sun = $('#time-bar-sun');
  if (sun) sun.style.left = `${(tick / 24000) * 100}%`;
  const label = $('#time-bar-label');
  if (label) label.textContent = `${phase} • tick ${tick}`;
}

function tickClock() {
  const t = new Date().toLocaleTimeString();
  const clk = $('#clock');
  if (clk) clk.textContent = t;
  const phase = $('#phase-sub')?.textContent || '';
  const tick = parseInt($('#w-tick')?.textContent || '0', 10);
  if (Number.isFinite(tick)) {
    const next = (tick + 20) % 24000;
    $('#w-phase').textContent = phase; // keep label
    $('#phase-time').textContent = fmtClock(next);
  }
}

// ── fleet ─────────────────────────────────────────────────────────────

function renderFleet(bots) {
  STATE.fleet = bots;
  const rail = $('#fleet-rail');
  const grid = $('#fleet-grid');
  if (!bots || !bots.length) {
    rail.innerHTML = `<li class="ph">no bots</li>`;
    grid.innerHTML = `<div class="ph">no bots</div>`;
    return;
  }
  rail.innerHTML = bots.map((b) => {
    const c = PALETTE[b.name] || '#5e6ad2';
    const hp = Number(b.health);
    const fd = Number(b.food);
    const hpClass = hp < 4 ? 'critical' : (hp < 10 ? 'low' : '');
    const fdClass = fd < 6 ? 'low' : '';
    const dotClass = !b.online ? 'dot-err' : (hp < 6 ? 'dot-warn' : 'dot-ok');
    return `<li class="bot-tile ${b.online ? '' : 'offline'} ${hp < 6 ? 'lowHP' : ''}" data-bot="${esc(b.name)}" tabindex="0">
      <div class="bot-avatar" style="background:${c}">${b.name[0]}
        <span class="status-dot ${dotClass}"></span>
      </div>
      <div class="bot-row-text">
        <div class="bot-name">${esc(b.name)}</div>
        <div class="bot-vitals">
          <span>♥<span>${hp == null ? '?' : hp.toFixed(0)}</span></span>
          <span class="hp-bar"><span class="${hpClass}" style="width:${Math.max(0, Math.min(100, hp * 5))}%"></span></span>
          <span>🍖${fd == null ? '?' : fd}</span>
          <span class="food-bar"><span class="${fdClass}" style="width:${Math.max(0, Math.min(100, fd * 5))}%"></span></span>
        </div>
      </div>
    </li>`;
  }).join('');
  grid.innerHTML = bots.map((b) => {
    const c = PALETTE[b.name] || '#5e6ad2';
    const hp = Number(b.health);
    const fd = Number(b.food);
    const hpClass = hp < 4 ? 'critical' : (hp < 10 ? 'low' : '');
    const lastDeath = b.last_death ? `died ${fmtSince(Date.now() - new Date(Date.now() - (b.last_death.seconds_ago || 0) * 1000).getTime())} ago: ${esc(b.last_death.cause || '')}` : '';
    return `<article class="bot-card ${b.online ? '' : 'offline'} ${hp < 6 ? 'lowHP' : ''}" data-bot="${esc(b.name)}" tabindex="0">
      <div class="bot-card-head">
        <span class="bot-avatar" style="background:${c}; width:28px;height:28px;font-size:12px">${b.name[0]}</span>
        <span class="name">${esc(b.name)}</span>
        <span class="port">:${b.port}</span>
      </div>
      <div class="bars">
        <div class="bar-wrap"><span>HP</span><div class="hp-bar"><span class="${hpClass}" style="width:${Math.max(0, Math.min(100, (hp || 0) * 5))}%"></span></div></div>
        <div class="bar-wrap"><span>FD</span><div class="food-bar"><span class="" style="width:${Math.max(0, Math.min(100, (fd || 0) * 5))}%"></span></div></div>
      </div>
      <div class="pos">${b.pos ? `📍 ${b.pos.join(', ')}` : '—'}</div>
      ${b.holding && b.holding !== 'empty' ? `<div class="pos">✋ ${esc(b.holding)}${b.holding_count ? ` ×${b.holding_count}` : ''}</div>` : ''}
      ${b.task ? `<div class="task">${esc((b.task.action || '') + (b.task.status ? ' (' + b.task.status + ')' : ''))}</div>` : ''}
      ${lastDeath ? `<div class="task" style="color:var(--err)">💀 ${lastDeath}</div>` : ''}
    </article>`;
  }).join('');

  // online pill
  const online = bots.filter((b) => b.online).length;
  $('#pill-online-text').textContent = `${online}/${bots.length}`;
  $('#pill-online').dataset.state = online === bots.length ? 'ok' : (online < bots.length - 1 ? 'err' : 'warn');
  $('#dot-online').className = 'dot ' + (online === bots.length ? 'dot-ok' : (online < bots.length - 1 ? 'dot-err' : 'dot-warn'));

  // model pill from controller view (resolved at state-level separately)
  $('#fleet-updated').textContent = `updated ${new Date().toLocaleTimeString()}`;

  wireBotClicks();
}

function wireBotClicks() {
  $$('.bot-tile, .bot-card').forEach((el) => {
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    el.addEventListener('click', () => selectBot(el.dataset.bot));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectBot(el.dataset.bot); } });
  });
}

function renderModelPill(model) {
  const txt = model ? model.replace(/^.*\//, '') : '…';
  $('#pill-model-text').textContent = txt;
  $('#pill-model').dataset.state = model ? 'brand' : '';
  $('#dot-model').className = 'dot ' + (model ? 'dot-brand' : 'dot-soft');
}

// ── selected bot / care ───────────────────────────────────────────────

function selectBot(name) {
  STATE.selectedBot = name;
  $$('.bot-tile').forEach((el) => el.classList.toggle('active', el.dataset.bot === name));
  const bot = STATE.fleet.find((b) => b.name === name);
  if (!bot) return;
  const out = $('#care-out');
  out.innerHTML = `
    <h4 style="margin:0 0 6px;font-size:14px;color:${PALETTE[name]||'inherit'}">${esc(name)}</h4>
    <dl class="kv">
      <div><dt>Health</dt><dd>${bot.health ?? '?'}</dd></div>
      <div><dt>Food</dt><dd>${bot.food ?? '?'}</dd></div>
      <div><dt>Pos</dt><dd>${bot.pos ? bot.pos.join(', ') : '—'}</dd></div>
      <div><dt>Holding</dt><dd>${esc(bot.holding || 'empty')}</dd></div>
      <div><dt>Deaths</dt><dd>${bot.deaths ?? '?'}</dd></div>
    </dl>
  `;
  const wrap = $('#care-btns');
  wrap.innerHTML = ['eat','sleep','yard','stop','inventory'].map((op) =>
    `<button type="button" data-op="${op}">${op === 'eat' ? '🍖' : op === 'sleep' ? '🛏' : op === 'yard' ? '🏠' : op === 'stop' ? '⏹' : '🎒'} ${op[0].toUpperCase()}</button>`
  ).join('');
  wrap.addEventListener('click', onCareClick, { once: false });
  // queue
  fetchJSON(`/queue?bot=${encodeURIComponent(name)}`).then((r) => {
    const list = $('#queue-list');
    const items = [];
    if (r.data?.running) items.push({ ...r.data.running, status: 'running' });
    for (const q of (r.data?.queued || [])) items.push(q);
    list.innerHTML = items.length
      ? items.map((it) => `<li class="${it.status === 'running' ? 'running' : ''}">${esc(it.action)} ${Object.entries(it.args || {}).map(([k,v]) => `${k}=${v}`).join(' ')} <span style="color:var(--t-4)">${it.status}</span></li>`).join('')
      : '<li class="ph">queue empty</li>';
  });
  fetchJSON('/queue-actions').then((r) => {
    const sel = $('#queue-action');
    sel.innerHTML = Object.entries(r.actions || {}).map(([a, args]) => `<option value="${a}">${a}</option>`).join('');
  });
}

async function onCareClick(e) {
  const op = e.target?.dataset?.op;
  if (!op) return;
  const bot = STATE.selectedBot;
  if (!bot) return;
  let path = `/bot/${encodeURIComponent(bot)}/${op === 'inventory' ? 'status' : op}`;
  // Use manage endpoint for unified ops
  const r = await fetchJSON('/manage', { method: 'POST', body: { bot, op } });
  toast(`${op} ${bot}: ${r.ok ? 'ok' : (r.error || 'fail')}`, r.ok ? 'ok' : 'err');
  if (op === 'inventory') {
    const port = STATE.fleet.find((b) => b.name === bot)?.port;
    if (port) showInventory(bot, port);
  }
}

async function showInventory(name, port) {
  const r = await fetchJSON(`/bot/${encodeURIComponent(name)}/inventory`);
  const list = $('#inv-list');
  if (r.ok && r.data) {
    const cats = r.data.categories || {};
    const flat = r.data.items || [];
    const rows = [];
    for (const cat of Object.keys(cats)) {
      for (const it of cats[cat] || []) rows.push({ category: cat, name: it.name, count: it.count });
    }
    if (!rows.length && flat.length) for (const it of flat) rows.push({ name: it.name, count: it.count });
    list.innerHTML = rows.length ? rows.map((r) => `
      <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--border-2)">
        <span>${esc(r.name)}</span><span style="color:var(--t-3);font-family:var(--font-mono)">${r.count || ''}</span>
      </div>`).join('') : '<p class="ph">empty</p>';
  } else {
    list.innerHTML = `<p class="ph">${r.error || 'offline'}</p>`;
  }
  $('#inv-title').textContent = `🎒 ${name}`;
  $('#inv-modal').classList.remove('hidden');
}

// ── chat ─────────────────────────────────────────────────────────────

let es = null;
function openEventStream() {
  if (es) try { es.close(); } catch {}
  es = new EventSource(API + '/chat-stream');
  es.addEventListener('error', () => {
    setTimeout(openEventStream, 5000);
  });
  es.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      STATE.chat.push(m);
      const seen = new Set();
      STATE.chat = STATE.chat.filter((x) => {
        const k = x.time + '|' + x.from + '|' + x.message;
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
      if (STATE.chat.length > 400) STATE.chat = STATE.chat.slice(-400);
      renderMessages();
    } catch {}
  };
}

function renderMessages() {
  const messages = $('#messages');
  if (!messages) return;
  const filter = STATE.filters.chat.trim().toLowerCase();
  const showOverheard = STATE.filters.chatOverheard;
  const rows = STATE.chat.filter((m) => {
    if (!showOverheard && m.overheard) return false;
    if (filter && !(`${m.from} ${m.message}`.toLowerCase().includes(filter))) return false;
    if (STATE.settings?.chatTarget && m.from !== STATE.settings.chatTarget && !m.message.includes(STATE.settings.chatTarget)) return false;
    return true;
  });
  rows.sort((a, b) => a.time - b.time);
  messages.innerHTML = rows.slice(-200).map((m) => {
    const t = new Date(m.time).toLocaleTimeString();
    const cls = m.overheard ? 'overheard' : (m.private ? 'direct bot player' : 'bot');
    return `<div class="msg ${cls}" data-time="${m.time}" data-from="${esc(m.from)}">
      <span class="when">${t}</span>
      <div><span class="who">${esc(m.from)}</span> <span class="body">${esc(m.message)}</span></div>
    </div>`;
  }).join('');
  messages.scrollTop = messages.scrollHeight;
}

async function refreshChat() {
  const r = await fetchJSON('/chat?count=80');
  if (r.ok && Array.isArray(r.messages)) {
    const seen = new Set();
    STATE.chat = r.messages.filter((m) => {
      const k = m.time + '|' + m.from + '|' + m.message;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    renderMessages();
  }
}

async function sendChat(e) {
  e.preventDefault();
  const input = $('#input');
  const msg = input.value.trim();
  if (!msg) return;
  const targetMatch = msg.match(/^([A-Za-z]+):\s*(.*)$/);
  if (targetMatch && ['DuckBot','Steve','Reed','Moss','Flint','Ember'].includes(targetMatch[1])) {
    await fetchJSON('/say', { method: 'POST', body: { message: targetMatch[2], target: targetMatch[1] } });
    STATE.chat.push({ time: Date.now(), from: 'Duckets (web)', message: `${targetMatch[1]}: ${targetMatch[2]}`, private: true, channel: `dm:${targetMatch[1]}` });
  } else {
    await fetchJSON('/say', { method: 'POST', body: { message: msg } });
    STATE.chat.push({ time: Date.now(), from: 'Duckets (web)', message: msg });
  }
  input.value = '';
  renderMessages();
  refreshChat();
}

// ── feed ─────────────────────────────────────────────────────────────

function renderFeed(events) {
  const list = $('#feed');
  if (!list) return;
  if (!Array.isArray(events) || !events.length) {
    list.innerHTML = `<li class="ph">no events yet</li>`;
    return;
  }
  list.innerHTML = events.slice(0, 60).map((e) => {
    const t = new Date(e.time).toLocaleTimeString();
    const cls = e.kind === 'death' ? 'err' : (e.kind === 'control' ? 'brand' : '');
    return `<li>
      <span class="ts">${t}</span>
      <span><span class="kind">${esc(e.kind)}</span> <span class="body">${esc(e.title)}: ${esc(e.detail)}</span></span>
    </li>`;
  }).join('');
}

// ── leaderboard ──────────────────────────────────────────────────────

function renderLeaders(leaders) {
  const ol = $('#leaders');
  if (!ol) return;
  if (!Array.isArray(leaders) || !leaders.length) {
    ol.innerHTML = `<li class="ph">no data yet</li>`;
    return;
  }
  ol.innerHTML = leaders.map((l, i) => `
    <li>
      <span class="rank">#${i + 1}</span>
      <span class="who" style="color:${PALETTE[l.name] || 'inherit'}">${esc(l.name)}</span>
      <span class="stat">${l.deaths} 💀 · ${l.lowHP} ⚠ · ${l.active} ♻</span>
    </li>`).join('');
  $('#leaders-updated').textContent = `updated ${new Date().toLocaleTimeString()}`;
}

// ── charts ───────────────────────────────────────────────────────────

function renderHpChart() {
  const canvas = $('#chart-hp');
  if (!canvas) return;
  if (!STATE.history.length) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth; canvas.height = 220;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0f1011'; ctx.fillRect(0, 0, w, h);
  ctx.font = '10px JetBrains Mono';
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = (g * h) / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillStyle = '#62666d'; ctx.fillText(`${20 - g * 5}`, 4, y - 2);
  }
  const ts = STATE.history.map((s) => s.t);
  const minT = ts[0], maxT = ts[ts.length - 1];
  if (maxT === minT) return;
  for (const name of Object.keys(PALETTE)) {
    const points = STATE.history.map((s) => {
      const b = s.bots.find((x) => x.name === name);
      if (!b || b.health == null) return null;
      const x = ((s.t - minT) / (maxT - minT)) * w;
      const y = h - (Math.max(0, Math.min(20, b.health)) / 20) * h;
      return [x, y];
    }).filter(Boolean);
    if (points.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = PALETTE[name];
    ctx.lineWidth = 1.4;
    points.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = PALETTE[name];
    points.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill(); });
    // legend label
    const last = points[points.length - 1];
    if (last) {
      ctx.font = '11px Inter';
      ctx.fillText(`${name[0]}`, last[0] + 4, last[1] - 4);
    }
  }
  ctx.font = '10px JetBrains Mono';
  ctx.fillStyle = '#62666d';
  ctx.fillText(`${new Date(minT).toLocaleTimeString()} – ${new Date(maxT).toLocaleTimeString()}`, 4, h - 6);
}

function renderFoodChart() {
  const canvas = $('#chart-food');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth; canvas.height = 220;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0f1011'; ctx.fillRect(0, 0, w, h);
  if (!STATE.history.length) return;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = (g * h) / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillStyle = '#62666d'; ctx.fillText(`${20 - g * 5}`, 4, y - 2);
  }
  const ts = STATE.history.map((s) => s.t);
  const minT = ts[0], maxT = ts[ts.length - 1];
  for (const name of Object.keys(PALETTE)) {
    const points = STATE.history.map((s) => {
      const b = s.bots.find((x) => x.name === name);
      if (!b || b.food == null) return null;
      const x = ((s.t - minT) / (maxT - minT)) * w;
      const y = h - (Math.max(0, Math.min(20, b.food)) / 20) * h;
      return [x, y];
    }).filter(Boolean);
    if (points.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = PALETTE[name] + 'aa';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    points.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function renderHeatmap() {
  const canvas = $('#map-heatmap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.clientWidth; canvas.height = 500;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0b0d'; ctx.fillRect(0, 0, w, h);
  if (!STATE.history.length) return;
  // Compute bounds of all positions
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of STATE.history) {
    for (const b of s.bots || []) {
      if (!b.pos) continue;
      minX = Math.min(minX, b.pos[0]); maxX = Math.max(maxX, b.pos[0]);
      minZ = Math.min(minZ, b.pos[2]); maxZ = Math.max(maxZ, b.pos[2]);
    }
  }
  if (!isFinite(minX)) return;
  const pad = 32;
  const sx = (x) => pad + ((x - minX) / (maxX - minX || 1)) * (w - pad * 2);
  const sz = (z) => pad + ((z - minZ) / (maxZ - minZ || 1)) * (h - pad * 2);
  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  for (let x = minX; x <= maxX; x += 8) {
    ctx.beginPath(); ctx.moveTo(sx(x), pad); ctx.lineTo(sx(x), h - pad); ctx.stroke();
  }
  for (let z = minZ; z <= maxZ; z += 8) {
    ctx.beginPath(); ctx.moveTo(pad, sz(z)); ctx.lineTo(w - pad, sz(z)); ctx.stroke();
  }
  // points per bot
  for (const name of Object.keys(PALETTE)) {
    const pts = STATE.history.map((s) => {
      const b = s.bots.find((x) => x.name === name);
      if (!b || !b.pos) return null;
      return [sx(b.pos[0]), sz(b.pos[2])];
    }).filter(Boolean);
    if (!pts.length) continue;
    ctx.fillStyle = PALETTE[name] + '60';
    pts.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); });
    // label
    const last = pts[pts.length - 1];
    ctx.fillStyle = PALETTE[name];
    ctx.font = '11px Inter'; ctx.fillText(name, last[0] + 4, last[1]);
  }
}

// ── map ──────────────────────────────────────────────────────────────

const MAP = {
  tileImg: null,
  cx: 50, cz: 85,
  follow: 'DuckBot',
  zoom: 1,
  loading: false,
};

function drawMapPin(ctx, x, y, label, color) {
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '600 11px Inter';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y);
}

async function refreshMap() {
  const canvas = $('#map');
  const readout = $('#map-readout');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (MAP.loading) return;
  MAP.loading = true;
  const grid = await fetchJSON(`/terrain?cx=${MAP.cx}&cz=${MAP.cz}&size=192`);
  MAP.loading = false;
  if (!grid.ok) { readout.textContent = `terrain error: ${grid.error}`; return; }
  const px = 16; // pixel size per block
  const tiles = (grid.tiles || []);
  // canvas size
  canvas.width = tiles.length ? tiles[0].length * px : 900;
  canvas.height = tiles.length ? tiles.length * px : 900;
  // First, draw blocks
  for (let y = 0; y < tiles.length; y++) {
    const row = tiles[y];
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      const px_x = x * px, px_y = y * px;
      ctx.fillStyle = c;
      ctx.fillRect(px_x, px_y, px, px);
    }
  }
  // Then bot pins
  if (STATE.fleet) {
    const cx = tiles[0]?.length / 2 + grid.cx - MAP.cx;
    const cy = tiles.length / 2 + grid.cz - MAP.cz;
    for (const b of STATE.fleet) {
      if (!b.pos) continue;
      const dx = b.pos[0] - (MAP.cx - 96);
      const dz = b.pos[2] - (MAP.cz - 96);
      const px_x = dx * 16;
      const px_y = dz * 16;
      if (px_x < 0 || px_y < 0 || px_x > canvas.width || px_y > canvas.height) continue;
      drawMapPin(ctx, px_x, px_y, b.name, PALETTE[b.name]);
    }
    readout.textContent = `${STATE.fleet.length} bots drawn • center ${MAP.cx},${MAP.cz}`;
  }
  // Mark center
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0); ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.moveTo(0, canvas.height / 2); ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke(); ctx.setLineDash([]);
}

// ─- refresh loops ────────────────────────────────────────────────────

async function refreshFleetCards() {
  const r = await fetchJSON('/fleet-cards');
  if (r.ok) renderFleet(r.bots || []);
}

async function refreshWorld() {
  const r = await fetchJSON('/world');
  if (r.ok) {
    STATE.world = r;
    renderWorld(r);
  }
}

async function refreshState() {
  const r = await fetchJSON('/state');
  if (r.ok) renderModelPill(r.controller?.lms_url ? 'ornith-1.5-9b' : null);
}

async function refreshFeed() {
  const r = await fetchJSON('/activity?count=20');
  if (r.ok) renderFeed(r.events || []);
}

async function refreshLeaders() {
  const r = await fetchJSON('/leaderboard');
  if (r.ok) renderLeaders(r.leaders || []);
}

async function refreshVitalsHistory() {
  if (STATE.view !== 'vitals') return;
  const r = await fetchJSON('/vitals-history');
  if (r.ok) {
    STATE.history = (r.series || []).map((s) => ({ t: s.t, bots: s.bots }));
    renderHpChart();
    renderFoodChart();
    renderHeatmap();
    $('#vitals-day').textContent = r.day || 'today';
  }
}

async function refreshAll() {
  await Promise.all([
    refreshFleetCards(),
    refreshWorld(),
    refreshState(),
    refreshFeed(),
    refreshLeaders(),
    refreshVitalsHistory(),
  ]);
  if (STATE.selectedBot) selectBot(STATE.selectedBot);
  // refresh map if visible
  if (STATE.view === 'map') refreshMap();
}

// ─- ask / advisor ────────────────────────────────────────────────────

async function askAdvisor() {
  const form = $('#ask-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#ask-input');
    const out = $('#ask-out');
    const did = $('#ask-did');
    const message = input.value.trim();
    if (!message) return;
    out.textContent = 'thinking…';
    did.innerHTML = '';
    const r = await fetchJSON('/ask', { method: 'POST', body: { message } });
    if (!r.ok) { out.textContent = `error: ${r.error}`; return; }
    out.textContent = r.reply || '(no answer)';
    if (r.did && r.did.length) {
      did.innerHTML = r.did.map((d) => `<span class="did">${esc(d)}</span>`).join('');
    }
    input.value = '';
    refreshAll();
  });
}

// ─- intelligence ledger ─────────────────────────────────────────────

async function refreshIntelligence() {
  const r = await fetchJSON('/intelligence');
  const list = $('#intel-list');
  if (!list) return;
  if (!r.ok) { list.innerHTML = `<li class="ph">${r.error || 'load failed'}</li>`; return; }
  const items = r.proposals || [];
  list.innerHTML = items.length ? items.map((it) => `
    <li>
      <div><span class="src">${esc(it.source || '')}</span><span class="at">${new Date(it.at).toLocaleTimeString()}</span></div>
      <div>${esc(it.content || '')}</div>
    </li>`).join('') : '<li class="ph">no proposals yet</li>';
}

// ─- goal ─────────────────────────────────────────────────────────────

async function refreshGoal() {
  const out = $('#goal-current');
  if (out) out.textContent = STATE.goal || '—';
}

async function setGoal(e) {
  if (e) e.preventDefault();
  const goal = $('#goal-input').value.trim();
  if (!goal) return;
  const r = await fetchJSON('/goal', { method: 'POST', body: { goal, from: 'Duckets (web)' } });
  if (r.ok) {
    STATE.goal = goal;
    refreshGoal();
    toast('goal set', 'ok');
    $('#goal-input').value = '';
  } else {
    toast(`goal failed: ${r.error}`, 'err');
  }
}

// ─- quick actions ────────────────────────────────────────────────────

async function broadcast(op) {
  const r = await fetchJSON('/broadcast', { method: 'POST', body: { op } });
  toast(`${op}: ${r.ok ? 'sent' : (r.error || 'fail')}`, r.ok ? 'ok' : 'err');
  setTimeout(refreshAll, 600);
}

// ─- inventory grid ──────────────────────────────────────────────────

async function refreshInventories() {
  const r = await fetchJSON('/inventories');
  if (!r.ok) return;
  const wrap = $('#inv-grid');
  if (!wrap) return;
  wrap.innerHTML = Object.entries(r.inventories || {}).map(([name, inv]) => {
    const rows = [];
    if (inv.categories) {
      for (const cat of Object.keys(inv.categories)) {
        for (const it of (inv.categories[cat] || [])) rows.push(`${it.name} ×${it.count || 1}`);
      }
    } else if (inv.items) {
      for (const it of inv.items) rows.push(`${it.name} ×${it.count || 1}`);
    }
    return `<div class="inv-cell"><h4>${esc(name)}</h4><ul>${rows.map((r) => `<li><span>${esc(r.split('×')[0])}</span><span>×${esc(r.split('×')[1] || '')}</span></li>`).join('') || '<li><span style="color:var(--t-4)">empty</span></li>'}</ul></div>`;
  }).join('');
}

// ─- models ──────────────────────────────────────────────────────────

async function refreshModels() {
  const r = await fetchJSON('/models');
  const sel = $('#model-pick');
  if (!sel) return;
  if (!r.ok) { sel.innerHTML = `<option>${r.error || 'LM Studio unreachable'}</option>`; return; }
  sel.innerHTML = `<option value="">— pick a model —</option>` +
    r.models.map((m) => `<option value="${esc(m.id)}">${esc(m.id)}</option>`).join('');
}

async function setModel() {
  const id = $('#model-pick').value.trim();
  const bot = $('#model-bot').value;
  if (!id) { toast('choose a model', 'warn'); return; }
  if (bot === 'all') {
    for (const name of ['DuckBot','Steve','Reed','Moss','Flint','Ember']) {
      await fetchJSON('/model', { method: 'POST', body: { name, model: id } });
    }
  } else {
    await fetchJSON('/model', { method: 'POST', body: { name: bot, model: id } });
  }
  toast(`model → ${id}`, 'ok');
  refreshAll();
}

// ─- admin ────────────────────────────────────────────────────────────

async function adminSubmit(e) {
  if (e) e.preventDefault();
  const op = $('#admin-op').value;
  const val = $('#admin-value').value.trim();
  const out = $('#admin-out');
  out.textContent = 'running…';
  const body = { op };
  if (op !== 'save') body.value = val;
  const r = await fetchJSON('/admin', { method: 'POST', body });
  out.textContent = r.ok ? `✅ ${r.result || 'ok'}` : `❌ ${r.error}`;
}

async function giveSubmit(e) {
  if (e) e.preventDefault();
  const target = $('#give-target').value;
  const item = $('#give-item').value.trim().replace(/^minecraft:/, '');
  const count = Math.max(1, Math.min(64, Number($('#give-count').value) || 1));
  const out = $('#give-out');
  out.textContent = 'running…';
  const r = await fetchJSON('/admin', { method: 'POST', body: { op: 'give', target, item, count } });
  out.textContent = r.ok ? `✅ ${r.result || 'gave'}` : `❌ ${r.error}`;
}

// ─- safety ───────────────────────────────────────────────────────────

async function refreshSafety() {
  const list = $('#safety-list');
  if (!list) return;
  if (!STATE.fleet.length) { list.innerHTML = '<li class="ph">loading…</li>'; return; }
  list.innerHTML = STATE.fleet.map((b) => {
    const hp = Number(b.health), fd = Number(b.food);
    let badge, klass = 'ok';
    if (!b.online || hp < 1) { badge = 'DOWN'; klass = 'err'; }
    else if (hp < 6) { badge = 'LOW HP'; klass = 'err'; }
    else if (fd < 6) { badge = 'LOW FOOD'; klass = 'warn'; }
    else if (hp < 12) { badge = 'COLD'; klass = 'warn'; }
    else { badge = 'OK'; klass = 'ok'; }
    const task = b.task ? `${b.task.action}${b.task.status ? ' (' + b.task.status + ')' : ''}` : 'idle';
    return `<li>
      <span class="who" style="color:${PALETTE[b.name]||'inherit'}">${esc(b.name)}</span>
      <span>${b.online ? `HP ${hp.toFixed(1)} · 🍖 ${fd} · ${esc(task)}` : '<span style="color:var(--err)">offline</span>'}</span>
      <span class="badge ${klass}">${badge}</span>
    </li>`;
  }).join('');
}

// ─- hermescraft integration ──────────────────────────────────────────

async function refreshHermesCraft() {
  const r = await fetchJSON('/hermescraft');
  if (!r.ok) return;
  // modes
  const modes = $('#mode-cards');
  if (modes) modes.innerHTML = (r.mode_details ? Object.values(r.mode_details) : []).map((m) => {
    const a = m.deployment_summary || {};
    const aOnline = (a.runtime_status || []).filter((x) => x.online).length;
    return `<div class="cap" style="margin-bottom:8px">
      <b>${esc(m.name || m.id)}</b>
      <p>${esc(m.id)} · ${a.agent_count || 0} configured · ${aOnline} online · state: ${esc(a.launch_policy || '?')}</p>
      ${a.runtime_status?.length ? `<p style="font:11px var(--font-mono);color:var(--t-3)">${a.runtime_status.map((r) => `${r.online?'🟢':'⚫'}${r.name}`).join(' · ')}</p>` : ''}
    </div>`;
  }).join('') || '<p class="hint">no modes</p>';
  // readiness
  const rd = $('#mode-readiness');
  if (rd && r.readiness) {
    const c = r.readiness.checks || {};
    rd.innerHTML = Object.entries(c).map(([k, v]) => `<div>${v ? '🟢' : '🔴'} <b>${esc(k)}</b> ${typeof v === 'string' ? esc(v) : ''}</div>`).join('');
  }
  // commands
  const cmds = $('#mode-commands');
  if (cmds) {
    const sampleCommands = [
      ['OBSERVE', 'mc status | mc inventory | mc nearby | mc map | mc look | mc scene | mc read_chat | mc social'],
      ['MOVE', 'mc goto X Y Z | mc goto_near X Y Z [r] | mc follow PLAYER | mc stop'],
      ['MINE', 'mc collect BLOCK [n] | mc dig X Y Z | mc find_blocks BLOCK'],
      ['BUILD', 'mc craft | mc place ITEM X Y Z | mc smelt INPUT'],
      ['LIFE', 'mc eat | mc sleep_bed | mc equip | mc inventory | mc chat'],
    ];
    cmds.innerHTML = sampleCommands.map(([g, list]) => `<div class="grp"><b>${esc(g)}</b><code>${esc(list)}</code></div>`).join('');
  }
  // capabilities
  const caps = $('#mode-capabilities');
  if (caps) {
    const list = (r.capabilities && Object.entries(r.capabilities)) || [];
    if (!list.length) {
      caps.innerHTML = '<p class="hint">No upstream capabilities exposed.</p>';
    } else {
      caps.innerHTML = list.map(([k, v]) => `<div class="cap"><b>${esc(k)}</b><p>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</p></div>`).join('');
    }
  }
  // fleet mapping
  const fm = $('#mode-fleet');
  if (fm && r.readiness) {
    fm.innerHTML = (r.readiness.bots || []).map((b) => `
      <div class="fmb">
        <div class="name">${esc(b.name)}</div>
        <div class="${b.online ? 'online':'offline'}">${b.online ? '🟢 online' : '⚫ offline'}</div>
      </div>`).join('');
  }
}

// ─- view router ───────────────────────────────────────────────────────

function setView(name) {
  STATE.view = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $$('.pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== name));
  if (name === 'map') refreshMap();
  if (name === 'vitals') refreshVitalsHistory();
  if (name === 'intelligence' || name === 'ask') refreshIntelligence();
  if (name === 'control') { refreshInventories(); refreshModels(); }
  if (name === 'modes') refreshHermesCraft();
}

// ─- tabs + keyboard ──────────────────────────────────────────────────

function wireTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });
}

function wireGlobalKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) {
      // still allow '/' to focus composer on any input
      if (e.key === '/' && e.target.id !== 'input') { e.preventDefault(); $('#input')?.focus(); }
      return;
    }
    const map = { '1':'live', '2':'chat', '3':'map', '4':'intelligence', '5':'vitals', '6':'goal', '7':'control', '8':'modes' };
    if (map[e.key]) { setView(map[e.key]); e.preventDefault(); return; }
    if (e.key === '/') { $('#input')?.focus(); e.preventDefault(); }
    if (e.key === 'g') { setView('goal'); $('#goal-input').focus(); }
    if (e.key === 'a') { setView('intelligence'); $('#ask-input').focus(); }
    if (e.key === 'm') { setView('map'); }
    if (e.key === 's') { STATE.settings = STATE.settings || {}; }
    if (e.key === 'Escape') {
      $('#settings-modal')?.classList.add('hidden');
      $('#inv-modal')?.classList.add('hidden');
    }
  });
}

// ─- settings ────────────────────────────────────────────────────────

function openSettings() { $('#settings-modal').classList.remove('hidden'); }
function closeSettings() { $('#settings-modal').classList.add('hidden'); }

function applySettings() {
  saveSettings();
  STATE.refreshTimer?.refresh?.();
}

// ─- bootstrap ───────────────────────────────────────────────────────

function boot() {
  wireTabs();
  wireGlobalKeyboard();
  // settings
  $('#settings-btn').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', () => { applySettings(); closeSettings(); });
  $('#setting-refresh').value = String(SETTINGS.refreshMs);
  $('#setting-refresh').addEventListener('change', (e) => {
    SETTINGS.refreshMs = Number(e.target.value);
    applySettings();
  });
  $('#setting-theme').addEventListener('change', (e) => {
    document.documentElement.dataset.theme = e.target.value;
  });
  // composer
  $('#composer').addEventListener('submit', sendChat);
  $('#chat-filter').addEventListener('input', (e) => { STATE.filters.chat = e.target.value; renderMessages(); });
  $('#chat-overheard').addEventListener('change', (e) => { STATE.filters.chatOverheard = !!e.target.checked; renderMessages(); });
  // mobile nav
  $('#mobile-nav-toggle').addEventListener('click', () => {
    const root = $('.app');
    root.dataset.mobileNav = root.dataset.mobileNav === 'open' ? '' : 'open';
  });
  // top pills
  $$('[data-go]').forEach((p) => p.addEventListener('click', () => {
    const v = p.dataset.go;
    if (v === 'goal') { setView('goal'); $('#goal-input').focus(); }
    else if (v === 'ask') { setView('intelligence'); $('#ask-input').focus(); }
    else if (v === 'talk') { setView('chat'); $('#input').focus(); }
  }));
  // quick actions
  $$('[data-broadcast]').forEach((b) => b.addEventListener('click', () => broadcast(b.dataset.broadcast)));
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.go;
    if (v === 'goal') { setView('goal'); $('#goal-input').focus(); }
    else if (v === 'ask') { setView('intelligence'); $('#ask-input').focus(); }
    else if (v === 'control') setView('control');
  }));
  // goal
  $('#goal-save')?.addEventListener('click', setGoal);
  $('#goal-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) setGoal(e); });
  // ask
  askAdvisor();
  // inventory modal close
  $('#inv-close')?.addEventListener('click', () => $('#inv-modal').classList.add('hidden'));
  // give / admin / model
  $('#give-form')?.addEventListener('submit', giveSubmit);
  $('#admin-form')?.addEventListener('submit', adminSubmit);
  $('#model-set')?.addEventListener('click', setModel);
  // control buttons
  $('#pause-all')?.addEventListener('click', () => fetchJSON('/pause', { method: 'POST', body: { paused: true } }).then(refreshAll));
  $('#resume-all')?.addEventListener('click', () => fetchJSON('/pause', { method: 'POST', body: { paused: false } }).then(refreshAll));
  $('#clear-all-queues')?.addEventListener('click', () => fetchJSON('/queues/clear', { method: 'POST' }).then(refreshAll));
  // map
  $('#map-in')?.addEventListener('click', () => { MAP.zoom = Math.min(2, MAP.zoom * 1.2); refreshMap(); });
  $('#map-out')?.addEventListener('click', () => { MAP.zoom = Math.max(0.5, MAP.zoom / 1.2); refreshMap(); });
  $('#map-reset')?.addEventListener('click', () => { MAP.cx = 50; MAP.cz = 85; MAP.zoom = 1; refreshMap(); });
  $('#map-follow')?.addEventListener('change', (e) => { MAP.follow = e.target.checked ? 'DuckBot' : ''; });
  // inventory grid + model picker on init
  refreshInventories();
  refreshModels();
  refreshIntelligence();

  // goal presets (build the chip rail)
  const presets = [
    'Build a safe starter village: secure base, gather food/materials locally, improve lighting/defenses, then expand.',
    'Survive the night: light up, lay down beds, sleep.',
    'Quarry run: bring back 32 cobblestone, 8 coal, 4 iron ore.',
    'Farm setup: till a 5×5 wheat patch, plant seeds, water, harvest on ripen.',
    'Fishing shack by the water (Reed): small dock, lantern, chest.',
    'Talk like an expert: spread out, sleep at night, eat when food <= 6.',
  ];
  const rail = $('#goal-presets');
  if (rail) {
    rail.innerHTML = '';
    for (const g of presets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = g.length > 38 ? g.slice(0, 36) + '…' : g;
      b.title = g;
      b.addEventListener('click', () => { $('#goal-input').value = g; setGoal(); });
      rail.appendChild(b);
    }
  }

  // populate give-target
  const giveTarget = $('#give-target');
  if (giveTarget) giveTarget.innerHTML = '<option value="Duckets">Duckets</option><option value="DuckBot">DuckBot</option><option>Steve</option><option>Reed</option><option>Moss</option><option>Flint</option><option>Ember</option>';

  // start SSE
  openEventStream();
  // start clock and refresh loops
  setInterval(tickClock, 1000);
  startRefreshLoop();
  // first fetch
  refreshAll();
  refreshChat();
  refreshGoal();
  refreshSafety();
  refreshHermesCraft();
}

let refreshTimer = null;
function startRefreshLoop() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshAll, SETTINGS.refreshMs);
  refreshTimer.unref?.();
}

boot();
