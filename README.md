# Kaiban Portal

**🔴 Live demo:** https://kaiban-portal.onrender.com — workshop key: **`kaiban-demo`**
(switch between the **Kanban board** and the **Live App** it's building, top-right).
> Each visitor gets their own **isolated room**; share your URL (`?room=ID`) so a
> team collaborates on one board. Free tier cold-starts (~50s) after idle and keeps
> state only in memory — use **Publish to GitHub** to persist a good build.

A multi-agent **Kanban portal** for small teams / hackathons: type what you want,
an AI crew plans it, builds it, and a human reviews on the board — then keep
dropping in feature tickets and the app gets better each time. Server-authoritative,
multi-user (rooms), runs on **AWS Bedrock** (or Anthropic). Built on [KaibanJS](https://kaibanjs.com).

## Highlights
- **Type a goal → AI plans → crew builds** (Product Manager → Engineer → QA)
- **AI auto-planner** — proposes a story breakdown and pulls in the right specialists
- **Dynamic roster** (☰ drawer) — add agents; flip standby specialists (Q&A Tester, Security, Designer) on/off
- **Human-in-the-loop** — approve or send feedback on the board; the AI revises
- **Feature tickets** — each enhances the *existing* app; **Live App** auto-updates (v1 → v2 → …)
- **Publish to GitHub** — ship the built app to a repo when it's good
- **Rooms** — isolated per visitor; share `?room=ID` to collaborate

## Quick start (local)
```bash
npm install
cp .env.example .env
npm run portal            # → http://localhost:3000  (Board)  ·  /live (the app)
```

## Config (`.env`)
```env
LLM_PROVIDER=bedrock
AWS_REGION=ap-northeast-1
BEDROCK_MODEL=qwen.qwen3-32b-v1:0
# AWS creds via env / ~/.aws / IAM role;  or LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY
WORKSHOP_PASSWORD=let-me-in     # gates all write actions on a public deploy
GITHUB_TOKEN=...                # optional: enables "Publish to GitHub"
PUBLISH_REPO=owner/todo-list-app
```

## Deploy on Render
Ships a `render.yaml`: **New + → Blueprint → this repo**, set the secrets in the
dashboard. Needs a **long-running Node process** (not static). Listens on `$PORT`.
Note: free tier keeps state in memory only — for a smooth workshop use a paid
always-on instance, or lean on Publish-to-GitHub for durability.

## Scripts
`npm run portal` (main) · `build:app` (one-shot CLI) · `hitl` (terminal HITL) · `proxy` (Bedrock↔OpenAI for the browser Kaiban Board)

MIT.
