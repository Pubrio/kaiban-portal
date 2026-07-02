# To-Do App, built by a KaibanJS AI crew

A KaibanJS demo: you give a small **team of AI agents** roles and a few
**prefilled tasks**, hit run, and the agents **build a to-do-list web app for you**.
The generated app is saved to `generated/index.html` and served by a tiny server.

```
  npm run build:app
      │
      ▼   KaibanJS Team "To-Do App Build Crew"
  ┌──────────────┐   ┌──────────────────┐   ┌────────────────────┐
  │ Morgan (PM)  │──▶│ Alex (Engineer)  │──▶│ Jordan (QA)        │
  │ requirements │   │ writes index.html│   │ reviews + finalizes│
  └──────────────┘   └──────────────────┘   └────────────────────┘
      │
      ▼
  generated/index.html   ← the app the agents wrote
      │
      ▼
  npm start  →  http://localhost:3000
```

## The crew and its prefilled tasks

Defined in [`src/team.js`](src/team.js):

| Agent | Role | Prefilled task |
|-------|------|----------------|
| **Morgan** | Product Manager | Turn the product brief into user stories + acceptance criteria |
| **Alex** | Frontend Engineer | Implement it as one self-contained `index.html` (vanilla JS, localStorage) |
| **Jordan** | QA Engineer | Review against the criteria, fix gaps, output the final `index.html` |

The product brief the crew builds against is the `BRIEF` constant in `src/team.js` —
edit it and re-run to have the agents build something different.

## Run it

```bash
cd todo-ai
npm install
cp .env.example .env      # pick your LLM backend (see below)
npm run build:app         # the agents build the app  → generated/index.html
npm start                 # serve it → http://localhost:3000
```

## LLM backend (swappable — the Claude / Bedrock part)

Controlled by `LLM_PROVIDER` in `.env`. The wiring lives in [`src/llm.js`](src/llm.js),
which shows the two ways KaibanJS attaches a model to an agent:

- **`llmConfig`** — a built-in provider by name (used for Anthropic Claude).
- **`llmInstance`** — any LangChain chat model you construct (used for AWS Bedrock
  via `ChatBedrockConverse`). This is the escape hatch for Bedrock / self-hosted / proxies.

### Option A — Anthropic Claude
```env
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-20240620
```

### Option B — AWS Bedrock (what this demo ran on)
```env
LLM_PROVIDER=bedrock
AWS_REGION=ap-southeast-1
BEDROCK_MODEL=apac.amazon.nova-lite-v1:0
# credentials via env vars, ~/.aws/credentials, SSO, or an IAM role
```

> **Region note:** Claude-on-Bedrock is **geo-blocked** from some countries/regions
> (e.g. HK/CN — see anthropic.com/supported-countries). This demo therefore ran on
> **Amazon Nova**, which is not restricted. To use Claude, set an Anthropic key or run
> Bedrock from a supported region. Any Bedrock model works — just change `BEDROCK_MODEL`
> (e.g. a `qwen.*` id in us-west-2 / us-east-1 / ap-northeast-1).

## Advanced (workshop demos)

### 1. Human-in-the-loop approval gate
Alex's build task is gated on human approval before QA runs. Uses KaibanJS's real
validation API (`externalValidationRequired` → `AWAITING_VALIDATION` →
`team.validateTask` / `team.provideFeedback`).

```bash
npm run hitl
# The crew pauses after Alex builds. Press ENTER to approve, or type feedback
# (e.g. "add a dark mode toggle") to send it back — Alex revises and re-submits.
```
Non-interactive modes for scripted demos:
```bash
HITL_AUTO=approve npm run hitl
HITL_AUTO="feedback:add a dark mode toggle" npm run hitl   # revise once, then approve
```

### 2. Multi-model routing (heterogeneous crew)
Run each agent on a different Bedrock model via env vars — great for showing
"right model for the job" (e.g. a coder model builds, a cheap model reviews):
```bash
MODEL_MORGAN=qwen.qwen3-32b-v1:0 \
MODEL_ALEX=qwen.qwen3-coder-30b-a3b-v1:0 \
MODEL_JORDAN=amazon.nova-lite-v1:0 \
npm run build:app
```

## Files

```
src/team.js     # the 3 agents + 3 prefilled build tasks + Team (+ HITL flag, per-agent models)
src/llm.js      # backend factory: llmConfig (Anthropic) or llmInstance (Bedrock); per-agent model override
src/build.js    # runs the crew, extracts the HTML, writes generated/index.html
src/hitl.js     # human-in-the-loop build with an approval gate + feedback/revise loop
src/server.js   # serves generated/index.html
generated/      # the app the agents produced (created by build:app / hitl)
```

## Want the visual Kaiban Board?

KaibanJS ships a Trello-style board to watch agents work in real time:
```bash
npx kaibanjs@latest init && npm run kaiban
```
Note the board runs LLM calls **from the browser** (via `VITE_` keys), so it can't
use AWS Bedrock credentials directly — use an OpenAI/Google key there, or Anthropic
from a supported region. This project keeps keys **server-side**, which is the safer
pattern for real use.
```
