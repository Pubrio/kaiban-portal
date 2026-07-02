// OpenAI-compatible proxy in front of AWS Bedrock.
// The Kaiban Board (browser) speaks the OpenAI chat API; this server translates
// that to Bedrock Converse (Qwen/Nova/...) using your server-side AWS creds.
// So the board can run everything on Bedrock without the browser ever seeing
// AWS credentials.  Point the board's llmConfig.apiBaseUrl at http://localhost:8787/v1
//
//   npm run proxy
import 'dotenv/config';
import express from 'express';
import { ChatBedrockConverse } from '@langchain/aws';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

const app = express();
app.use(express.json({ limit: '12mb' }));

// Allow the browser board (different origin) to call us.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const REGION = process.env.AWS_REGION || 'ap-northeast-1';
const DEFAULT_MODEL = process.env.BEDROCK_MODEL || 'qwen.qwen3-32b-v1:0';

function toLangchain(messages = []) {
  return messages.map((m) => {
    const c =
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((p) => p.text || '').join('')
          : '';
    if (m.role === 'system') return new SystemMessage(c);
    if (m.role === 'assistant') return new AIMessage(c);
    return new HumanMessage(c);
  });
}

// Use the model the client asked for only if it's a real Bedrock id; else default.
function pickModel(reqModel) {
  if (reqModel && /^(qwen|amazon|anthropic|meta|mistral|cohere)\./.test(reqModel)) return reqModel;
  return DEFAULT_MODEL;
}

const contentText = (c) =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text || '').join('') : '';

app.post('/v1/chat/completions', async (req, res) => {
  const { messages, stream, temperature, model } = req.body || {};
  const useModel = pickModel(model);
  const chat = new ChatBedrockConverse({ model: useModel, region: REGION, temperature: temperature ?? 0.3 });
  const lc = toLangchain(messages);
  const id = 'chatcmpl-' + Math.random().toString(36).slice(2);
  const created = Math.floor(Date.now() / 1000);

  try {
    if (stream) {
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      for await (const chunk of await chat.stream(lc)) {
        const text = contentText(chunk.content);
        if (text) {
          res.write(
            `data: ${JSON.stringify({
              id, object: 'chat.completion.chunk', created, model: useModel,
              choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
            })}\n\n`
          );
        }
      }
      res.write(
        `data: ${JSON.stringify({
          id, object: 'chat.completion.chunk', created, model: useModel,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`
      );
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const out = await chat.invoke(lc);
      res.json({
        id, object: 'chat.completion', created, model: useModel,
        choices: [{ index: 0, message: { role: 'assistant', content: contentText(out.content) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
  } catch (e) {
    console.error('[proxy] error:', e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: { message: e?.message || 'proxy error' } });
    else res.end();
  }
});

app.get('/v1/models', (_req, res) =>
  res.json({ object: 'list', data: [{ id: DEFAULT_MODEL, object: 'model', owned_by: 'bedrock' }] })
);

const PORT = process.env.PROXY_PORT || 8787;
app.listen(PORT, () => {
  console.log(`\n  Bedrock→OpenAI proxy: http://localhost:${PORT}/v1`);
  console.log(`  Forwarding to: ${DEFAULT_MODEL} (${REGION})\n`);
});
