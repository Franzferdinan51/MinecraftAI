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
function fmtTime(t) {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── chat ──
async function loadChat() {
  try {
    const r = await api('/api/chat?count=60');
    if (!r.ok) return;
    const box = $('#messages');
    const fresh = visibleMessages(r.messages);
    for (const m of fresh) appendMsg(m);
    if (fresh.length) box.scrollTop = box.scrollHeight;
  } catch (e) { /* offline, retry next tick */ }
}
function visibleMessages(all) {
  // only messages never rendered; filter by view
  const fresh = all.filter((m) => !rendered.has(msgKey(m)));
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
async function loadState() {
  try {
    const r = await api('/api/state');
    if (!r.ok) return;
    bots = r.bots;
    renderMembers(); renderCards(); renderRail();
    if (view === 'dash') renderDash();
    $('#online-count').textContent = bots.filter((b) => b.online).length;
  } catch (e) { /* retry */ }
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
  document.body.dataset.view = (v === 'status' || v === 'goal' || v === 'dash' || v === 'map') ? v : 'chat';
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
  } else if (v === 'dash') {
    $('#chan-name').textContent = 'dashboard';
    $('#chan-topic').textContent = 'pause bots, set think pace — live, no restart';
    renderDash();
  } else {
    $('#chan-name').textContent = v;
    $('#chan-topic').textContent = 'DM — only ' + v + ' hears and answers (others keep working)';
    $('#input').placeholder = `Message @${v} — tell them what to do in plain words`;
  }
  $('#messages').innerHTML = '';
  rendered.clear();
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

// ── dashboard ──
const PACES = [[30000, '30s'], [45000, '45s'], [60000, '60s'], [90000, '90s'], [120000, '2m'], [180000, '3m']];
function renderDash() {
  const box = $('#dash-rows');
  if (!box) return;
  box.innerHTML = bots.map((b) => `
    <div class="dash-row">
      <b style="color:${b.color}">${esc(b.name)}</b>
      <span class="role">${esc(b.role)} · ${b.ticks ?? '?'} thinks · ${esc((b.last_action || '—').slice(0, 80))}</span>
      <select data-pace="${esc(b.name)}">${PACES.map(([ms, label]) => `<option value="${ms}" ${b.interval_ms === ms ? 'selected' : ''}>${label}</option>`).join('')}</select>
      <button class="pause-btn ${b.paused ? 'on' : ''}" data-pause="${esc(b.name)}" type="button">${b.paused ? '▶ Resume' : '⏸ Pause'}</button>
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

// ── live map ──
const HOUSE = [50, 63, 85];
const BEDS = [[46, 77], [48, 77], [50, 77], [52, 77]];
function drawMap() {
  const cv = $('#map');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, range = 70;
  const px = (x) => (x - (HOUSE[0] - range)) / (range * 2) * W;
  const pz = (z) => (z - (HOUSE[2] - range)) / (range * 2) * W;
  ctx.fillStyle = '#1e1f22'; ctx.fillRect(0, 0, W, W);
  ctx.strokeStyle = '#2b2d31';
  for (let g = 0; g <= W; g += W / 14) {
    ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, W); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(W, g); ctx.stroke();
  }
  // beds + house
  ctx.fillStyle = '#faa81a';
  BEDS.forEach(([x, z]) => ctx.fillRect(px(x) - 3, pz(z) - 3, 6, 6));
  ctx.fillStyle = '#5865f2';
  ctx.beginPath(); ctx.arc(px(HOUSE[0]), pz(HOUSE[2]), 8, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('HOUSE', px(HOUSE[0]), pz(HOUSE[2]) - 12);
  // bots
  ctx.textAlign = 'center';
  bots.forEach((b) => {
    if (!b.pos) return;
    ctx.fillStyle = b.paused ? '#555' : b.color;
    ctx.beginPath(); ctx.arc(px(b.pos[0]), pz(b.pos[2]), 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
    ctx.fillText(b.name, px(b.pos[0]), pz(b.pos[2]) - 13);
  });
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
    const items = r.data?.items || r.data?.inventory || r.data || [];
    const rows = Array.isArray(items) ? items : Object.entries(items).map(([n, c]) => ({ name: n, count: c }));
    $('#inv-list').innerHTML = rows.length
      ? rows.map((it) => `<div class="inv-row"><span>${esc(it.name || it.item || '?')}</span><b>x${it.count ?? 1}</b></div>`).join('')
      : 'empty pockets';
  } catch { $('#inv-list').textContent = 'offline'; }
}

// ── loops ──
setView('global');
loadState();
loadQueueActions();
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
setInterval(loadChat, 3000);
setInterval(loadState, 5000);
setInterval(() => { if (careBot) loadQueue(); }, 5000);
setInterval(() => { if (view === 'team') loadTeam(); }, 4000);
setInterval(() => { if (view === 'map') drawMap(); }, 5000);
setInterval(checkAlerts, 15000);
document.addEventListener('input', (e) => { if (e.target && e.target.id === 'chat-filter' && (view === 'global' || view === 'team')) { $('#messages').innerHTML = ''; rendered.clear(); teamSeen.clear(); loadChat(); loadTeam(); } });
