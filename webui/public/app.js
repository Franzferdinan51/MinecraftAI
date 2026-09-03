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
  if (view === 'global') return fresh;
  if (view === 'status') return [];
  // DM view: messages from that bot, or our DMs to them
  return fresh.filter((m) =>
    m.from === view || (m.from === 'Duckets (web)' && m.channel === 'dm:' + view));
}
function appendMsg(m) {
  rendered.add(msgKey(m));
  if (view !== 'global' && !(m.from === view || (m.from === 'Duckets (web)' && m.channel === 'dm:' + view))) return;
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
    el.onclick = () => { careBot = el.dataset.bot; setView(careBot); renderMembers(); $('#care-name').textContent = careBot; };
  });
}
function renderCards() {
  $('#status-cards').innerHTML = bots.map((b) => `
    <div class="card" style="--c:${b.color}">
      <h3>${esc(b.name)}<span class="dot ${b.online ? 'on' : 'off'}">● ${b.online ? 'online' : 'offline'}</span></h3>
      <div class="role">${esc(b.role)} · :${b.port}</div>
      ${b.online ? `
      <div class="row">❤ Health ${b.health}/20</div><div class="bar"><i class="hp" style="width:${b.health * 5}%"></i></div>
      <div class="row">🍖 Food ${b.food}/20</div><div class="bar"><i class="food" style="width:${b.food * 5}%"></i></div>
      <div class="row">📍 ${b.pos ? b.pos.join(', ') : '?'} · ${b.time} · holding ${esc(b.holding)}</div>
      <div class="task">${b.task ? '⚙ ' + esc(typeof b.task === 'string' ? b.task : (b.task.action || JSON.stringify(b.task))) : 'idle'}</div>`
      : `<div class="row">${esc(b.error || 'no response')}</div>`}
    </div>`).join('');
}
function renderRail() {
  $('#dm-rail').innerHTML = bots.map((b) =>
    `<div class="dm-dot ${view === b.name ? 'sel' : ''}" data-bot="${esc(b.name)}" title="${esc(b.name)}" style="--c:${b.color};background:${b.color}">${esc(b.name[0])}</div>`).join('');
  $('#dm-list').innerHTML = bots.map((b) =>
    `<div class="chan ${view === b.name ? 'active' : ''}" data-bot="${esc(b.name)}"><span class="hash">@</span>${esc(b.name)}</div>`).join('');
  document.querySelectorAll('[data-bot]').forEach((el) => {
    el.onclick = () => { careBot = el.dataset.bot; setView(careBot); renderRail(); renderMembers(); $('#care-name').textContent = careBot; };
  });
}

// ── views ──
function setView(v) {
  view = v;
  document.body.dataset.view = v === 'status' ? 'status' : 'chat';
  document.querySelectorAll('#channels .chan').forEach((c) => c.classList.remove('active'));
  if (v === 'global') {
    document.querySelector('[data-view="global"]').classList.add('active');
    $('#chan-name').textContent = 'global-chat';
    $('#chan-topic').textContent = 'everything said in the world, live';
    $('#input').placeholder = 'Message #global-chat — every bot hears you like in-game chat';
  } else if (v === 'status') {
    document.querySelector('[data-view="status"]').classList.add('active');
    $('#chan-name').textContent = 'bot-status';
    $('#chan-topic').textContent = 'health, food, position, current task';
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
  const target = (view === 'global' || view === 'status') ? 'all' : view;
  try {
    const r = await api('/api/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target, message: text }) });
    if (!r.ok) toast('send failed: ' + (r.error || '?'));
    else { toast(target === 'all' ? 'said it — watch for replies' : target + ' heard you'); loadChat(); }
  } catch { toast('mission control offline?'); }
};

// ── care buttons ──
document.querySelectorAll('#care-btns button').forEach((btn) => {
  btn.onclick = async () => {
    if (!careBot) return toast('pick a bot first');
    const r = await api('/api/manage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bot: careBot, op: btn.dataset.op }) });
    $('#care-out').textContent = JSON.stringify(r.ok ? (r.inventory || r) : r, null, 1).slice(0, 800);
    loadState();
  };
});

// ── loops ──
setView('global');
loadState();
setInterval(loadChat, 3000);
setInterval(loadState, 5000);
