# Connect Digitals — Backend API

Node.js/Express + Prisma + Supabase backend for the Connect Digitals Promotion Platform.

## Stack

- **Runtime**: Node.js ≥20, TypeScript, ESM
- **Framework**: Express 4
- **Database**: PostgreSQL via Supabase (Prisma ORM)
- **Auth**: Supabase Auth + Telegram initData validation
- **Storage**: Supabase Storage (payment screenshots)
- **Notifications**: Telegram Bot (grammY)
- **Deploy**: Render (recommended) / Railway / Heroku

## Quick start

```bash
cp .env.example .env        # fill in all required values
npm install
npx prisma generate
npx prisma migrate deploy   # run migrations against production DB
npm run db:seed             # seed first SUPER_ADMIN
npm run build
npm run start
```

## Environment variables

See `.env.example` for the full list. Required in production:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler URL |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side only) |
| `SUPABASE_ANON_KEY` | Anon/public key |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins |

## Deploy to Render

1. Push this repo to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Connect the repo — Render will detect `render.yaml` automatically
4. Add all environment variables in the Render dashboard
5. Deploy

The `render.yaml` in this repo configures the service automatically.

## API health check

```
GET /health
→ { "status": "ok", "timestamp": "..." }
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev:api` | Start API in dev/watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled `dist/index.js` |
| `npm test` | Run 238 unit tests |
| `npm run db:migrate:deploy` | Apply pending migrations |
| `npm run db:seed` | Seed initial admin user |
