# Kaiban Portal

**🔴 Live demo:** https://kaiban-portal.onrender.com — workshop key: **`kaiban-demo`**
(switch between the **Kanban board** and the **Live App** it's building, top-right).
> Free tier: first hit after idle cold-starts (~50s). Built-app state is in-memory,
> so a restart resets it — that's what **Publish to GitHub** is for.

A multi-agent **Kanban portal** for small teams / hackathons: type what you want,
an AI crew plans it, builds it, and a human reviews on the board — then keep
dropping in feature tickets and the app gets better each time. Server-authoritative,
multi-user, runs on **AWS Bedrock** (or Anthropic). Built on [KaibanJS](https://kaibanjs.com).

## Highlights
- **Type a goal → AI plans → crew builds** (Product Manager → Engineer → QA)
- **AI auto-planner** — proposes a story breakdown and pulls in the right specialists
- **Dynamic roster** (☰ drawer) — add agents; flip standby specialists (Q&A Tester, Security, Designer) on/off
- **Human-in-the-loop** — approve or send feedback on the board; the AI revises
- **Feature tickets** — each enhances the *existing* app; **Live App** auto-updates (v1 → v2 → …)
- **Publish to GitHub** — ship the built app to a repo when it's good
- **Multi-user** — server holds the truth; anyone with the URL reviews steps & comments; it keeps running

## Quick start (local)
```bash
npm install
cp .env.example .env      # choose backend + creds
npm run portal            # → http://localhost:3000  (Board)  ·  /live (the app)
```

## Backends & config (`.env`)
```env
LLM_PROVIDER=bedrock
AWS_REGION=ap-northeast-1
BEDROCK_MODEL=qwen.qwen3-32b-v1:0
# AWS creds via env / ~/.aws / IAM role
# LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY=... also supported

WORKSHOP_PASSWORD=let-me-in     # gates all write actions on a public deploy
GITHUB_TOKEN=...                # optional: enables "Publish to GitHub"
PUBLISH_REPO=owner/todo-list-app
```

## Deploy on Render (one click)
This repo ships a `render.yaml`. On Render: **New + → Blueprint → pick this repo**,
then set the secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `WORKSHOP_PASSWORD`,
optional `GITHUB_TOKEN`) in the dashboard. The portal needs a **long-running Node
process** — not static hosting. Listens on `$PORT`.

## Scripts
| Command | What |
|---|---|
| `npm run portal` | The multi-user board + live app (main) |
| `npm run build:app` | CLI: run the crew once → `generated/index.html` |
| `npm run hitl` | CLI: human-in-the-loop build in the terminal |
| `npm run proxy` | OpenAI-compatible → Bedrock proxy (for the browser Kaiban Board) |

MIT.
