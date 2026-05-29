# QuerySense

QuerySense is a database performance platform that monitors PostgreSQL and MySQL, identifies slow queries, explains why they are slow, benchmarks a fix on a shadow database, and applies it to production autonomously when confidence is high. It is not an observability dashboard. It is an agent that closes the loop from detection to fix.

## Problem

Every production database eventually accumulates queries that degrade gradually. Engineers notice when users complain. The usual response is someone runs `EXPLAIN`, makes an educated guess about an index, deploys it, and watches. This works sometimes. The problem is the process is slow, reactive, and relies on tribal knowledge about which tables are large and which columns are selective.

QuerySense turns that into a continuous automated loop. It catches the query, analyzes the execution plan, benchmarks the fix on a copy of real data, and applies the index using `CREATE INDEX CONCURRENTLY` so production stays live the whole time.

## Architecture

The system has four main layers.

**Collection layer.** A Celery background worker polls `pg_stat_statements` every 30 seconds and pulls any query over a configurable threshold. For MySQL, it reads from `information_schema.events_statements_summary_by_digest`. New slow queries are pushed to the frontend immediately over WebSocket so the dashboard updates in real time.

**Analysis layer.** When a slow query is detected, the system runs `EXPLAIN ANALYZE` and parses the plan tree into structured nodes. It walks the tree looking for sequential scans, missing indexes, hash joins that spill to disk, and N+1 patterns. It also tracks a rolling history of execution times per query and uses standard deviation to flag anomalies when a query is running significantly worse than its own baseline.

**Agent layer.** An autonomous agent powered by Claude (with GPT-4o as fallback) receives the parsed analysis and runs a reasoning loop. It calls tools to inspect table statistics, check existing indexes, evaluate column selectivity, and run a shadow benchmark before deciding whether to apply, defer, or escalate. Every decision and its reasoning is recorded. The agent also maintains a memory of past fixes so it recognizes patterns it has seen before and applies known solutions faster.

**Benchmark layer.** Before any fix reaches production, it runs on a shadow PostgreSQL database. The agent creates the proposed index on the shadow DB, executes the original query 100 times before and after, and computes the improvement with enough repetitions to filter out noise. A fix only goes to production if the improvement clears 20% with consistent results. Every benchmark result is stored and visible in the History page.

```
Browser (Next.js)
      |
   WebSocket + REST
      |
FastAPI (8 routers)
      |
  ┌───────────────────────────────────┐
  │  Celery workers   │  Agent loop   │
  │  (poll, analyze)  │  (Claude API) │
  └───────────────────────────────────┘
      |                       |
  PostgreSQL (app_db)    Shadow DB (benchmarks)
  PostgreSQL (main_db)   Redis (task queue)
  MySQL (optional)
```

## Features

**Slow query detection.** Continuous polling of `pg_stat_statements` with configurable threshold. Anomaly detection using rolling standard deviation flags regressions separately from queries that are just slow by design.

**AI analysis.** EXPLAIN plan parsing produces structured issues (seq_scan, missing_index, hash_join_spill, n_plus_one) with severity levels. The AI translates the plan into plain English so developers who are not PostgreSQL experts can understand what is wrong.

**Shadow benchmarking.** Every recommendation is tested on a shadow database with real data before touching production. The benchmark runs 50 to 100 iterations and computes mean, variance, and improvement percentage.

**Autonomous agent with audit trail.** The agent records every action it takes, every tool it calls, and the reasoning behind its final decision. The audit trail is queryable through the dashboard and the API.

**Index health audit.** Separate from the slow query pipeline, the system analyzes existing indexes and categorizes them as unused (zero scans in recent history), bloated (large relative to scan frequency), or duplicate (structurally redundant with another index on the same table). Each finding includes the exact `DROP INDEX CONCURRENTLY` command to remove it safely.

**CI/CD gate.** A single POST endpoint accepts a SQL query and a set of thresholds. It returns a pass or fail verdict with the full analysis. Plugging it into a GitHub Actions workflow blocks deployments that would introduce sequential scans or exceed latency thresholds before they reach production.

**Performance regression tracking.** Query history is stored per fingerprint. The regression page shows queries where recent execution times are 20% or more above the historical baseline, grouped by severity.

**Slack integration.** Anomaly alerts, weekly summaries, and slash command support for querying database health directly from Slack without opening the dashboard.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, React Query, Recharts |
| Backend | FastAPI, Python 3.12, SQLAlchemy 2.0, Pydantic v2 |
| Task queue | Celery 5, Redis 7 |
| Databases | PostgreSQL 15, MySQL 8 |
| AI | OpenRouter (Claude 3.5 Sonnet), OpenAI (GPT-4o) |
| Auth | JWT, API key authentication |
| Observability | Prometheus metrics, Sentry error tracking |
| Deployment | Docker Compose (local), Render (production) |
| CI | GitHub Actions (79 tests, SQLite for unit, PostgreSQL for integration) |

## Getting Started

**Prerequisites.** Docker and Docker Compose. Node.js 20. Python 3.12.

Clone the repository and copy the environment file:

```bash
git clone https://github.com/Yerramsettysuchita/QuerySense.git
cd QuerySense
cp .env.example .env
```

Edit `.env` and set your API keys:

```
OPENROUTER_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
SECRET_KEY=any_long_random_string
```

Start the databases and backend services:

```bash
docker compose up main_db shadow_db app_db redis -d
cd backend && pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Start the frontend:

```bash
cd frontend && npm install && npm run dev
```

Open `http://localhost:3000`. Register an account, connect a PostgreSQL database, and click **Load Demo** on the overview page to populate all sections with realistic sample data.

## Testing

The backend test suite uses SQLite in-memory for unit tests (fast, no external dependencies) and a real PostgreSQL instance for integration tests.

```bash
cd backend

# Unit tests (79 tests, runs in ~8 seconds)
pytest tests/ -v -m "not integration"

# Integration tests (requires PostgreSQL at localhost:5432)
MAIN_DB_URL=postgresql://postgres:postgres@localhost:5432/querysense_test \
APP_DB_URL=postgresql://postgres:postgres@localhost:5432/querysense_test \
pytest tests/ -v -m "integration"
```

GitHub Actions runs both on every push to `main`.

## Deployment

The `render.yaml` at the root of the repository defines all services for one-click deployment to Render. The frontend reads `BACKEND_URL` at server startup and rewrites all `/api/*` and `/health*` traffic to the backend, so there are no CORS issues and API keys are never exposed to the browser.

## Author

Yerramsetty Sai Venkata Suchita
