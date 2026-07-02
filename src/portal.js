// Kaiban Portal — a server-authoritative board, now MULTI-TENANT via "rooms".
//
// Each visitor gets their own isolated room (own crew, app, comments) by default.
// Sharing a room URL (?room=ID) lets a team collaborate on ONE board. The server
// holds each room's truth; browsers poll it (no websockets). Runs on AWS Bedrock.
//
//   npm run portal   ->  http://localhost:3000
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTeamFromRoster, DEFAULT_ROSTER, STANDBY_ROSTER } from './team.js';
import { activeProvider } from './llm.js';
import { extractHtml } from './util.js';
import { planWork } from './planner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '4mb' }));

// ---- protection gate (for public deployments) --------------------------------
const AUTH = process.env.WORKSHOP_PASSWORD || '';
app.get('/api/auth', (_req, res) => res.json({ required: !!AUTH }));
app.use((req, res, next) => {
  if (req.method !== 'POST' || !AUTH) return next();
  const key = req.get('x-kaiban-key') || req.query.key;
  if (key === AUTH) return next();
  res.status(401).json({ error: 'Unauthorized — enter the workshop key.' });
});

app.use(express.static(path.join(__dirname, '..', 'portal'), { extensions: ['html'] }));

// Human-in-the-loop gate: on = build pauses for approval; off = auto-completes.
// Default off on the public demo so "add feature → live app updates" flows smoothly.
const HITL = (process.env.HITL_DEFAULT || 'off').toLowerCase() !== 'off';

const DEFAULT_BRIEF =
  'A single-page "To-Do List" web app (no build step): add tasks, mark complete, delete, ' +
  'filter All/Active/Completed, an "items left" counter, localStorage persistence, clean responsive UI.';

// ---- rooms (isolated per-visitor state) --------------------------------------
const rooms = new Map();
const MAX_ROOMS = 500;

function freshTeam(room, brief) {
  room.currentGoal = brief || '';
  room.team = buildTeamFromRoster(room.roster, { mode: 'build', brief: brief || DEFAULT_BRIEF, hitl: HITL });
  room.store = room.team.getStore();
  room.started = false;
  room.comments = [];
  room.activeRound = { type: 'build', label: brief || 'default to-do app', captured: false };
}

function makeRoom(id) {
  const room = {
    id, commentSeq: 1, currentApp: '', appVersion: 0, changelog: [],
    lastPlan: null, lastAccess: Date.now(),
    roster: [...DEFAULT_ROSTER, ...STANDBY_ROSTER].map((a) => ({ ...a })),
  };
  freshTeam(room);
  return room;
}

const cleanId = (v) => (v || '').toString().slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '') || 'lobby';
function getRoom(req) {
  const id = cleanId(req.get('x-kaiban-room') || req.query.room);
  let room = rooms.get(id);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) {
      // evict the oldest idle room
      let oldest = null;
      for (const r of rooms.values()) if (!oldest || r.lastAccess < oldest.lastAccess) oldest = r;
      if (oldest) rooms.delete(oldest.id);
    }
    room = makeRoom(id);
    rooms.set(id, room);
  }
  room.lastAccess = Date.now();
  return room;
}
const isIdle = (room) => !room.started || room.team.getWorkflowStatus() === 'FINISHED';

// GC idle rooms so memory stays bounded.
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (now - r.lastAccess > 30 * 60 * 1000 && isIdle(r)) rooms.delete(id);
  }
}, 5 * 60 * 1000);

function captureIfDone(room) {
  const ar = room.activeRound;
  if (!ar || ar.captured || !room.started) return;
  if (room.team.getWorkflowStatus() !== 'FINISHED') return;
  try {
    const final = room.team.getWorkflowResult?.() ?? room.team.getTasks().at(-1)?.result;
    room.currentApp = extractHtml(final);
    room.appVersion++;
    room.changelog.push({
      version: room.appVersion,
      feature: ar.type === 'enhance' ? ar.label : `Initial build — ${ar.label}`,
      author: ar.author || 'AI crew',
      ts: Date.now(),
    });
  } catch (e) {
    console.error('[portal] capture failed:', e.message);
  } finally {
    ar.captured = true;
  }
}

const preview = (s, n = 280) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };

function snapshot(room) {
  const s = room.store.getState();
  const tasks = room.team.getTasks().map((t) => ({
    id: t.id, title: t.title, status: t.status, agent: t.agent?.name || null,
    awaiting: t.status === 'AWAITING_VALIDATION', resultPreview: preview(t.result),
  }));
  const agents = (s.agents || []).map((a) => ({ name: a.name, role: a.role, status: a.status }));
  const logs = (s.workflowLogs || []).map((l) => ({
    type: l.logType, agent: l.agent?.name || null, task: l.task?.title || null,
    desc: l.logDescription || '', agentStatus: l.agentStatus || null, taskStatus: l.taskStatus || null,
  }));
  return {
    provider: activeProvider(), workflowStatus: room.team.getWorkflowStatus(), started: room.started,
    agents, tasks, logs, comments: room.comments,
    hasApp: !!room.currentApp, appVersion: room.appVersion, changelog: room.changelog,
    round: room.activeRound ? { type: room.activeRound.type, label: room.activeRound.label } : null,
    roster: room.roster, idle: isIdle(room), plan: room.lastPlan,
    publishEnabled: !!process.env.GITHUB_TOKEN, room: room.id,
  };
}

// ---- API (all scoped to the caller's room) -----------------------------------
app.get('/api/state', (req, res) => { const room = getRoom(req); captureIfDone(room); res.json(snapshot(room)); });
app.get('/api/goal', (req, res) => res.json({ goal: getRoom(req).currentGoal }));

app.post('/api/start', (req, res) => {
  const room = getRoom(req);
  const goal = (req.body?.goal || '').trim();
  if (!room.started) {
    freshTeam(room, goal || undefined);
    room.started = true;
    room.team.start().catch((e) => console.error('[portal] workflow error:', e?.message || e));
  }
  res.json({ ok: true });
});

app.post('/api/reset', (req, res) => {
  const room = getRoom(req);
  freshTeam(room, (req.body?.goal || '').trim() || undefined);
  room.currentApp = ''; room.appVersion = 0; room.changelog = []; room.lastPlan = null;
  res.json({ ok: true });
});

app.post('/api/plan', async (req, res) => {
  const room = getRoom(req);
  if (!isIdle(room)) return res.status(409).json({ error: 'Finish the current round first.' });
  const goal = (req.body?.goal || '').trim();
  if (!goal) return res.status(400).json({ error: 'Enter what you want to build.' });
  try {
    const plan = await planWork({ goal, standby: room.roster.filter((a) => !a.active) });
    const activated = [];
    for (const id of plan.activate) {
      const a = room.roster.find((x) => x.id === id && !x.active);
      if (a) { a.active = true; activated.push(`${a.name} · ${a.role}`); }
    }
    room.lastPlan = { goal, stories: plan.stories, activated };
    res.json({ ok: true, ...room.lastPlan });
  } catch (e) {
    res.status(500).json({ error: e?.message || 'planning failed' });
  }
});

app.post('/api/enhance', (req, res) => {
  const room = getRoom(req);
  const feature = (req.body?.feature || '').trim();
  const author = (req.body?.author || 'Guest').slice(0, 40);
  if (!feature) return res.status(400).json({ error: 'Describe the feature to add.' });
  if (!room.currentApp) return res.status(409).json({ error: 'Build the app first.' });
  if (room.started && room.team.getWorkflowStatus() !== 'FINISHED') {
    return res.status(409).json({ error: 'A round is still running — wait for it to finish.' });
  }
  room.team = buildTeamFromRoster(room.roster, { mode: 'enhance', currentApp: room.currentApp, feature, hitl: HITL });
  room.store = room.team.getStore();
  room.started = true;
  room.activeRound = { type: 'enhance', label: feature, author, captured: false };
  room.team.start().catch((e) => console.error('[portal] enhance error:', e?.message || e));
  res.json({ ok: true });
});

app.post('/api/validate', (req, res) => {
  try { getRoom(req).team.validateTask(req.body?.taskId); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/feedback', (req, res) => {
  const fb = (req.body?.feedback || '').trim();
  if (!fb) return res.status(400).json({ error: 'Feedback text required.' });
  try { getRoom(req).team.provideFeedback(req.body?.taskId, fb); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/comment', (req, res) => {
  const room = getRoom(req);
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment text required.' });
  room.comments.push({ id: room.commentSeq++, taskId: req.body?.taskId || null,
    author: (req.body?.author || 'Guest').slice(0, 40), text: text.slice(0, 2000), ts: Date.now() });
  res.json({ ok: true });
});

// roster management (idle only)
app.post('/api/roster/toggle', (req, res) => {
  const room = getRoom(req);
  if (!isIdle(room)) return res.status(409).json({ error: 'Finish the current round before changing the crew.' });
  const a = room.roster.find((x) => x.id === req.body?.id);
  if (!a) return res.status(404).json({ error: 'Agent not found.' });
  a.active = !a.active; res.json({ ok: true });
});
app.post('/api/roster/add', (req, res) => {
  const room = getRoom(req);
  if (!isIdle(room)) return res.status(409).json({ error: 'Finish the current round before changing the crew.' });
  const { name, role, kind, goal } = req.body || {};
  if (!name?.trim() || !role?.trim()) return res.status(400).json({ error: 'Name and role required.' });
  if (!['plan', 'build', 'review'].includes(kind)) return res.status(400).json({ error: 'kind must be plan|build|review.' });
  room.roster.push({ id: 'x' + Date.now().toString(36), name: name.trim().slice(0, 30), role: role.trim().slice(0, 40),
    kind, goal: (goal || `Contribute as the ${role}.`).slice(0, 200), active: true, custom: true });
  res.json({ ok: true });
});
app.post('/api/roster/remove', (req, res) => {
  const room = getRoom(req);
  if (!isIdle(room)) return res.status(409).json({ error: 'Finish the current round before changing the crew.' });
  room.roster = room.roster.filter((x) => x.id !== req.body?.id); res.json({ ok: true });
});

// Publish the current app to a GitHub repo (needs GITHUB_TOKEN + PUBLISH_REPO).
app.post('/api/publish', async (req, res) => {
  const room = getRoom(req);
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.PUBLISH_REPO || 'Pubrio/todo-list-app';
  const filePath = process.env.PUBLISH_PATH || 'index.html';
  if (!token) return res.status(400).json({ error: 'Publishing is off: set GITHUB_TOKEN + PUBLISH_REPO.' });
  if (!room.currentApp) return res.status(409).json({ error: 'No app to publish yet.' });
  const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'kaiban-portal' };
  try {
    let sha; const cur = await fetch(url, { headers }); if (cur.ok) sha = (await cur.json()).sha;
    const put = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({
      message: `Publish app v${room.appVersion} from Kaiban Portal`,
      content: Buffer.from(room.currentApp, 'utf8').toString('base64'), ...(sha ? { sha } : {}) }) });
    const j = await put.json();
    if (!put.ok) return res.status(502).json({ error: j.message || 'publish failed' });
    res.json({ ok: true, commit: j.commit?.html_url, file: j.content?.html_url });
  } catch (e) { res.status(500).json({ error: e?.message || 'publish error' }); }
});

// The live app for a room (audience view iframes this with ?room=ID).
app.get('/app', (req, res) => {
  const room = getRoom(req);
  if (!room.currentApp) {
    return res.type('html').send('<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0e1117;color:#8b93a7"><div>No app built yet — start it from the board.</div></body>');
  }
  res.type('html').send(room.currentApp);
});

const PORT = process.env.PORT || process.env.PORTAL_PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Kaiban Portal (multi-tenant): http://localhost:${PORT}`);
  console.log(`  Each visitor gets an isolated room; share ?room=ID to collaborate.`);
  console.log(`  Backend: ${activeProvider()}\n`);
});
