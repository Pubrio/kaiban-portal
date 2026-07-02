// -----------------------------------------------------------------------------
// A KaibanJS "software crew": three AI agents act as teammates on a dev team and
// BUILD a to-do-list web app from a product brief. This is the KaibanJS demo —
// you give agents roles + prefilled tasks, hit start, and they produce software.
//
//   Morgan (Product Manager) ─▶ Alex (Frontend Engineer) ─▶ Jordan (QA Engineer)
//        requirements                the code                 reviewed final app
// -----------------------------------------------------------------------------

import { Agent, Task, Team } from 'kaibanjs';
import { buildLlm, modelFor } from './llm.js';

// The product brief the crew builds against. Edit this to change what they make.
export const BRIEF = `A single-page "To-Do List" web app that works with no build step.
Requirements:
- Add a task via a text input + button (and Enter key).
- Each task can be marked complete (checkbox, strike-through when done).
- Delete a task.
- Filter buttons: All / Active / Completed.
- A counter showing how many tasks are left.
- Persist tasks in the browser's localStorage so they survive a reload.
- A clean, modern, responsive UI. No external libraries or CDNs.`;

// The three teammates. Each is a distinct KaibanJS Agent. Per-agent model
// overrides (via MODEL_MORGAN / MODEL_ALEX / MODEL_JORDAN env vars) let you demo
// multi-model routing — e.g. Qwen for planning, a coder model for building.
export function makeCrew() {
  const morgan = new Agent({
    name: 'Morgan',
    role: 'Product Manager',
    goal: 'Turn a product brief into crisp requirements and acceptance criteria.',
    background: 'Writes tight, testable user stories that engineers can build from directly.',
    ...buildLlm({ model: modelFor('morgan') }),
  });

  const alex = new Agent({
    name: 'Alex',
    role: 'Frontend Engineer',
    goal: 'Implement the app as a single self-contained index.html file.',
    background: 'Ships clean vanilla HTML/CSS/JS with no frameworks or build tooling.',
    ...buildLlm({ model: modelFor('alex') }),
  });

  const jordan = new Agent({
    name: 'Jordan',
    role: 'QA Engineer',
    goal: 'Verify the app meets every acceptance criterion and deliver the final code.',
    background: 'Rigorous reviewer who fixes gaps and returns production-ready code.',
    ...buildLlm({ model: modelFor('jordan') }),
  });

  return { morgan, alex, jordan };
}

// The prefilled tasks — the heart of the demo. One task per agent, run in order.
// Pass { hitl: true } to require a human to approve Alex's build before QA runs
// (the task lands in AWAITING_VALIDATION until validateTask/provideFeedback).
export function makeTasks({ morgan, alex, jordan }, { hitl = false } = {}) {
  const requirementsTask = new Task({
    title: 'Write requirements',
    description: `Read this product brief and produce the spec:\n\n{brief}\n\n` +
      `Output: (1) a short list of user stories, and (2) a numbered list of concrete, ` +
      `testable acceptance criteria. Be specific and implementation-ready. No code.`,
    expectedOutput: 'User stories plus a numbered list of acceptance criteria.',
    agent: morgan,
  });

  const buildTask = new Task({
    title: 'Build the app',
    description:
      `Using Morgan's acceptance criteria, implement the app as ONE self-contained ` +
      `index.html file: HTML, a <style> block, and a <script> block. Vanilla JS only, ` +
      `no libraries, no CDNs. Persist tasks in localStorage. ` +
      `Output ONLY the complete file, starting with <!DOCTYPE html> and ending with </html>.`,
    expectedOutput: 'A single complete, valid index.html document.',
    externalValidationRequired: hitl,
    agent: alex,
  });

  const qaTask = new Task({
    title: 'Review & finalize',
    description:
      `Review Alex's index.html against every acceptance criterion. Fix any bug or missing ` +
      `feature (add/complete/delete, All/Active/Completed filters, remaining counter, ` +
      `localStorage persistence). Then output ONLY the final, corrected, complete index.html ` +
      `— starting with <!DOCTYPE html> and ending with </html>. No commentary, no code fences.`,
    expectedOutput: 'The final, corrected, complete index.html document.',
    agent: jordan,
  });

  return [requirementsTask, buildTask, qaTask];
}

// Build a fresh Team (not started). Caller decides how to run it.
// `brief` lets a user supply what they want built (Claude-Code style input).
export function makeTeam({ hitl = false, brief } = {}) {
  const crew = makeCrew();
  const tasks = makeTasks(crew, { hitl });
  return new Team({
    name: 'To-Do App Build Crew',
    agents: [crew.morgan, crew.alex, crew.jordan],
    tasks,
    inputs: { brief: brief?.trim() || BRIEF },
  });
}

// Convenience: build a fresh team and run it to completion.
export function runBuildCrew() {
  return makeTeam().start();
}

// ---------------------------------------------------------------------------
// Dynamic roster: the crew is assembled at runtime from whoever is active.
// Each agent has a `kind` that decides what work it gets:
//   plan   -> contributes notes/requirements before the build
//   build  -> the one engineer that produces the deliverable (HITL gate)
//   review -> reviews/hardens the result after the build (QA, security, …)
// Standby specialists can be switched on when a job needs them.
// ---------------------------------------------------------------------------
export const DEFAULT_ROSTER = [
  { id: 'morgan', name: 'Morgan', role: 'Product Manager', kind: 'plan', active: true,
    goal: 'Turn the brief into concrete requirements and acceptance criteria.' },
  { id: 'alex', name: 'Alex', role: 'Frontend Engineer', kind: 'build', active: true,
    goal: 'Implement the app as one self-contained index.html.' },
  { id: 'jordan', name: 'Jordan', role: 'QA Engineer', kind: 'review', active: true,
    goal: 'Verify the app meets every acceptance criterion and finalize the code.' },
];

export const STANDBY_ROSTER = [
  { id: 'quinn', name: 'Quinn', role: 'Q&A Tester', kind: 'review', active: false,
    goal: 'Probe edge cases (empty input, long text, reload) and fix any bug you find.' },
  { id: 'dana', name: 'Dana', role: 'UX Designer', kind: 'plan', active: false,
    goal: 'Recommend clean, accessible, responsive UI/UX for the request.' },
  { id: 'sam', name: 'Sam', role: 'Security Reviewer', kind: 'review', active: false,
    goal: 'Flag and fix XSS / unsafe innerHTML / storage issues in the code.' },
];

function agentFrom(def) {
  return new Agent({
    name: def.name,
    role: def.role,
    goal: def.goal,
    background: def.role,
    // Give heavy single-file rewrites more room before MAX_ITERATIONS, and force
    // a final answer instead of looping on a hallucinated tool call.
    maxIterations: 15,
    forceFinalAnswer: true,
    ...buildLlm({ model: modelFor(def.id) }),
  });
}

// Build a team from the active roster for either a fresh build or an enhancement.
export function buildTeamFromRoster(roster, { mode = 'build', brief, currentApp, feature, hitl = true }) {
  const active = roster.filter((a) => a.active);
  const builderDef = active.find((a) => a.kind === 'build');
  if (!builderDef) throw new Error('Roster needs at least one "build" agent.');
  const planners = active.filter((a) => a.kind === 'plan');
  const reviewers = active.filter((a) => a.kind === 'review');

  const agents = active.map(agentFrom);
  const byId = {};
  active.forEach((d, i) => (byId[d.id] = agents[i]));

  const tasks = [];
  const lastReviewer = reviewers[reviewers.length - 1];

  if (mode === 'build') {
    for (const p of planners) {
      tasks.push(new Task({
        title: `${p.role}: plan`,
        description: `Product brief:\n"${brief}"\n\nAs the ${p.role}, give your concrete input for it ` +
          `(${p.goal}). Bullet points, implementation-ready, no code.`,
        expectedOutput: `${p.role} notes.`,
        agent: byId[p.id],
      }));
    }
    tasks.push(new Task({
      title: 'Build the app',
      description: `Using the team's notes, build the app for: "${brief}". ONE self-contained index.html ` +
        `(HTML + <style> + <script>, vanilla JS, localStorage). Output ONLY the complete file, ` +
        `from <!DOCTYPE html> to </html>.`,
      expectedOutput: 'A complete index.html.',
      externalValidationRequired: hitl,
      isDeliverable: reviewers.length === 0,
      agent: byId[builderDef.id],
    }));
  } else {
    tasks.push(new Task({
      title: `Apply: ${String(feature).slice(0, 50)}`,
      description: `Improve this existing app:\n\n\`\`\`html\n${currentApp}\n\`\`\`\n\nApply this request, ` +
        `keeping ALL existing functionality: "${feature}". Output ONLY the complete updated index.html.`,
      expectedOutput: 'The complete updated index.html.',
      externalValidationRequired: hitl,
      isDeliverable: reviewers.length === 0,
      agent: byId[builderDef.id],
    }));
  }

  for (const r of reviewers) {
    tasks.push(new Task({
      title: `${r.role}: review`,
      description: `As the ${r.role} (${r.goal}), review the current index.html, fix issues you own, ` +
        `then output ONLY the final complete index.html. No commentary.`,
      expectedOutput: 'The final complete index.html.',
      isDeliverable: r === lastReviewer,
      agent: byId[r.id],
    }));
  }

  return new Team({ name: 'Kaiban Crew', agents, tasks });
}

// An enhancement crew: takes the CURRENT app + a feature request and improves it.
// Alex applies the change; a human reviews (HITL); Jordan finalizes. This is the
// "keep assigning tickets, the app gets better each time" loop.
export function makeEnhanceTeam({ currentApp, feature, hitl = true }) {
  const { alex, jordan } = makeCrew();

  const applyTask = new Task({
    title: `Apply: ${String(feature).slice(0, 60)}`,
    description:
      `You are improving an existing single-file web app. Current index.html:\n\n` +
      '```html\n' + currentApp + '\n```\n\n' +
      `Apply this feature request, keeping ALL existing functionality intact:\n"${feature}"\n\n` +
      `Output ONLY the complete updated index.html, from <!DOCTYPE html> to </html>. ` +
      `No commentary, no code fences.`,
    expectedOutput: 'The complete updated index.html.',
    externalValidationRequired: hitl,
    agent: alex,
  });

  const qaTask = new Task({
    title: 'QA the change',
    description:
      `Verify the requested change was applied correctly and nothing else broke, then output ` +
      `ONLY the final, complete, corrected index.html. No commentary, no code fences.`,
    expectedOutput: 'The final complete index.html.',
    isDeliverable: true,
    agent: jordan,
  });

  return new Team({
    name: 'Enhancement Crew',
    agents: [alex, jordan],
    tasks: [applyTask, qaTask],
  });
}
