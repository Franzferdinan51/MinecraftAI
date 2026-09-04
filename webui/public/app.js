let view = 'global';       // 'global' | 'status' | bot name (DM)
let careBot = null;
let bots = [];
let rendered = new Set();
const msgKey = (m) => m.time + '|' + m.from + '|' + m.message;
const $ = (s) => document.querySelector(s);

async function api(p, opts) {
  const r = await fetch(p, opts);
  return r.json();
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 2500);
}
function botColor(name) {
  return (bots.find((b) => b.name === name) || {}).color || '#555';
}
function closeMobileNav() {
  document.body.classList.remove('nav-open');
  $('#mobile-nav-toggle')?.setAttribute('aria-expanded', 'false');
}
function syncMobileNav() {
  document.querySelectorAll('[data-mobile-view]').forEach((b) => b.classList.toggle('active', b.dataset.mobileView === view));
}
$('#mobile-nav-toggle')?.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  $('#mobile-nav-toggle').setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('[data-mobile-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.mobileView)));
function fmtTime(t) {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── chat ──
async function loadChat() {
  try {
    const r = await api('/api/chat?count=' + (UI.chatN || 60));
    if (!r.ok) return;
    const box = $('#messages');
    const fresh = visibleMessages(r.messages);
    for (const m of fresh) appendMsg(m);
    if (fresh.length) box.scrollTop = box.scrollHeight;
  } catch (e) { /* offline, retry next tick */ }
}
function visibleMessages(all) {
  // only messages never rendered; filter by view
  let fresh = all.filter((m) => !rendered.has(msgKey(m)));
  if (!UI.overheard) fresh = fresh.filter((m) => !m.overheard);
  const filt = ($('#chat-filter')?.value || '').toLowerCase();
  const passFilt = (m) => !filt || (m.from + ' ' + m.message).toLowerCase().includes(filt);
  if (view === 'global' || view === 'team') return fresh.filter(passFilt);
  if (view === 'status') return [];
  // DM view: messages from that bot, or our DMs to them
  return fresh.filter((m) =>
    m.from === view || (m.from === 'Duckets (web)' && m.channel === 'dm:' + view));
}
function appendMsg(m) {
  rendered.add(msgKey(m));
  if (view === 'team') { /* team radio renders everything fetched */ }
  else if (view !== 'global' && !(m.from === view || (m.from === 'Duckets (web)' && m.channel === 'dm:' + view))) return;
  const box = $('#messages');
  const div = document.createElement('div');
  div.className = 'msg';
  const who = esc(m.from);
  const initial = esc((m.from || '?')[0].toUpperCase());
  const tag = m.private ? '<span class="dm-tag">DM</span>' : (m.overheard ? '<span class="dm-tag">👂 nearby</span>' : '');
  div.innerHTML = `<div class="avatar" style="--c:${botColor(m.from)};background:${botColor(m.from)}">${initial}</div>
    <div class="msg-body"><div class="msg-head"><b style="color:${botColor(m.from)}">${who}</b><time>${fmtTime(m.time)}</time></div>
    <div class="msg-text">${tag}${esc(m.message)}</div></div>`;
  box.appendChild(div);
  while (box.children.length > 200) box.removeChild(box.firstChild);
}

// ── state ──
let stateInFlight = false;
async function loadState() {
  if (stateInFlight) return;
  stateInFlight = true;
  try {
    const r = await api('/api/state');
    if (!r.ok) return;
    bots = r.bots;
    renderMembers(); renderCards(); renderRail();
    if (view === 'dash') renderDash();
    if (view === 'map') drawMap();
    $('#online-count').textContent = bots.filter((b) => b.online).length;
  } catch (e) { /* retry */ }
  finally { stateInFlight = false; }
}
function memberHTML(b) {
  return `<div class="member ${careBot === b.name ? 'sel' : ''}" data-bot="${esc(b.name)}">
    <div class="avatar" style="background:${b.color}">${esc(b.name[0])}<span class="presence ${b.online ? 'on' : 'off'}"></span></div>
    <div><b>${esc(b.name)}</b><span>${b.online ? `❤${b.health} 🍖${b.food} · ${esc(b.holding)}` : 'offline'}</span></div></div>`;
}
function renderMembers() {
  $('#member-list').innerHTML = bots.map(memberHTML).join('');
  document.querySelectorAll('.member').forEach((el) => {
    el.onclick = () => { careBot = el.dataset.bot; setView(careBot); renderMembers(); $('#care-name').textContent = careBot; loadQueue(); };
  });
}
function renderCards() {
  $('#status-cards').innerHTML = bots.map((b) => `
    <div class="card" style="--c:${b.color}" data-inv="${esc(b.name)}" title="click for inventory">
      <h3>${esc(b.name)}${b.paused ? '<span class="paused-tag">PAUSED</span>' : ''}<span class="dot ${b.online ? 'on' : 'off'}">● ${b.online ? 'online' : 'offline'}</span></h3>
      <div class="role">${esc(b.role)} · :${b.port}${b.ticks != null ? ` · ${b.ticks} thinks` : ''}</div>
      ${b.online ? `
      <div class="row">❤ Health ${b.health}/20</div><div class="bar"><i class="hp" style="width:${b.health * 5}%"></i></div>
      <div class="row">🍖 Food ${b.food}/20</div><div class="bar"><i class="food" style="width:${b.food * 5}%"></i></div>
      <div class="row">📍 ${b.pos ? b.pos.join(', ') : '?'} · ${b.time} · holding ${esc(b.holding)}</div>
      <div class="row">💀 ${b.deaths != null ? b.deaths + ' deaths' : ''}${b.lastDeath ? ' · last: ' + esc(b.lastDeath) : ''}</div>
      <div class="task">${b.task ? '⚙ ' + esc(typeof b.task === 'string' ? b.task : (b.task.action || JSON.stringify(b.task))) : 'idle'}</div>`
      : `<div class="row">${esc(b.error || 'no response')}</div>`}
    </div>`).join('');
  document.querySelectorAll('[data-inv]').forEach((el) => { el.onclick = () => openInventory(el.dataset.inv); });
}
function renderRail() {
  $('#dm-rail').innerHTML = bots.map((b) =>
    `<div class="dm-dot ${view === b.name ? 'sel' : ''}" data-bot="${esc(b.name)}" title="${esc(b.name)}" style="--c:${b.color};background:${b.color}">${esc(b.name[0])}</div>`).join('');
  $('#dm-list').innerHTML = bots.map((b) =>
    `<div class="chan ${view === b.name ? 'active' : ''}" data-bot="${esc(b.name)}"><span class="hash">@</span>${esc(b.name)}</div>`).join('');
  document.querySelectorAll('[data-bot]').forEach((el) => {
    el.onclick = () => { careBot = el.dataset.bot; setView(careBot); renderRail(); renderMembers(); $('#care-name').textContent = careBot; loadQueue(); };
  });
}

// ── views ──
function setView(v) {
  view = v;
  closeMobileNav(); syncMobileNav();
  document.body.dataset.view = (v === 'status' || v === 'goal' || v === 'dash' || v === 'map' || v === 'modes') ? v : 'chat';
  document.querySelectorAll('#channels .chan').forEach((c) => c.classList.remove('active'));
  const chanEl = document.querySelector(`#channels .chan[data-view="${v}"]`);
  if (chanEl) chanEl.classList.add('active');
  if (v === 'global') {
    $('#chan-name').textContent = 'global-chat';
    $('#chan-topic').textContent = 'everything said in the world, live';
    $('#input').placeholder = 'Message #global-chat — every bot hears you like in-game chat';
  } else if (v === 'status') {
    $('#chan-name').textContent = 'bot-status';
    $('#chan-topic').textContent = 'health, food, position, current task';
  } else if (v === 'goal') {
    $('#chan-name').textContent = 'village-goal';
    $('#chan-topic').textContent = 'the one mission every bot works toward';
    loadGoal();
  } else if (v === 'team') {
    $('#chan-name').textContent = 'team-radio';
    $('#chan-topic').textContent = 'plans, claims, acks — the bots coordinating';
    $('#input').placeholder = 'Message team radio… (goes to all bots as chat)';
    loadTeam();
  } else if (v === 'map') {
    $('#chan-name').textContent = 'map';
    $('#chan-topic').textContent = 'live positions, top-down';
    drawMap();
  } else if (v === 'ask') {
    $('#chan-name').textContent = 'ask-ai';
    $('#chan-topic').textContent = 'the overseer AI answers with live village knowledge';
    $('#input').placeholder = 'Ask about the village — e.g. what is Moss doing?';
  } else if (v === 'modes') {
    $('#chan-name').textContent = 'HermesCraft modes';
    $('#chan-topic').textContent = 'companion · civilization · landfolk · minecraft core · play';
    loadHermesCraft();
  } else if (v === 'dash') {
    $('#chan-name').textContent = 'dashboard';
    $('#chan-topic').textContent = 'fleet vitals · world admin · inventories · settings';
    renderDash();
  } else {
    $('#chan-name').textContent = v;
    $('#chan-topic').textContent = 'DM — only ' + v + ' hears and answers (others keep working)';
    $('#input').placeholder = `Message @${v} — tell them what to do in plain words`;
  }
  $('#messages').innerHTML = '';
  rendered.clear();
  if (v === 'team') teamSeen.clear();
  loadChat(); renderRail();
}
document.querySelectorAll('#channels .chan[data-view]').forEach((el) => {
  el.onclick = () => setView(el.dataset.view);
});

// ── send ──
$('#composer').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('#input').value.trim();
  if (!text) return;
  $('#input').value = '';
  // ask-ai view: the overseer AI answers directly.
  if (view === 'ask') {
    appendLocal('Duckets (web)', text);
    const thinking = appendLocal('Overseer AI', 'thinking…', 'ai');
    try {
      const r = await api('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text }) });
      thinking.querySelector('.msg-text').textContent = r.ok ? r.reply : ('⚠ ' + (r.error || 'no answer'));
      if (r.ok && r.did && r.did.length) {
        const d = document.createElement('div');
        d.className = 'did-line';
        d.textContent = '⚙ ' + r.did.join(' · ');
        thinking.querySelector('.msg-body').appendChild(d);
      }
    } catch { thinking.querySelector('.msg-text').textContent = '⚠ mission control offline?'; }
    $('#messages').scrollTop = $('#messages').scrollHeight;
    return;
  }
  const target = (view === 'global' || view === 'status') ? 'all' : view;
  try {
    const r = await api('/api/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target, message: text }) });
    if (!r.ok) toast('send failed: ' + (r.error || '?'));
    else { toast(target === 'all' ? 'said it — watch for replies' : target + ' heard you'); loadChat(); }
  } catch { toast('mission control offline?'); }
};

function appendLocal(from, text, cls) {
  const box = $('#messages');
  const div = document.createElement('div');
  div.className = 'msg' + (cls ? ' ' + cls : '');
  const color = from === 'Overseer AI' ? '#5865f2' : botColor(from);
  div.innerHTML = `<div class="avatar" style="background:${color}">${esc(from[0].toUpperCase())}</div>
    <div class="msg-body"><div class="msg-head"><b style="color:${color}">${esc(from)}</b><time>${fmtTime(Date.now())}</time></div>
    <div class="msg-text">${esc(text)}</div></div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

// ── village goal ──
const GOAL_PRESETS = [
  'Build a safe starter village with houses, farm, and defenses.',
  'Build a wheat farm east of the house and store bread in the chest.',
  'Fortify the village: walls, torches, and patrols against night mobs.',
  'Mine iron and coal — full iron tools for everyone.',
  'Ranch expansion: breed cows and sheep, stock wool and leather.',
];
async function loadGoal() {
  try {
    const r = await api('/api/goal');
    $('#goal-current').innerHTML = r.ok ? `<b>Current mission:</b> ${esc(r.goal)}` : 'controller offline';
  } catch { $('#goal-current').textContent = 'controller offline'; }
  $('#goal-presets').innerHTML = '';
  GOAL_PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.textContent = p.slice(0, 48) + (p.length > 48 ? '…' : '');
    b.title = p; b.type = 'button';
    b.onclick = () => { $('#goal-input').value = p; };
    $('#goal-presets').appendChild(b);
  });
}
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'goal-save') {
    const g = $('#goal-input').value.trim();
    if (g.length < 10) return toast('goal too short');
    const r = await api('/api/goal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: g }) });
    if (r.ok) { toast('goal set — village pivoting'); $('#goal-input').value = ''; loadGoal(); }
    else toast('failed: ' + (r.error || '?'));
  }
});

// ── HermesCraft mode catalog ──
async function loadHermesCraft() {
  const cards = $('#mode-cards');
  if (!cards) return;
  try {
    const r = await api('/api/hermescraft');
    if (!r.ok) throw new Error(r.error || 'catalog offline');
    cards.innerHTML = (r.modes || []).map((m) => `<article class="mode-card ${esc(m.status)}">
      <div class="mode-card-head"><span class="mode-icon">${m.id === 'landfolk' ? '🌿' : m.id === 'companion' ? '🧑‍🌾' : m.id === 'civilization' ? '🏘️' : m.id === 'minecraft' ? '⛏️' : '🎮'}</span><div><h3>${esc(m.name)}</h3><span class="mode-status">${esc(m.status)}</span></div></div>
      <p>${esc(m.description)}</p><code>${esc(m.upstream_entry)}</code>
    </article>`).join('');
    $('#mode-capabilities').innerHTML = (r.capabilities || []).map((x) => `<span class="capability">✓ ${esc(x)}</span>`).join('');
    $('#mode-commands').innerHTML = Object.entries(r.command_surface || {}).map(([group, commands]) => `<div class="command-group"><b>${esc(group.replace(/_/g, ' '))}</b><div>${commands.map((x) => `<code>${esc(x)}</code>`).join('')}</div></div>`).join('');
    $('#mode-fleet').innerHTML = (r.fleet || []).map((b) => `<div class="fleet-agent"><span class="avatar" style="background:${botColor(b.name)}">${esc(b.name[0])}</span><div><b>${esc(b.name)}</b><span>${esc(b.role)} · body :${b.body_port} · ${esc(b.profile)}</span></div></div>`).join('');
  } catch (e) {
    cards.innerHTML = `<p class="hint">HermesCraft catalog unavailable: ${esc(e.message)}</p>`;
  }
}

// ── interface settings (persisted) ──
const UI = Object.assign({ refresh: 5, overheard: true, mapMin: 160, chatN: 60, toasts: true, theme: 'discord', compact: false },
  JSON.parse(localStorage.getItem('hermes-ui') || '{}'));
function applyUI() { document.body.dataset.theme = UI.theme; document.body.classList.toggle('compact', !!UI.compact); }
function saveUI() { localStorage.setItem('hermes-ui', JSON.stringify(UI)); applyUI(); armTimers(); }
applyUI();
const _origToast = toast;
toast = function (msg) { if (UI.toasts) _origToast(msg); };

// ── dashboard: fleet vitals ──
const PACES = [[30000, '30s'], [45000, '45s'], [60000, '60s'], [90000, '90s'], [120000, '2m'], [180000, '3m']];
const bar = (v) => { const p = Math.max(0, Math.min(20, v || 0)) * 5; const cls = p > 50 ? 'hp' : p > 25 ? 'food' : 'low'; return `<div class="bar"><i class="${cls}" style="width:${p}%"></i></div>`; };
function renderDash() {
  const box = $('#dash-rows');
  if (!box) return;
  box.innerHTML = bots.map((b) => `
    <div class="dash-row vital ${b.paused ? 'paused' : ''} ${b.online ? '' : 'off'}">
      <div class="vital-head"><b style="color:${b.color}">${esc(b.name)}</b>
        <span class="dot ${b.online ? 'on' : 'off'}">● ${b.online ? 'online' : 'offline'}</span>
        ${b.paused ? '<span class="paused-tag">PAUSED</span>' : ''}</div>
      <div class="role">${esc(b.role)} · ${b.ticks != null ? b.ticks + ' thinks' : (b.name === 'DuckBot' ? 'bridge-driven' : '?')}</div>
      ${b.online ? `
      <div class="vital-grid">
        <div>❤ ${b.health ?? '?'}${bar(b.health)}</div>
        <div>🍖 ${b.food ?? '?'}${bar(b.food)}</div>
        <div>📍 ${b.pos ? b.pos.join(', ') : '?'} · ${esc(b.time || '')}</div>
        <div>🤲 ${esc(b.holding)} · 🎒 ${b.invCount ?? '?'} slots</div>
        <div>📋 queue: ${b.queueRunning ? '▶ ' + esc(b.queueRunning) : '—'}${b.queueLen > 1 ? ` (+${b.queueLen - 1})` : ''}</div>
        <div>💀 ${b.deaths != null ? b.deaths + ' deaths' : '—'}${b.lastDeath ? ' · ' + esc(b.lastDeath) : ''}</div>
      </div>
      <div class="vital-doing">${esc((b.last_action || '—').slice(0, 140))}</div>` : `<div class="role">${esc(b.error || 'no response')}</div>`}
      <div class="vital-ops">
        <button data-dinv="${esc(b.name)}" type="button">🎒 Bags</button>
        ${b.name === 'DuckBot' ? '<span class="role">pace + pause live in the bridge</span>' : `
        <select data-pace="${esc(b.name)}">${PACES.map(([ms, label]) => `<option value="${ms}" ${b.interval_ms === ms ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <button class="pause-btn ${b.paused ? 'on' : ''}" data-pause="${esc(b.name)}" type="button">${b.paused ? '▶ Resume' : '⏸ Pause'}</button>
        <button data-quick="eat|${esc(b.name)}" type="button">🍖</button>
        <button data-quick="sleep_bed|${esc(b.name)}" type="button">🛏</button>`}
      </div>
    </div>`).join('') || '<p class="hint">loading…</p>';
  box.querySelectorAll('[data-pause]').forEach((btn) => {
    btn.onclick = async () => {
      const name = btn.dataset.pause;
      const b = bots.find((x) => x.name === name);
      const r = await api('/api/pause', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, paused: !b.paused }) });
      if (r.ok) { toast(name + (r.paused ? ' paused' : ' resumed')); loadState().then(renderDash); }
      else toast('failed: ' + (r.error || '?'));
    };
  });
  box.querySelectorAll('[data-pace]').forEach((sel) => {
    sel.onchange = async () => {
      const r = await api('/api/interval', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: sel.dataset.pace, interval_ms: Number(sel.value) }) });
      toast(r.ok ? 'pace updated' : ('failed: ' + (r.error || '?')));
    };
  });
  box.querySelectorAll('[data-dinv]').forEach((el) => { el.onclick = () => openInventory(el.dataset.dinv); });
  box.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.onclick = async () => {
      const [action, bot] = btn.dataset.quick.split('|');
      const r = await api('/api/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bot, action, args: '' }) });
      toast(r.ok ? `queued ${action} for ${bot}` : ('failed: ' + (r.error || '?')));
      loadState();
    };
  });
  loadDashExtras(); renderDashSafety();
}
// pause-all / resume-all / pace-all
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'pause-all') {
    for (const b of bots) if (!b.paused && b.name !== 'DuckBot') await api('/api/pause', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: b.name, paused: true }) });
    toast('fleet paused'); loadState().then(renderDash);
  }
  if (e.target && e.target.id === 'resume-all') {
    for (const b of bots) if (b.paused) await api('/api/pause', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: b.name, paused: false }) });
    toast('fleet resumed'); loadState().then(renderDash);
  }
});
document.addEventListener('change', async (e) => {
  if (e.target && e.target.id === 'pace-all' && e.target.value) {
    for (const b of bots) if (b.name !== 'DuckBot') await api('/api/interval', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: b.name, interval_ms: Number(e.target.value) }) });
    toast('fleet pace updated'); e.target.value = ''; loadState().then(renderDash);
  }
});

// ── dashboard: server world ──
let serverSnap = null;
async function loadDashExtras() {
  if (view !== 'dash') return;
  try {
    const [s, inv, models] = await Promise.all([api('/api/server'), api('/api/inventories'), api('/api/models')]);
    if (view !== 'dash') return;
    serverSnap = s.ok ? s : { error: s.error };
    renderDashServer(); renderDashInv(inv.ok ? inv.inventories : null); renderDashBrain(); renderDashModels(models); renderDashGive(); renderDashSettings(); renderDashActivity(); renderDashIntel();
  } catch { /* retry next tick */ }
}
function renderDashServer() {
  const box = $('#dash-server');
  if (!box) return;
  const s = serverSnap;
  if (!s || s.error) { box.innerHTML = `<p class="hint">server admin offline: ${esc((s && s.error) || '…')}</p>`; return; }
  box.innerHTML = `
    <div class="srv-grid">
      <div><b>Players online (${s.players.length}):</b> ${s.players.length ? s.players.map((p) => `<span class="chip">${esc(p)}</span>`).join(' ') : '<span class="role">just bots</span>'}</div>
      <div><b>Time:</b> ${esc(s.timeLabel)}${s.tick != null ? ` <span class="role">(tick ${s.tick})</span>` : ''}</div>
      <div><b>Difficulty:</b> ${esc(s.difficulty || '?')}</div>
    </div>
    <div class="form-row"><span><b>Set time:</b></span>
      ${['day', 'noon', 'sunset', 'night', 'midnight'].map((t) => `<button data-adm="time|${t}" type="button">${t}</button>`).join('')}
    </div>
    <div class="form-row"><span><b>Weather:</b></span>
      ${['clear', 'rain', 'thunder'].map((w) => `<button data-adm="weather|${w}" type="button">${w}</button>`).join('')}
      <span><b>Difficulty:</b></span>
      <select id="adm-diff">${['peaceful', 'easy', 'normal', 'hard'].map((d) => `<option ${(s.difficulty || '').toLowerCase().startsWith(d) ? 'selected' : ''}>${d}</option>`).join('')}</select>
      <button id="adm-save" type="button">💾 save world</button>
    </div>`;
  box.querySelectorAll('[data-adm]').forEach((btn) => {
    btn.onclick = async () => {
      const [op, value] = btn.dataset.adm.split('|');
      const r = await api('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, value }) });
      toast(r.ok ? (op + ' → ' + (r.result || 'done')) : ('failed: ' + (r.error || '?')));
      loadDashExtras();
    };
  });
  const diff = $('#adm-diff');
  if (diff) diff.onchange = async () => {
    const r = await api('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'difficulty', value: diff.value }) });
    toast(r.ok ? ('difficulty → ' + diff.value) : ('failed: ' + (r.error || '?')));
  };
  const save = $('#adm-save');
  if (save) save.onclick = async () => {
    const r = await api('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'save' }) });
    toast(r.ok ? '💾 world saved' : ('failed: ' + (r.error || '?')));
  };
}

// ── dashboard: fleet inventories ──
function invEntries(inv) {
  if (!inv) return [];
  if (Array.isArray(inv.items)) return inv.items;
  if (inv.categories) return Object.entries(inv.categories).flatMap(([cat, arr]) => Array.isArray(arr) ? arr.map((it) => ({ ...it, cat })) : []);
  if (Array.isArray(inv)) return inv;
  const meta = new Set(['summary', 'totalSlots', 'error']);
  if (typeof inv === 'object') return Object.entries(inv).filter(([name]) => !meta.has(name)).map(([name, count]) => ({ name, count }));
  return [];
}
function renderDashInv(all) {
  const box = $('#dash-inv');
  if (!box) return;
  if (!all) { box.innerHTML = '<p class="hint">inventories offline</p>'; return; }
  const filt = ($('#inv-search')?.value || '').toLowerCase();
  box.innerHTML = `<div class="form-row"><input id="inv-search" placeholder="search items… (e.g. iron, bread)" value="${esc($('#inv-search')?.value || '')}"></div>` +
    bots.map((b) => {
      const data = all[b.name];
      const offline = data?.error;
      const items = invEntries(data).filter((it) => !filt || String(it.name || it.item || '').toLowerCase().includes(filt));
      const total = items.reduce((s, it) => s + (it.count || 1), 0);
      return `<div class="inv-bot"><div class="inv-head" style="--c:${b.color}"><b>${esc(b.name)}</b>
        <span class="role">${total} items · ${items.length} slots</span>
        <button data-clear="${esc(b.name)}" type="button" title="empty this bot's pockets">🧹 clear</button></div>
        <div class="inv-grid">${offline ? `<span class="offline-note">⚠ ${esc(offline)}</span>` : items.length ? items.map((it) =>
          `<div class="inv-cell" title="${esc(it.cat || '')}">${esc((it.name || '?').replace(/_/g, ' '))}<b>x${it.count ?? 1}</b></div>`).join('')
          : '<span class="role">empty pockets</span>'}</div></div>`;
    }).join('');
  const search = $('#inv-search');
  if (search) search.oninput = () => renderDashInv(all);
  box.querySelectorAll('[data-clear]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm(`Empty ${btn.dataset.clear}'s whole inventory?`)) return;
      const r = await api('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'clear', target: btn.dataset.clear }) });
      toast(r.ok ? `${btn.dataset.clear} cleared` : ('failed: ' + (r.error || '?')));
      loadDashExtras();
    };
  });
}

function renderDashActivity() {
  const box = $('#dash-activity');
  if (!box) return;
  api('/api/activity?count=30').then((r) => {
    if (!r.ok) { box.innerHTML = '<p class="hint">feed offline</p>'; return; }
    box.innerHTML = r.events.length ? r.events.map((e) => {
      const icon = e.kind === 'death' ? '💀' : e.kind === 'control' ? '⚙' : e.kind === 'nearby' ? '👂' : '💬';
      return `<div class="activity-row"><span class="activity-icon">${icon}</span><div><b>${esc(e.title)}</b><span class="role"> · ${esc(e.kind)} · ${fmtTime(e.time)}</span><div>${esc(e.detail)}</div></div></div>`;
    }).join('') : '<p class="hint">No recent events.</p>';
  }).catch(() => { box.innerHTML = '<p class="hint">feed offline</p>'; });
}

// ── dashboard: intelligence ledger (read-only; cannot dispatch) ──
function renderDashIntel() {
  const box = $('#dash-intel');
  if (!box) return;
  api('/api/intelligence').then((r) => {
    if (!r.ok && !Array.isArray(r.records)) { box.innerHTML = `<p class="hint">ledger offline: ${esc(r.error || '…')}</p>`; return; }
    const records = (r.records || []).slice(-10).reverse();
    const head = `<div class="form-row"><span class="chip">mode: ${esc(r.mode || '?')}</span>`
      + `<span class="chip">dispatch: ${r.dispatchEnabled ? 'ON' : 'off'}</span>`
      + `<span class="role">${(r.records || []).length} records</span></div>`;
    if (!records.length) { box.innerHTML = head + '<p class="hint">No proposals yet. The ledger fills as bots submit structured proposals.</p>'; return; }
    box.innerHTML = head + records.map((rec) => {
      const ds = (rec.decisions || []).map((d) =>
        `<div>${d.accepted ? '✅' : '⛔'} <b>${esc(d.bot || '?')}</b>`
        + ` <span class="role">${esc(d.capability || '')}${d.skill ? ' · ' + esc(d.skill) : ''} · tier ${d.riskTier ?? '?'} · ${esc(d.reason || '')}</span></div>`
      ).join('');
      return `<div class="activity-row"><span class="activity-icon">${rec.status === 'accepted' ? '🧠' : '⚠'}</span>`
        + `<div><b>${esc(rec.source || '?')}</b><span class="role"> · ${esc(rec.status || '')} · ${rec.at ? fmtTime(rec.at) : ''}</span>`
        + (rec.summary ? `<div>${esc(rec.summary)}</div>` : '')
        + (rec.error ? `<div>${esc(rec.error)}</div>` : '')
        + `${ds}</div></div>`;
    }).join('');
  }).catch(() => { box.innerHTML = '<p class="hint">ledger offline</p>'; });
}

// ── dashboard: fleet safety (display-only mirror of the intelligence
// safety-state module, which is canonical: criticalHealth 8, lowFood 6.
// Reads the already-cached state bots snapshot — read-only rendering,
// no queue access. Recovery outranks model plans.)
function safetyBadge(b) {
  if (!b.online) return '⚫ offline';
  if (b.paused) return '⏸ paused';
  if (!Number.isFinite(b.health) || !Number.isFinite(b.food)) return '❓ unknown vitals';
  if (b.health <= 8) return b.food > 0 ? '🔴 recovery: eat' : '🔴 recovery: resupply';
  if (b.food <= 6) return '🟠 hungry';
  return '🟢 clear';
}

function renderDashSafety() {
  const box = $('#dash-safety');
  if (!box) return;
  const rows = Array.isArray(bots) ? bots : [];
  if (!rows.length) { box.innerHTML = '<p class="hint">waiting for state…</p>'; return; }
  const order = { '🔴': 0, '❓': 1, '🟠': 2, '⏸': 3, '⚫': 4, '🟢': 5 };
  const sorted = [...rows].sort((a, b) => (order[safetyBadge(a)[0]] ?? 6) - (order[safetyBadge(b)[0]] ?? 6));
  box.innerHTML = sorted.map((b) => {
    const badge = safetyBadge(b);
    return `<div class="activity-row"><span class="activity-icon">${badge.slice(0, 2)}</span>`
      + `<div><b>${esc(b.name)}</b><span class="role"> · ${esc(badge.slice(2).trim() || badge)}</span>`
      + (b.online ? `<div>❤ ${b.health ?? '?'} · 🍖 ${b.food ?? '?'}`
        + (b.deaths != null ? ` · 💀 ${b.deaths}` : '')
        + (b.lastDeath ? ` · last: ${esc(b.lastDeath)}` : '') + '</div>' : `<div>${esc(b.error || 'no response')}</div>`)
      + '</div></div>';
  }).join('');
}

// ── dashboard: queue maintenance ──
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'clear-all-queues') {
    if (!confirm('Clear all waiting tasks? Currently running actions are left alone.')) return;
    const r = await api('/api/queues/clear', { method: 'POST' });
    toast(r.ok ? 'all waiting queues cleared' : ('failed: ' + (r.error || '?')));
    loadState(); loadDashExtras();
  }
});

function renderDashModels(r) {
  const box = $('#dash-models');
  if (!box) return;
  if (!r?.ok || !r.models?.length) { box.innerHTML = `<p class="hint">LM Studio model catalog unavailable: ${esc(r?.error || 'no models')}</p>`; return; }
  const opts = r.models.map((m) => `<option value="${esc(m.id)}">${esc(m.id)}${m.context_length ? ` · ctx ${m.context_length}` : ''}</option>`).join('');
  box.innerHTML = `<div class="model-toolbar"><div><b>LM Studio models</b><span class="role"> ${r.models.length} exposed · exact IDs from /v1/models</span></div><button id="refresh-models" type="button">↻ refresh</button></div>` +
    bots.map((b) => `<div class="model-row"><span class="model-name" style="color:${b.color}">${esc(b.name)}</span><select data-model-bot="${esc(b.name)}"><option value="">${esc(b.model || (b.name === 'DuckBot' ? 'bridge current' : 'current / startup'))}</option>${opts}</select><span class="role">${b.name === 'DuckBot' ? 'live bridge switch' : 'live next think'}</span></div>`).join('');
  box.querySelector('#refresh-models')?.addEventListener('click', () => loadDashExtras());
  box.querySelectorAll('[data-model-bot]').forEach((sel) => sel.addEventListener('change', async () => {
    if (!sel.value) return;
    sel.disabled = true;
    const r2 = await api('/api/model', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: sel.dataset.modelBot, model: sel.value }) });
    sel.disabled = false;
    toast(r2.ok ? `${sel.dataset.modelBot} → ${sel.value}` : ('model failed: ' + (r2.error || '?')));
    if (r2.ok) loadState();
  }));
}

// ── dashboard: give items ──
const COMMON_ITEMS = ['bread', 'cooked_beef', 'cooked_porkchop', 'apple', 'torch', 'iron_sword', 'iron_pickaxe', 'iron_axe', 'shield', 'bow', 'arrow', 'oak_log', 'oak_planks', 'cobblestone', 'iron_ingot', 'coal', 'diamond', 'gray_bed', 'chest', 'furnace', 'boat', 'leather_chestplate', 'bucket', 'shears', 'fishing_rod'];
function renderDashGive() {
  const box = $('#dash-give');
  if (!box || box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML = `<div class="form-row">
    <select id="give-target">${['Duckets', ...bots.map((b) => b.name)].map((n) => `<option>${esc(n)}</option>`).join('')}</select>
    <input id="give-item" list="give-items" placeholder="item (e.g. bread, iron_pickaxe)">
    <datalist id="give-items">${COMMON_ITEMS.map((i) => `<option value="${i}">`).join('')}</datalist>
    <input id="give-count" type="number" min="1" max="64" value="8" style="width:64px">
    <button id="give-btn" type="button">🎁 Give</button>
    <button id="clear-btn" type="button">🧹 Clear target</button></div>
    <div class="role" id="give-out"></div>`;
  $('#give-btn').onclick = async () => {
    const r = await api('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'give', target: $('#give-target').value, item: $('#give-item').value, count: Number($('#give-count').value) }) });
    $('#give-out').textContent = r.ok ? `gave → ${r.result}` : ('failed: ' + (r.error || '?'));
    if (r.ok) { toast('items delivered'); loadDashExtras(); }
  };
  $('#clear-btn').onclick = async () => {
    if (!confirm(`Empty ${$('#give-target').value}'s inventory?`)) return;
    const r = await api('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'clear', target: $('#give-target').value }) });
    $('#give-out').textContent = r.ok ? 'cleared' : ('failed: ' + (r.error || '?'));
    if (r.ok) loadDashExtras();
  };
}

// ── dashboard: brain & mission ──
async function renderDashBrain() {
  const box = $('#dash-brain');
  if (!box) return;
  try {
    const [ctrl, goal] = await Promise.all([api('/api/state'), api('/api/goal')]);
    const thinks = (ctrl.bots || []).reduce((s, b) => s + (b.ticks || 0), 0);
    box.innerHTML = `<div class="srv-grid">
      <div><b>Controller:</b> ${ctrl.controller?.ok ? '🟢 online' : '🔴 offline'} <span class="role">${esc(ctrl.controller?.lms_url || '')}</span></div>
      <div><b>Brain:</b> ornith-1.5-9b via LM Studio <span class="role">· ${thinks} total thinks</span></div>
      <div><b>Mission:</b> ${esc((goal.goal || '—').slice(0, 160))} <button id="goto-goal" type="button">🎯 edit</button></div>
      <div><b>Fleet:</b> ${ctrl.bots ? ctrl.bots.filter((b) => b.online).length + '/' + ctrl.bots.length + ' online · ' + ctrl.bots.filter((b) => b.paused).length + ' paused · ' + ctrl.bots.reduce((s, b) => s + (b.queueLen || 0), 0) + ' queued tasks' : '—'}</div>
    </div>`;
    const g = $('#goto-goal');
    if (g) g.onclick = () => setView('goal');
  } catch { box.innerHTML = '<p class="hint">brain offline</p>'; }
}

// ── dashboard: interface settings ──
function renderDashSettings() {
  const box = $('#dash-settings');
  if (!box || box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML = `<div class="form-row"><span><b>Status refresh:</b></span>
      <select id="set-refresh">${[3, 5, 10, 15, 30].map((s) => `<option value="${s}" ${UI.refresh === s ? 'selected' : ''}>${s}s</option>`).join('')}</select>
      <label><input type="checkbox" id="set-overheard" ${UI.overheard ? 'checked' : ''}> show nearby chatter 👂</label>
      <label><input type="checkbox" id="set-toasts" ${UI.toasts ? 'checked' : ''}> popups</label></div>
    <div class="form-row"><span><b>Chat history:</b></span>
      <select id="set-chatn">${[20, 60, 100].map((n) => `<option value="${n}" ${UI.chatN === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span><b>Map area:</b></span>
      <select id="set-mapmin">${[[160, 'village'], [256, 'wide'], [384, 'region']].map(([v, label]) => `<option value="${v}" ${UI.mapMin === v ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <span class="role">extras auto-refresh every 20s</span></div>
    <div class="form-row"><span><b>Appearance:</b></span>
      <select id="set-theme"><option value="discord">Discord dark</option><option value="midnight">Midnight blue</option><option value="terminal">Terminal green</option></select>
      <label><input type="checkbox" id="set-compact"> compact mode</label></div>`;
  $('#set-refresh').onchange = (e) => { UI.refresh = Number(e.target.value); saveUI(); toast('refresh → ' + UI.refresh + 's'); };
  $('#set-overheard').onchange = (e) => { UI.overheard = e.target.checked; saveUI(); loadChat(); };
  $('#set-toasts').onchange = (e) => { UI.toasts = e.target.checked; saveUI(); };
  $('#set-chatn').onchange = (e) => { UI.chatN = Number(e.target.value); saveUI(); loadChat(); };
  $('#set-mapmin').onchange = (e) => { UI.mapMin = Number(e.target.value); saveUI(); terrainCache = null; if (view === 'map') drawMap(); };
  $('#set-theme').value = UI.theme;
  $('#set-theme').onchange = (e) => { UI.theme = e.target.value; saveUI(); toast('theme updated'); };
  $('#set-compact').checked = !!UI.compact;
  $('#set-compact').onchange = (e) => { UI.compact = e.target.checked; saveUI(); toast(UI.compact ? 'compact mode on' : 'compact mode off'); };
}
document.querySelectorAll('#care-btns button').forEach((btn) => {
  btn.onclick = async () => {
    if (!careBot) return toast('pick a bot first');
    const r = await api('/api/manage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bot: careBot, op: btn.dataset.op }) });
    $('#care-out').textContent = JSON.stringify(r.ok ? (r.inventory || r) : r, null, 1).slice(0, 800);
    loadState();
  };
});

// ── team radio ──
let teamSeen = new Set();
async function loadTeam() {
  if (view !== 'team') return;
  try {
    const r = await api('/api/team');
    if (!r.ok) return;
    const box = $('#messages');
    let added = 0;
    for (const m of (r.messages || [])) {
      const k = m.time + '|' + m.from + '|' + m.message;
      if (teamSeen.has(k)) continue;
      teamSeen.add(k);
      const div = document.createElement('div');
      div.className = 'msg';
      div.innerHTML = `<div class="avatar" style="background:${botColor(m.from)}">📻</div>
        <div class="msg-body"><div class="msg-head"><b style="color:${botColor(m.from)}">${esc(m.from)}</b><time>${esc(new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time></div>
        <div class="msg-text">${esc(m.message)}</div></div>`;
      box.appendChild(div);
      while (box.children.length > 200) box.removeChild(box.firstChild);
      added++;
    }
    if (added) box.scrollTop = box.scrollHeight;
  } catch {}
}

// ── live map: real terrain from the world save + bot dots ──
const HOUSE = [50, 63, 85];
const BEDS = [[46, 77], [48, 77], [50, 77], [52, 77]];
let terrainCache = null;
const mapView = { zoom: 1, panX: 0, panY: 0, bound: false };
function mapControls() {
  if (mapView.bound) return;
  const cv = $('#map'); if (!cv) return;
  mapView.bound = true;
  const change = (d) => { mapView.zoom = Math.max(.55, Math.min(5, mapView.zoom + d)); drawMap(); };
  $('#map-in')?.addEventListener('click', () => change(.25));
  $('#map-out')?.addEventListener('click', () => change(-.25));
  $('#map-reset')?.addEventListener('click', () => { mapView.zoom = 1; mapView.panX = 0; mapView.panY = 0; drawMap(); });
  $('#map-follow')?.addEventListener('change', () => { terrainCache = null; drawMap(); });
  let drag = null;
  const endDrag = (e) => {
    if (!drag) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8;
    if (!moved) {
      const hit = (mapView.markers || []).find((m) => Math.hypot(e.offsetX - m.x, e.offsetY - m.y) <= 16);
      if (hit) { careBot = hit.name; $('#care-name').textContent = careBot; renderMembers(); syncMobileNav(); toast(`Selected ${careBot}`); drawMap(); }
    }
    drag = null;
    if (cv.hasPointerCapture?.(e.pointerId)) cv.releasePointerCapture(e.pointerId);
  };
  cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, px: mapView.panX, py: mapView.panY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (drag) { mapView.panX = drag.px + e.clientX - drag.x; mapView.panY = drag.py + e.clientY - drag.y; drawMap(); } });
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('lostpointercapture', () => { drag = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); change(e.deltaY < 0 ? .2 : -.2); }, { passive: false });
}
async function drawMap() {
  mapControls();
  const cv = $('#map');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width;
  let xs = [HOUSE[0]], zs = [HOUSE[2]];
  bots.forEach((b) => { if (b.pos) { xs.push(b.pos[0]); zs.push(b.pos[2]); } });
  const cx = ($('#map-follow')?.checked && careBot && bots.find((b) => b.name === careBot)?.pos?.[0]) || (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = ($('#map-follow')?.checked && careBot && bots.find((b) => b.name === careBot)?.pos?.[2]) || (Math.min(...zs) + Math.max(...zs)) / 2;
  const size = Math.max(UI.mapMin || 160, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 60);
  const key = `${Math.round(cx / 8) * 8},${Math.round(cz / 8) * 8},${Math.round(size / 16) * 16}`;
  if (!terrainCache || terrainCache.key !== key) {
    ctx.fillStyle = '#101114'; ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = '#b5bac1'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('rendering terrain…', W / 2, W / 2);
    try {
      const r = await api(`/api/terrain?cx=${cx}&cz=${cz}&size=${size}`);
      if (!r.ok) throw new Error(r.error || 'no terrain');
      terrainCache = { key, t: r };
    } catch (e) {
      ctx.fillStyle = '#101114'; ctx.fillRect(0, 0, W, W);
      ctx.fillStyle = '#ed4245'; ctx.fillText('terrain failed — dots only', W / 2, W / 2);
      terrainCache = { key, t: null };
    }
  }
  const t = terrainCache.t;
  const rawPx = (x) => t ? (x - t.x0) / t.step / t.w * W : W / 2;
  const rawPz = (z) => t ? (z - t.z0) / t.step / t.w * W : W / 2;
  const px = (x) => W / 2 + (rawPx(x) - W / 2) * mapView.zoom + mapView.panX;
  const pz = (z) => W / 2 + (rawPz(z) - W / 2) * mapView.zoom + mapView.panY;
  if (t) {
    const img = ctx.createImageData(t.w, t.w);
    for (let i = 0; i < t.cells.length; i++) {
      const c = t.cells[i] || 0x0d0e12;
      img.data[i * 4] = (c >> 16) & 255; img.data[i * 4 + 1] = (c >> 8) & 255;
      img.data[i * 4 + 2] = c & 255; img.data[i * 4 + 3] = 255;
    }
    const off = document.createElement('canvas');
    off.width = t.w; off.height = t.w;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.save(); ctx.translate(W / 2 + mapView.panX, W / 2 + mapView.panY); ctx.scale(mapView.zoom, mapView.zoom);
    ctx.drawImage(off, -W / 2, -W / 2, W, W); ctx.restore();
  }
  // beds + house + bots
  ctx.fillStyle = '#faa81a';
  BEDS.forEach(([x, z]) => ctx.fillRect(px(x) - 3, pz(z) - 3, 6, 6));
  ctx.fillStyle = '#5865f2';
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(px(HOUSE[0]), pz(HOUSE[2]), 9, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('HOUSE', px(HOUSE[0]), pz(HOUSE[2]) - 13);
  mapView.markers = [];
  bots.forEach((b) => {
    if (!b.pos) return;
    const cxp = Math.min(W - 10, Math.max(10, px(b.pos[0])));
    const czp = Math.min(W - 10, Math.max(10, pz(b.pos[2])));
    mapView.markers.push({ name: b.name, x: cxp, y: czp });
    ctx.fillStyle = b.paused ? '#555' : b.color;
    ctx.beginPath(); ctx.arc(cxp, czp, 10, 0, 7); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
    ctx.fillText(b.name, cxp, czp - 14);
  });
  const follow = $('#map-follow')?.checked && careBot ? ` · following ${careBot}` : '';
  $('#map-readout').textContent = `${t ? `terrain ${t.w}×${t.w}` : 'marker-only fallback'} · zoom ${mapView.zoom.toFixed(2)}×${follow} · tap a bot marker to select`;
}

// ── alerts (low HP, deaths) ──
let prevHp = {}, prevDeaths = {};
async function checkAlerts() {
  for (const b of bots) {
    if (!b.online) continue;
    if (b.health != null && b.health < 10 && (prevHp[b.name] ?? 99) >= 10) toast(`⚠ ${b.name} is hurt! HP ${b.health}`);
    prevHp[b.name] = b.health;
    try {
      const r = await api(`/api/bot/${b.name}/deaths`);
      const total = r.data?.total ?? 0;
      if ((prevDeaths[b.name] ?? total) < total) toast(`☠ ${b.name} died!`);
      prevDeaths[b.name] = total;
    } catch {}
  }
}

// ── task queue (per selected bot) ──
let queueActions = {};
async function loadQueueActions() {
  try {
    const r = await api('/api/queue-actions');
    if (r.ok) {
      queueActions = r.actions;
      $('#queue-action').innerHTML = Object.keys(queueActions).map((a) => `<option value="${a}">${a}</option>`).join('');
      updateQueueHint();
    }
  } catch {}
}
function updateQueueHint() {
  const a = $('#queue-action').value;
  const keys = queueActions[a] || [];
  $('#queue-args').placeholder = keys.length ? `args: ${keys.join(' ')}` : 'no args';
}
async function loadQueue() {
  const box = $('#queue-list');
  if (!careBot) { box.innerHTML = '<p class="hint">pick a bot</p>'; return; }
  try {
    const r = await api('/api/queue?bot=' + encodeURIComponent(careBot));
    if (!r.ok) { box.innerHTML = '<p class="hint">offline</p>'; return; }
    const run = r.data?.running;
    const items = [];
    if (run && ['running'].includes(run.status)) items.push({ id: run.queued_id, label: `▶ ${run.action} ${esc(JSON.stringify(run.args || {}))}`, running: true });
    (r.data?.queued || []).forEach((q, i) => items.push({ id: q.id, label: `${i + 1}. ${q.action} ${esc(JSON.stringify(q.args || {}))}`, running: false }));
    box.innerHTML = items.length ? items.map((it) =>
      `<div class="q-item ${it.running ? 'running' : ''}"><span class="q-act">${it.label}</span>${it.id ? `<button data-qid="${it.id}" type="button">✕</button>` : ''}</div>`).join('')
      : '<p class="hint">queue empty</p>';
    box.querySelectorAll('[data-qid]').forEach((btn) => {
      btn.onclick = async () => {
        await api('/api/queue/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bot: careBot, id: btn.dataset.qid }) });
        loadQueue();
      };
    });
  } catch { box.innerHTML = '<p class="hint">offline</p>'; }
}

// ── inventory modal ──
async function openInventory(name) {
  $('#inv-title').textContent = '🎒 ' + name;
  $('#inv-list').innerHTML = 'loading…';
  $('#inv-modal').classList.add('open');
  try {
    const r = await api(`/api/bot/${name}/inventory`);
    const items = invEntries(r.data);
    $('#inv-list').innerHTML = items.length
      ? items.map((it) => `<div class="inv-row"><span>${esc(((it.name || it.item || '?') + '').replace(/_/g, ' '))}${it.cat ? ` <span class="role">${esc(it.cat)}</span>` : ''}</span><b>x${it.count ?? 1}</b></div>`).join('')
      : 'empty pockets';
  } catch { $('#inv-list').textContent = 'offline'; }
}

// ── loops ──
let timers = [];
function armTimers() {
  timers.forEach(clearInterval); timers = [];
  timers.push(setInterval(loadChat, 3000));
  timers.push(setInterval(loadState, (UI.refresh || 5) * 1000));
  timers.push(setInterval(() => { if (careBot) loadQueue(); }, 5000));
  timers.push(setInterval(() => { if (view === 'team') loadTeam(); }, 4000));
  timers.push(setInterval(() => { if (view === 'map') drawMap(); }, 5000));
  timers.push(setInterval(() => { if (view === 'dash') loadDashExtras(); }, 20000));
  timers.push(setInterval(checkAlerts, 15000));
}
setView('global');
loadState();
loadQueueActions();
armTimers();
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'inv-close') $('#inv-modal').classList.remove('open');
  if (e.target && e.target.id === 'inv-modal') $('#inv-modal').classList.remove('open');
  const bcast = e.target && e.target.dataset && e.target.dataset.b;
  if (bcast) {
    const r = await api('/api/broadcast', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: bcast }) });
    toast(r.ok ? `broadcast: ${bcast} — watch chat` : ('failed: ' + (r.error || '?')));
    loadChat();
  }
});
document.addEventListener('change', (e) => { if (e.target && e.target.id === 'queue-action') updateQueueHint(); });
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'queue-btn') {
    if (!careBot) return toast('pick a bot first');
    const action = $('#queue-action').value;
    const args = $('#queue-args').value;
    const r = await api('/api/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bot: careBot, action, args }) });
    if (r.ok) { toast(`queued ${action} for ${careBot}`); $('#queue-args').value = ''; loadQueue(); }
    else toast('queue failed: ' + (r.error || '?'));
  }
});
document.addEventListener('input', (e) => { if (e.target && e.target.id === 'chat-filter' && (view === 'global' || view === 'team')) { $('#messages').innerHTML = ''; rendered.clear(); teamSeen.clear(); loadChat(); loadTeam(); } });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setView('ask'); $('#input').focus(); }
  else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); $('#input').focus(); }
  else if (e.key === 'Escape') { $('#inv-modal')?.classList.remove('open'); $('#input')?.blur(); }
  else if (e.altKey && e.key === '1') setView('global');
  else if (e.altKey && e.key === '2') setView('dash');
  else if (e.altKey && e.key === '3') setView('map');
});