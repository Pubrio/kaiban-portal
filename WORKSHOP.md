# Workshop: run Kaiban Portal locally

You'll build & improve a web app with a crew of AI agents on a Kanban board.

## 1. Prerequisites
- Node.js 18+ and npm
- The **AWS credentials** for this workshop (ask the host — shared privately, not in this repo)

## 2. Get it running
```bash
git clone https://github.com/Pubrio/kaiban-portal.git
cd kaiban-portal
npm install
cp .env.example .env
# open .env and paste the AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY the host gave you
npm run portal
```
Open **http://localhost:3000** (write actions use the workshop key from `.env`).

## 3. Try it
1. Type a goal (e.g. *"a Pomodoro timer"*) → **Plan & Build**. Watch the agents work in **AI Steps**.
2. With **✋ Review: On**, the build pauses in **Q&A Review** — open the card, then **Approve** (or send feedback and the AI revises).
3. Flip to **Live App** (top-right) to use what the crew built.
4. Add a feature (e.g. *"add a dark mode toggle"*) → the live app updates a version better.
5. Open **☰** (top-left) to add agents or switch on specialists (Q&A Tester, Security, Designer).

## Notes
- **Rooms**: your URL has `?room=xxxx`. Share it and teammates join the *same* board; a different URL = a private board.
- Prefer no local setup? Use the hosted demo: **https://kaiban-portal.onrender.com** (key: `kaiban-demo`).
- If a build ever gets stuck, it's the model — retry, or set `BEDROCK_MODEL=amazon.nova-pro-v1:0` in `.env` for higher reliability.
