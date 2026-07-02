// Kaiban Portal — a server-authoritative board.
//
// The KaibanJS crew runs HERE, on the server, on Bedrock Qwen. It keeps running
// no matter who is (or isn't) watching. Different people open the portal URL to
// review the stages/steps, comment, and drive the human-in-the-loop gate.
// State is polled over plain HTTP (no websockets); the server holds the truth.
//
//   npm run portal   ->  http://localhost:4000  (share your LAN IP with teammates)
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
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
// If WORKSHOP_PASSWORD is set, every mutating (POST) action requires the key.
// Reads (viewing the board / app) stay open so an audience can watch.
const AUTH = process.env.WORKSHOP_PASSWORD || '';
app.get('/api/auth', (_req, res) => res.json({ required: !!AUTH }));
app.use((req, res, next) => {
  if (req.method !== 'POST' || !AUTH) return next();
  const key = req.get('x-kaiban-key') || req.query.key;
  if (key === AUTH) return next();
  res.status(401).json({ error: 'Unauthorized — enter the workshop key.' });
});

app.use(express.static(path.join(__dirname, '..', 'portal'), { extensions: ['html'] }));

// ---- server-side run state ---------------------------------------------------
let team = null;
let store = null;
let started = false;
let comments = []; // { id, taskId, author, text, ts }
let commentSeq = 1;

// The evolving app + its history — this is what "gets better" each ticket.
let currentApp = '';
let appVersion = 0;
let changelog = []; // { version, feature, author, ts }
let activeRound = null; // { type:'build'|'enhance', label, author, captured }

const GEN = path.join(__dirname, '..', 'generated');

// The editable team roster (default crew + standby specialists).
let roster = [...DEFAULT_ROSTER, ...STANDBY_ROSTER].map((a) => ({ ...a }));
const DEFAULT_BRIEF =
  'A single-page "To-Do List" web app (no build step): add tasks, mark complete, delete, ' +
  'filter All/Active/Completed, an "items left" counter, localStorage persistence, clean responsive UI.';

let currentGoal = '';
function freshTeam(brief) {
  currentGoal = brief || '';
  team = buildTeamFromRoster(roster, { mode: 'build', brief: brief || DEFAULT_BRIEF, hitl: true });
  store = team.getStore();
  started = false;
  comments = [];
  activeRound = { type: 'build', label: brief || 'default to-do app', captured: false };
}
const isIdle = () => !started || team.getWorkflowStatus() === 'FINISHED';
freshTeam();

// When a round finishes, capture its deliverable as the new app version.
function captureIfDone() {
  if (!activeRound || activeRound.captured || !started) return;
  if (team.getWorkflowStatus() !== 'FINISHED') return;
  try {
    const final = team.getWorkflowResult?.() ?? team.getTasks().at(-1)?.result;
    const html = extractHtml(final);
    currentApp = html;
    fs.mkdirSync(GEN, { recursive: true });
    fs.writeFileSync(path.join(GEN, 'index.html'), html);
    appVersion++;
    changelog.push({
      version: appVersion,
      feature: activeRound.type === 'enhance' ? activeRound.label : `Initial build — ${activeRound.label}`,
      author: activeRound.author || 'AI crew',
      ts: Date.now(),
    });
    console.log(`[portal] app v${appVersion} shipped (${activeRound.type})`);
  } catch (e) {
    console.error('[portal] capture failed:', e.message);
  } finally {
    activeRound.captured = true;
  }
}

// ---- helpers: map KaibanJS objects to plain JSON (avoid circular refs) --------
const preview = (s, n = 400) => {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n) + '…' : t;
};

function snapshot() {
  const s = store.getState();
  const tasks = team.getTasks().map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    agent: t.agent?.name || null,
    awaiting: t.status === 'AWAITING_VALIDATION',
    resultPreview: preview(t.result, 280),
    feedback: (t.feedbackHistory || []).map((f) => ({ content: f.content, status: f.status })),
  }));
  const agents = (s.agents || []).map((a) => ({ name: a.name, role: a.role, status: a.status }));
  const logs = (s.workflowLogs || []).map((l, i) => ({
    i,
    type: l.logType,
    agent: l.agent?.name || null,
    task: l.task?.title || null,
    desc: l.logDescription || '',
    agentStatus: l.agentStatus || null,
    taskStatus: l.taskStatus || null,
    time: l.timestamp || null,
  }));
  return {
    provider: activeProvider(),
    workflowStatus: team.getWorkflowStatus(),
    started,
    agents,
    tasks,
    logs,
    comments,
    hasApp: !!currentApp,
    appVersion,
    changelog,
    round: activeRound ? { type: activeRound.type, label: activeRound.label } : null,
    roster,
    idle: isIdle(),
    plan: lastPlan,
  };
}

// ---- API ---------------------------------------------------------------------
app.get('/api/state', (_req, res) => {
  captureIfDone();
  res.json(snapshot());
});

app.post('/api/start', (req, res) => {
  const goal = (req.body?.goal || '').trim();
  if (!started) {
    // Always (re)assemble the crew from the current roster + goal before starting.
    freshTeam(goal || undefined);
    started = true;
    team.start().catch((e) => console.error('[portal] workflow error:', e?.message || e));
    console.log(`[portal] workflow started — crew: ${roster.filter((a) => a.active).map((a) => a.name).join(', ')}`);
  }
  res.json({ ok: true });
});

app.post('/api/reset', (req, res) => {
  freshTeam((req.body?.goal || '').trim() || undefined);
  console.log('[portal] reset');
  res.json({ ok: true });
});

app.get('/api/goal', (_req, res) => res.json({ goal: currentGoal }));

// AI auto-planner: propose a story breakdown + pull in relevant specialists.
let lastPlan = null;
app.post('/api/plan', async (req, res) => {
  if (!isIdle()) return res.status(409).json({ error: 'Finish the current round first.' });
  const goal = (req.body?.goal || '').trim();
  if (!goal) return res.status(400).json({ error: 'Enter what you want to build.' });
  try {
    const plan = await planWork({ goal, standby: roster.filter((a) => !a.active) });
    const activated = [];
    for (const id of plan.activate) {
      const a = roster.find((x) => x.id === id && !x.active);
      if (a) { a.active = true; activated.push(`${a.name} · ${a.role}`); }
    }
    lastPlan = { goal, stories: plan.stories, activated };
    console.log(`[portal] planned "${goal}" — ${plan.stories.length} stories, activated: ${activated.join(', ') || 'none'}`);
    res.json({ ok: true, ...lastPlan });
  } catch (e) {
    console.error('[portal] plan error:', e?.message || e);
    res.status(500).json({ error: e?.message || 'planning failed' });
  }
});

// Add a feature ticket: the crew improves the CURRENT app. Only when idle.
app.post('/api/enhance', (req, res) => {
  const feature = (req.body?.feature || '').trim();
  const author = (req.body?.author || 'Guest').slice(0, 40);
  if (!feature) return res.status(400).json({ error: 'Describe the feature to add.' });
  if (!currentApp) return res.status(409).json({ error: 'Build the app first.' });
  if (started && team.getWorkflowStatus() !== 'FINISHED') {
    return res.status(409).json({ error: 'A round is still running — wait for it to finish.' });
  }
  team = buildTeamFromRoster(roster, { mode: 'enhance', currentApp, feature, hitl: true });
  store = team.getStore();
  started = true;
  activeRound = { type: 'enhance', label: feature, author, captured: false };
  team.start().catch((e) => console.error('[portal] enhance error:', e?.message || e));
  console.log(`[portal] enhance ticket: "${feature}"`);
  res.json({ ok: true });
});

// ---- roster management (only while idle, so we don't mutate a running crew) --
app.get('/api/roster', (_req, res) => res.json({ roster, idle: isIdle() }));

app.post('/api/roster/toggle', (req, res) => {
  if (!isIdle()) return res.status(409).json({ error: 'Finish the current round before changing the crew.' });
  const a = roster.find((x) => x.id === req.body?.id);
  if (!a) return res.status(404).json({ error: 'Agent not found.' });
  a.active = !a.active;
  res.json({ ok: true, roster });
});

app.post('/api/roster/add', (req, res) => {
  if (!isIdle()) return res.status(409).json({ error: 'Finish the current round before changing the crew.' });
  const { name, role, kind, goal } = req.body || {};
  if (!name?.trim() || !role?.trim()) return res.status(400).json({ error: 'Name and role required.' });
  if (!['plan', 'build', 'review'].includes(kind)) return res.status(400).json({ error: 'kind must be plan|build|review.' });
  roster.push({
    id: 'x' + Date.now().toString(36),
    name: name.trim().slice(0, 30),
    role: role.trim().slice(0, 40),
    kind,
    goal: (goal || `Contribute as the ${role}.`).slice(0, 200),
    active: true,
    custom: true,
  });
  res.json({ ok: true, roster });
});

app.post('/api/roster/remove', (req, res) => {
  if (!isIdle()) return res.status(409).json({ error: 'Finish the current round before changing the crew.' });
  roster = roster.filter((x) => x.id !== req.body?.id);
  res.json({ ok: true, roster });
});

// The live app itself (audience view iframes this).
app.get('/app', (_req, res) => {
  if (!currentApp) {
    return res
      .type('html')
      .send('<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0e1117;color:#8b93a7"><div>No app built yet — start it from the portal.</div></body>');
  }
  res.type('html').send(currentApp);
});

app.post('/api/validate', (req, res) => {
  const { taskId } = req.body || {};
  try {
    team.validateTask(taskId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/feedback', (req, res) => {
  const { taskId, feedback } = req.body || {};
  if (!feedback?.trim()) return res.status(400).json({ error: 'Feedback text required.' });
  try {
    team.provideFeedback(taskId, feedback.trim());
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/comment', (req, res) => {
  const { taskId, author, text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Comment text required.' });
  const c = { id: commentSeq++, taskId: taskId || null, author: (author || 'Guest').slice(0, 40), text: text.trim().slice(0, 2000), ts: Date.now() };
  comments.push(c);
  res.json({ ok: true, comment: c });
});

// Final built app (when finished)
app.get('/api/result', (_req, res) => {
  try {
    const final = team.getWorkflowResult?.() ?? team.getTasks().at(-1)?.result;
    const html = extractHtml(final);
    const dir = path.join(__dirname, '..', 'generated');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    res.type('html').send(html);
  } catch (e) {
    res.status(409).json({ error: 'Not ready: ' + e.message });
  }
});

const PORT = process.env.PORTAL_PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Kaiban Portal: http://localhost:${PORT}`);
  console.log(`  Share on your LAN so teammates can join & review.`);
  console.log(`  Backend: ${activeProvider()}\n`);
});
