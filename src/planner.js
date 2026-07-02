// AI auto-planner: given a goal/feature, propose a short story breakdown and
// which standby specialists to pull in. One Bedrock call, returns structured JSON.
import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage } from '@langchain/core/messages';

export async function planWork({ goal, standby }) {
  const chat = new ChatBedrockConverse({
    model: process.env.BEDROCK_MODEL || 'qwen.qwen3-32b-v1:0',
    region: process.env.AWS_REGION || 'ap-northeast-1',
    temperature: 0.2,
  });

  const list = standby.map((a) => `- ${a.id}: ${a.name} (${a.role}) — ${a.goal}`).join('\n') || '(none available)';
  const prompt =
    `You are a tech lead planning a small, fast build.\n` +
    `Request: "${goal}"\n\n` +
    `Standby specialists you MAY pull onto the crew (only if genuinely relevant):\n${list}\n\n` +
    `Respond with ONLY a JSON object, no markdown, exactly this shape:\n` +
    `{"stories":["short story 1","short story 2"],"activate":["specialist_id"]}\n` +
    `Give 3-6 concrete stories. Put 0-3 relevant specialist ids in "activate" (use [] if none fit).`;

  const out = await chat.invoke([new HumanMessage(prompt)]);
  const text = typeof out.content === 'string'
    ? out.content
    : Array.isArray(out.content) ? out.content.map((p) => p.text || '').join('') : '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { stories: [], activate: [] };
  try {
    const j = JSON.parse(m[0]);
    return {
      stories: Array.isArray(j.stories) ? j.stories.slice(0, 8).map(String) : [],
      activate: Array.isArray(j.activate) ? j.activate.map(String) : [],
    };
  } catch {
    return { stories: [], activate: [] };
  }
}
