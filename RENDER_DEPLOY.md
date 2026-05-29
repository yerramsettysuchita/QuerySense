# Deploying QuerySense to Render

## What deploys

| Service | Render type | Plan | Cost |
|---|---|---|---|
| querysense-backend | Web Service (Docker) | Starter | $7/mo |
| querysense-frontend | Web Service (Node) | Free | $0 |
| querysense-celery-worker | Background Worker (Docker) | Starter | $7/mo |
| querysense-celery-beat | Background Worker (Docker) | Starter | $7/mo |
| querysense-main-db | PostgreSQL | Free | $0 (90-day expiry) |
| querysense-shadow-db | PostgreSQL | Free | $0 (90-day expiry) |
| querysense-app-db | PostgreSQL | Free | $0 (90-day expiry) |
| querysense-redis | Redis | Free | $0 |

**Minimum cost: ~$21/month** (3 Starter services). Upgrade databases to paid plans for production beyond 90 days.

---

## Step 1 — Push code to GitHub

```bash
cd QuerySense
git init
git add .
git commit -m "Initial commit"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/querysense.git
git push -u origin main
```

> Your `.env` is already in `.gitignore` — it will not be committed.

---

## Step 2 — Create a Render account

Go to [render.com](https://render.com) and sign up (GitHub login is easiest).

---

## Step 3 — Deploy via Blueprint

1. In the Render dashboard, click **New → Blueprint**
2. Connect your GitHub account if prompted
3. Select your `querysense` repository
4. Render will detect `render.yaml` automatically
5. Click **Apply** — Render will create all 8 services

Render deploys in dependency order: databases → redis → backend → celery workers → frontend.
This takes **10–15 minutes** on first build.

---

## Step 4 — Set secret environment variables

After the backend service is running, go to the Render dashboard:

**querysense-backend → Environment → Edit**

Fill in these values (marked `sync: false` in render.yaml — Render left them blank intentionally):

| Variable | Value |
|---|---|
| `OPENROUTER_API_KEY` | Your OpenRouter key from openrouter.ai |
| `OPENAI_API_KEY` | Your OpenAI key from platform.openai.com |
| `CORS_ORIGINS` | `https://querysense-frontend.onrender.com` (copy the frontend URL from Render) |
| `APP_BASE_URL` | `https://querysense-frontend.onrender.com` |
| `SENTRY_DSN` | Optional — your Sentry DSN for error tracking |
| `SLACK_WEBHOOK_URL` | Optional — your Slack incoming webhook |

Click **Save Changes** → Render will auto-redeploy the backend.

Do the same for **querysense-celery-worker** and **querysense-celery-beat**:
- Set `OPENROUTER_API_KEY` and `OPENAI_API_KEY` to the same values

---

## Step 5 — Run database migrations

Once the backend is **Live** (green dot), open the Render Shell:

**querysense-backend → Shell**

```bash
alembic upgrade head
python scripts/seed.py
```

---

## Step 6 — Verify

| Check | URL |
|---|---|
| Backend health | `https://querysense-backend.onrender.com/health` |
| Backend deep health | `https://querysense-backend.onrender.com/health/deep` |
| API docs | `https://querysense-backend.onrender.com/docs` |
| Frontend | `https://querysense-frontend.onrender.com` |

All health checks should return `"status": "ok"`.

---

## Troubleshooting

**Frontend shows "Failed to fetch" errors**
→ The `CORS_ORIGINS` env var on the backend doesn't include the frontend URL. Update it and redeploy.

**Celery worker exits immediately**
→ Check the worker logs in Render. Common cause: `REDIS_URL` not set correctly. Render auto-sets this from the Redis service — verify it looks like `redis://...`.

**Database connection errors on startup**
→ Free PostgreSQL instances on Render may take 30–60 seconds to become available after a cold start. The backend will retry — check logs after 2 minutes.

**`pg_stat_statements` warnings in logs**
→ Expected. Render's managed PostgreSQL does not expose `pg_stat_statements`. The backend degrades gracefully — monitoring will work when you connect a user's own database via the onboarding flow.

**Free tier services spin down**
→ Render free web services spin down after 15 minutes of inactivity. The first request after a spin-down takes ~30 seconds. Upgrade to Starter ($7/mo) to keep services always-on.

---

## Updating after deploy

Push to `main` → Render auto-deploys all services that changed.

To force a redeploy: **Dashboard → Service → Manual Deploy → Deploy latest commit**
