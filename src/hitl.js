// Human-in-the-loop build. The crew pauses after Alex writes the app: a human
// reviews the code and either APPROVES it (QA proceeds) or sends FEEDBACK
// (Alex revises and re-submits). Uses KaibanJS's real validation API:
//   task.externalValidationRequired -> status AWAITING_VALIDATION
//   team.validateTask(id)  |  team.provideFeedback(id, "...")
//
//   npm run hitl
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { makeTeam } from './team.js';
import { activeProvider } from './llm.js';
import { extractHtml } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n🧑‍💻 Human-in-the-loop build`);
console.log(`   Backend: ${activeProvider()}`);
console.log(`   Morgan (PM) → Alex (Engineer) → [YOU approve] → Jordan (QA)\n`);

const team = makeTeam({ hitl: true });

// Start the workflow. NOTE: KaibanJS resolves this promise when the workflow
// first reaches BLOCKED (which is exactly what AWAITING_VALIDATION triggers), so
// we do NOT rely on it for the final result — we poll status + read the store.
team.start().catch((e) => console.error('workflow error:', e?.message || e));

// HITL_AUTO lets you run non-interactively (CI / scripted demos):
//   HITL_AUTO=approve                -> approve every gate
//   HITL_AUTO="feedback:add dark mode" -> send that feedback once, then approve
const AUTO = process.env.HITL_AUTO;
let autoFeedbackUsed = false;
let rl = null;
async function ask(promptText) {
  if (AUTO !== undefined) {
    if (AUTO.startsWith('feedback:') && !autoFeedbackUsed) {
      autoFeedbackUsed = true;
      return AUTO.slice('feedback:'.length);
    }
    return ''; // approve
  }
  if (!rl) rl = readline.createInterface({ input, output });
  return rl.question(promptText);
}

const handled = new Set(); // validation rounds we've already acted on

while (true) {
  const status = team.getWorkflowStatus();
  if (status === 'FINISHED' || status === 'STOPPED') break;

  const awaiting = team.getTasks().find((t) => t.status === 'AWAITING_VALIDATION');

  if (awaiting) {
    const round = awaiting.id + ':' + (awaiting.feedbackHistory?.length || 0);
    if (!handled.has(round)) {
      handled.add(round);
      console.log(`\n──────── ⏸  APPROVAL NEEDED: "${awaiting.title}" (by ${awaiting.agent?.name}) ────────`);
      const full = String(awaiting.result ?? '');
      console.log(full.slice(0, 600) + (full.length > 600 ? '\n…(truncated)…' : ''));
      console.log('─'.repeat(72));

      const answer = (await ask('Press ENTER to APPROVE, or type feedback to request changes: ')).trim();
      if (answer === '') {
        console.log('✅ Approved. QA continues…');
        team.validateTask(awaiting.id);
      } else {
        console.log(`🔁 Feedback sent ("${answer}") — Alex will revise…`);
        team.provideFeedback(awaiting.id, answer);
      }
    }
  } else if (status === 'BLOCKED') {
    // BLOCKED with no task awaiting validation = a real error block.
    console.error('\n❌ Workflow BLOCKED (not for validation). Aborting.');
    rl.close();
    process.exit(1);
  }
  await sleep(1200);
}

if (rl) rl.close();

// Final result lives in the store, not the (already-resolved) start() promise.
const finalHtml =
  team.getWorkflowResult?.() ??
  team.getTasks().at(-1)?.result;
const html = extractHtml(finalHtml);
const dir = path.join(__dirname, '..', 'generated');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log(`\n✅ Approved & finalized. Saved generated/index.html (${html.length} bytes).`);
console.log(`   Preview: npm start → http://localhost:${process.env.PORT || 3000}\n`);
