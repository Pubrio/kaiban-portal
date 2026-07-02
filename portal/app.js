const $ = (id) => document.getElementById(id);
let authKey = localStorage.getItem('kaiban_key') || '';
async function api(p, body) {
  const opts = body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-kaiban-key': authKey }, body: JSON.stringify(body) }
    : undefined;
  const r = await fetch(p, opts);
  if (r.status === 401) {
    const k = window.prompt('This board is protected. Enter the workshop key:');
    if (k) { authKey = k; localStorage.setItem('kaiban_key', k); return api(p, body); }
  }
  return r.json();
}

// ---- identity (each viewer names themselves; stored locally) ----
// Non-blocking default (no prompt() — those freeze automated browsers).
let me = localStorage.getItem('kaiban_me') || 'Guest-' + Math.floor(Math.random() * 900 + 100);
localStorage.setItem('kaiban_me', me);
$('me').textContent = me;
$('rename').onclick = () => {
  const n = window.prompt('Your name:', me);
  if (n) { me = n; localStorage.setItem('kaiban_me', n); $('me').textContent = n; }
};

// ---- colors per agent ----
const COLORS = ['#6c8cff', '#8a6cff', '#f5a623', '#35c692', '#ff6b6b'];
const colorFor = (name) => COLORS[[...(name || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = (n) => (n || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

// ---- column mapping ----
const COL = (status) => {
  if (status === 'TODO') return 'todo';
  if (status === 'DOING' || status === 'REVISE' || status === 'RESUMED') return 'doing';
  if (status === 'AWAITING_VALIDATION' || status === 'BLOCKED' || status === 'PAUSED') return 'review';
  return 'done'; // DONE, VALIDATED
};
const agentBadge = (status) => {
  if (/THINKING|EXECUTING|USING_TOOL|OBSERVATION|SELF_QUESTION/.test(status)) return ['thinking', 'working'];
  if (status === 'TASK_COMPLETED' || status === 'FINAL_ANSWER') return ['done', 'done'];
  return ['idle', 'idle'];
};

let state = null;
let openTaskId = null;

// ---- controls ----
// The bar is smart: before an app exists it BUILDS; after, it ADDS A FEATURE.
$('plan').onclick = async () => {
  const v = $('goal').value.trim();
  if (state?.hasApp) {
    if (!v) return alert('Describe a feature to add.');
    const r = await api('/api/enhance', { feature: v, author: me });
    if (r.error) alert(r.error); else $('goal').value = '';
  } else {
    await api('/api/start', { goal: v });
  }
  poll();
};
$('reset').onclick = async () => { if (confirm('Reset the board and app?')) { await api('/api/reset', { goal: $('goal').value }); poll(); } };

$('publish').onclick = async () => {
  if (!confirm('Publish the current app to GitHub?')) return;
  $('publish').disabled = true; $('publish').textContent = '⬆ Publishing…';
  try {
    const r = await api('/api/publish', {});
    if (r.error) alert(r.error);
    else if (r.commit) window.open(r.commit, '_blank');
  } finally {
    $('publish').disabled = false; $('publish').textContent = '⬆ Publish to GitHub';
  }
};

// AI auto-plan: propose stories + pull in specialists, then you review & build.
$('autoplan').onclick = async () => {
  const v = $('goal').value.trim();
  if (!v) return alert('Type what you want to build first.');
  $('autoplan').disabled = true; $('autoplan').textContent = '🧠 Planning…';
  try {
    const r = await api('/api/plan', { goal: v });
    if (r.error) alert(r.error);
    await poll();
  } finally {
    $('autoplan').disabled = false; $('autoplan').textContent = '🧠 Auto-plan';
  }
};

function renderPlan(plan) {
  const p = $('planpanel');
  if (!plan || !(plan.stories || []).length) { p.classList.add('hidden'); return; }
  p.classList.remove('hidden');
  p.innerHTML = '';
  const h = document.createElement('div'); h.className = 'plan-head';
  h.textContent = `🧠 Plan for "${plan.goal}"` + (plan.activated?.length ? ` · pulled in: ${plan.activated.join(', ')}` : '');
  p.appendChild(h);
  const ul = document.createElement('ul');
  (plan.stories || []).forEach((s) => { const li = document.createElement('li'); li.textContent = s; ul.appendChild(li); });
  p.appendChild(ul);
}

// ---- drawer + roster ----
const openDrawer = () => { $('drawer').classList.remove('hidden'); $('drawer-scrim').classList.remove('hidden'); };
const closeDrawer = () => { $('drawer').classList.add('hidden'); $('drawer-scrim').classList.add('hidden'); };
$('drawer-toggle').onclick = openDrawer;
$('drawer-close').onclick = closeDrawer;
$('drawer-scrim').onclick = closeDrawer;

const KIND_LABEL = { plan: 'plans', build: 'builds', review: 'reviews' };
function renderRoster() {
  const roster = state?.roster || [];
  const idle = state?.idle;
  const row = (a) => {
    const el = document.createElement('div');
    el.className = 'agent-row';
    const info = document.createElement('div');
    info.className = 'agent-info';
    const nm = document.createElement('div'); nm.className = 'agent-name';
    nm.innerHTML = `<span class="avatar sm" style="background:${colorFor(a.name)}">${initials(a.name)}</span> `;
    nm.appendChild(document.createTextNode(`${a.name} · ${a.role}`));
    const kd = document.createElement('div'); kd.className = 'agent-kind'; kd.textContent = KIND_LABEL[a.kind] || a.kind;
    info.appendChild(nm); info.appendChild(kd);
    const tog = document.createElement('button');
    tog.className = 'btn ' + (a.active ? 'primary' : 'ghost') + ' tiny';
    tog.textContent = a.active ? 'On' : 'Off';
    tog.disabled = !idle;
    tog.onclick = async () => { await api('/api/roster/toggle', { id: a.id }); await poll(); };
    el.appendChild(info); el.appendChild(tog);
    return el;
  };
  const act = $('roster-active-list'); act.innerHTML = '';
  roster.filter((a) => a.active).forEach((a) => act.appendChild(row(a)));
  const stb = $('roster-standby-list'); stb.innerHTML = '';
  roster.filter((a) => !a.active).forEach((a) => stb.appendChild(row(a)));
}
$('na-add').onclick = async () => {
  const body = { name: $('na-name').value, role: $('na-role').value, kind: $('na-kind').value, goal: $('na-goal').value };
  const r = await api('/api/roster/add', body);
  if (r.error) return alert(r.error);
  $('na-name').value = ''; $('na-role').value = ''; $('na-goal').value = '';
  await poll();
};

function commentCount(taskId) {
  return (state?.comments || []).filter((c) => c.taskId === taskId).length;
}

function render() {
  if (!state) return;
  $('provider').textContent = state.provider;
  const st = state.workflowStatus || '—';
  const wf = $('wf-status');
  wf.textContent = state.started ? st : 'not started';
  wf.className = 'wf-status ' + (st === 'RUNNING' ? 'running' : st === 'FINISHED' ? 'finished' : st === 'BLOCKED' ? 'blocked' : '');

  // Smart bar + version + changelog
  const busy = state.started && st !== 'FINISHED';
  $('goal').placeholder = state.hasApp
    ? 'Add a feature to improve the app (e.g. add a dark-mode toggle)…'
    : 'What do you want the crew to build? (e.g. a Pomodoro timer web app)';
  $('plan').textContent = state.hasApp ? '＋ Add feature' : 'Plan & Build →';
  $('plan').disabled = busy && state.hasApp;
  const av = $('appver');
  av.classList.toggle('hidden', !state.hasApp);
  av.textContent = 'App v' + state.appVersion;
  $('publish').classList.toggle('hidden', !(state.publishEnabled && state.hasApp));
  const cl = $('changelog');
  cl.classList.toggle('hidden', !(state.changelog || []).length);
  cl.innerHTML = '';
  (state.changelog || []).slice().reverse().forEach((c) => {
    const chip = document.createElement('span');
    chip.className = 'clchip';
    chip.innerHTML = `<b>v${c.version}</b> `;
    chip.appendChild(document.createTextNode(c.feature + ' · ' + (c.author || 'AI')));
    cl.appendChild(chip);
  });

  const agentStatus = {};
  (state.agents || []).forEach((a) => (agentStatus[a.name] = a.status));

  ['todo', 'doing', 'review', 'done'].forEach((c) => ($('col-' + c).innerHTML = ''));
  const counts = { todo: 0, doing: 0, review: 0, done: 0 };

  (state.tasks || []).forEach((t) => {
    const col = COL(t.status);
    counts[col]++;
    const [bClass, bText] = t.awaiting ? ['await', 'needs review'] : agentBadge(agentStatus[t.agent] || 'INITIAL');
    const card = document.createElement('div');
    card.className = 'card';
    card.onclick = () => openTask(t.id);
    const cc = commentCount(t.id);
    card.innerHTML = `
      <div class="ctitle"></div>
      <div class="cfoot">
        <div class="cmeta">
          <span class="avatar" style="background:${colorFor(t.agent)}">${initials(t.agent)}</span>
          <span class="name">${escapeHtml(t.agent || '')}</span>
        </div>
        <div class="cmeta">
          ${cc ? `<span class="cc">💬 ${cc}</span>` : ''}
          <span class="badge ${bClass}">${bText}</span>
        </div>
      </div>`;
    card.querySelector('.ctitle').textContent = t.title;
    $('col-' + col).appendChild(card);
  });
  Object.keys(counts).forEach((c) => ($('c-' + c).textContent = counts[c]));

  // Activity feed (newest first)
  const feed = $('feed');
  feed.innerHTML = '';
  (state.logs || []).slice().reverse().forEach((l) => {
    if (!l.desc) return;
    const row = document.createElement('div');
    row.className = 'step';
    row.innerHTML = `<span class="who" style="color:${colorFor(l.agent)}"></span><span class="desc"></span>`;
    row.querySelector('.who').textContent = l.agent || '•';
    row.querySelector('.desc').textContent = ' ' + l.desc;
    feed.appendChild(row);
  });

  renderRoster();
  renderPlan(state.plan);
  if (openTaskId) renderModal();
}

// ---- task modal ----
function openTask(id) { openTaskId = id; $('modal').classList.remove('hidden'); renderModal(); }
$('modal-close').onclick = () => { openTaskId = null; $('modal').classList.add('hidden'); };

function renderModal() {
  const t = (state.tasks || []).find((x) => x.id === openTaskId);
  if (!t) return;
  $('m-title').textContent = t.title;
  $('m-agent').textContent = '👤 ' + (t.agent || '');
  $('m-status').textContent = t.status;
  $('m-result').textContent = t.resultPreview || '(no output yet)';

  $('m-review').classList.toggle('hidden', !t.awaiting);

  // AI steps for this task
  const steps = (state.logs || []).filter((l) => l.task === t.title && l.desc);
  $('m-steps').innerHTML = steps.map((l) => `<div class="s"><b>${escapeHtml(l.agent || '•')}</b> ${escapeHtml(l.desc)}</div>`).join('') || '<div class="s">No steps yet.</div>';

  // Comments
  const cs = (state.comments || []).filter((c) => c.taskId === t.id);
  $('m-comments').innerHTML = cs.map((c) =>
    `<div class="comment"><span class="ctime">${new Date(c.ts).toLocaleTimeString()}</span>` +
    `<div class="cauthor">${escapeHtml(c.author)}</div><div class="ctext">${escapeHtml(c.text)}</div></div>`
  ).join('') || '<div class="cc">No comments yet.</div>';
}

$('m-approve').onclick = async () => { await api('/api/validate', { taskId: openTaskId }); };
$('m-send').onclick = async () => {
  const fb = $('m-feedback').value.trim();
  if (!fb) return alert('Type feedback, or use Approve.');
  await api('/api/feedback', { taskId: openTaskId, feedback: fb });
  $('m-feedback').value = '';
};
$('m-comment-send').onclick = postComment;
$('m-comment-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') postComment(); });
async function postComment() {
  const text = $('m-comment-input').value.trim();
  if (!text) return;
  await api('/api/comment', { taskId: openTaskId, author: me, text });
  $('m-comment-input').value = '';
  await poll();
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ---- polling loop (server holds the truth; UI keeps running) ----
async function poll() { try { state = await api('/api/state'); render(); } catch (_) {} }
poll();
setInterval(poll, 1500);
// preload current goal
api('/api/goal').then((g) => { if (g.goal) $('goal').value = g.goal; });
