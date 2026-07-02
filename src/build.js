// Runs the KaibanJS build crew and saves the app the agents produced.
//   npm run build:app   ->  writes generated/index.html
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBuildCrew } from './team.js';
import { activeProvider } from './llm.js';
import { extractHtml } from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log(`\n🏗  KaibanJS "To-Do App Build Crew"`);
console.log(`   Backend: ${activeProvider()}`);
console.log(`   Agents:  Morgan (PM) → Alex (Engineer) → Jordan (QA)\n`);

const output = await runBuildCrew();

if (output.status !== 'FINISHED') {
  console.error(`\n❌ Crew did not finish (status: ${output.status}).`);
  process.exit(1);
}

const html = extractHtml(output.result);
const dir = path.join(__dirname, '..', 'generated');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'index.html');
fs.writeFileSync(file, html);

const stats = output.stats || {};
console.log(`\n✅ The agents built the app.`);
console.log(`   Saved: generated/index.html (${html.length} bytes)`);
if (stats.duration) console.log(`   ${Number(stats.duration).toFixed(1)}s · ${stats.llmUsageStats?.totalCalls ?? '?'} LLM calls`);
console.log(`\n   Preview it:  npm start   →  http://localhost:${process.env.PORT || 3000}\n`);
