# Kaiban Portal

A multi-agent **Kanban portal** for small teams / hackathons: type what you want,
an AI crew plans it, builds it, and a human reviews on the board — then keep
dropping in feature tickets and the app gets better each time. Server-authoritative,
multi-user, runs on **AWS Bedrock** (or Anthropic). Built on [KaibanJS](https://kaibanjs.com).

## Highlights
- **Type a goal → AI plans → crew builds** (Product Manager → Engineer → QA)
- **AI auto-planner** — proposes a story breakdown and pulls in the right specialists
- **Dynamic roster** — add agents; flip standby specialists (Q&A Tester, Security, Designer) on/off
- **Human-in-the-loop** — approve or send feedback right on the board; the AI revises
- **Feature tickets** — each one enhances the *existing* app; live app auto-updates (v1 → v2 → …)
- **Multi-user** — server holds the truth; anyone with the URL reviews steps & comments; it keeps running
- **Comments**, **AI-steps timeline**, **changelog/versioning**

## Quick start
```bash
npm install
cp .env.example .env      # choose backend + creds
npm run portal            # → http://localhost:4000  (board)  ·  /live (the app)
```

## Backends (`.env`)
```env
# AWS Bedrock (server-side; no key in the browser)
LLM_PROVIDER=bedrock
AWS_REGION=ap-northeast-1
BEDROCK_MODEL=qwen.qwen3-32b-v1:0
# ...AWS creds via env / ~/.aws / IAM role

# or Anthropic
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-ant-...

# Protect a public deployment (optional): gates all write actions
# WORKSHOP_PASSWORD=let-me-in
```

## Scripts
| Command | What |
|---|---|
| `npm run portal` | The multi-user board + live app (main app) |
| `npm run build:app` | CLI: run the crew once, write `generated/index.html` |
| `npm run hitl` | CLI: human-in-the-loop build in the terminal |
| `npm run proxy` | OpenAI-compatible → Bedrock proxy (for the browser Kaiban Board) |
| `npm start` | Serve the last built app |

## Deploying publicly
The portal needs a **long-running Node process** (it holds state and serves the
evolving app) — deploy on Render / Railway / Fly / a VM, **not** static hosting.
Set `WORKSHOP_PASSWORD` and keep AWS creds in the host's env (never in git).

MIT.
