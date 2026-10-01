# Bigreel Match Notifier — Setup Guide

Sends a Telegram message **5 minutes before each match kicks off** with a watch link to sports.bigreel.com.ng.

## 1. Create the Telegram bot

1. Open Telegram, search **@BotFather** (blue verified check).
2. Send `/newbot`.
3. Pick a display name, e.g. `Bigreel Sports Alerts`.
4. Pick a username ending in `bot`, e.g. `bigreel_alerts_bot`.
5. BotFather replies with a **token** like `123456789:AAH...` — keep it secret.

## 2. Get your chat ID

1. Open a chat with your new bot and send **any message** (just "hi").
2. Visit: `https://api.telegram.org/bot<TOKEN>/getUpdates` (paste your token).
3. Find `"chat":{"id": 123456789, ...}` in the response — that number is your **chat ID**.

For a **group**: add the bot to the group, post once, and use the (negative) group ID from getUpdates the same way. For a **channel**: add the bot as admin and use the channel ID (starts with `-100`).

## 3. Configure and run locally

```bash
cp .env.example .env       # then edit .env with your token + chat ID
npm start
```

The script loads `.env` manually (no dotenv needed) — actually it reads real environment variables, so if `.env` is not auto-loaded, export the vars or run:

```bash
TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy npm start
```

Test without sending:

```bash
npm run dry-run
```

## 4. Deploy free on Render.com

1. Push this folder to a GitHub repo.
2. On [render.com](https://render.com) → **New → Web Service** → connect the repo.
3. Settings:
   - **Runtime**: Node
   - **Build command**: `npm install` (harmless; there are no deps)
   - **Start command**: `node index.js`
   - **Instance type**: Free
4. Add environment variables under **Environment**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SPORTS=football`, `LEAD_MINUTES=5`.
5. Deploy. The bot exposes `/health` automatically on Render so the free service stays reachable.

> Note: free Render services spin down after 15 min without traffic. The `/health` endpoint keeps it from being flagged, but for guaranteed uptime you can add a free uptime monitor (e.g. cron-job.org or UptimeRobot) pinging `https://your-app.onrender.com/health` every 5 minutes.

## 5. Run on your own computer

Any machine that stays on works: `npm start` in a terminal (or `pm2 start index.js` if you use pm2). Stop it any time — `sent.json` prevents duplicate notifications after restarts.

## Adding sports later

Set `SPORTS=football,fight,motorsport` (comma-separated). Valid: `football, basketball, hockey, baseball, motorsport, fight, tennis, american-football`.

## Adding WhatsApp later

`notifier.js` exposes a provider registry — add a `whatsapp` sender with the same `(text) => Promise<void>` signature and set `NOTIFIER_PROVIDER=whatsapp`.
