# QuerySense — 3-Minute Demo Script

## Setup before recording
- [ ] All 7 Docker containers running
- [ ] seed.py executed (50K orders, 10K users)
- [ ] At least 1 slow query in the system (run the seeded DB join manually)
- [ ] Browser at http://localhost:3000 — dark mode, full screen
- [ ] Terminal ready with curl commands

---

## Script

### 0:00 – 0:20 | Hook

> "Every engineering team has this problem. A query that worked fine at 1,000 users
> starts taking 3 seconds at 100,000. You don't find out until users complain.
> This is QuerySense."

*Show landing page. Click "Open dashboard".*

---

### 0:20 – 0:50 | Live monitoring

> "The agent is already watching. It polls pg_stat_statements every 30 seconds —
> no instrumentation, no code changes."

*Show PulseBar ticking. Show LiveFeed with green dot.*
*Point to a slow query card in the feed.*

> "This query appeared automatically. 2,840ms average. 847 calls. Let's see why."

*Click the query.*

---

### 0:50 – 1:30 | Analysis

> "EXPLAIN runs immediately. The plan parser walks every node."

*Show execution plan — red seq scan node.*

> "Full table scan on orders. 500,000 rows. No index on user_id.
> And look — estimated 1,000 rows, actual 47,000. The planner is flying blind."

*Point to AI explanation panel.*

> "Claude explains this in plain English so anyone on the team understands it —
> not just the senior DBA."

*Show three ranked recommendations. Point to confidence scores and risk levels.*

---

### 1:30 – 2:00 | Shadow DB benchmark

> "Before we touch production, we test. One click."

*Click "Test on shadow DB" on the index recommendation.*

> "QuerySense copies 10,000 rows to an isolated database, applies the index,
> runs the query 50 times, and gives us actual numbers."

*Wait for result to appear.*

> "Before: 2,840ms. After: 180ms. 94% improvement. Confirmed on real data."

---

### 2:00 – 2:30 | Apply

> "One click generates the migration SQL. CONCURRENTLY — so it never locks the table."

*Click "Apply + copy SQL". Show the SQL.*

```sql
CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders (user_id);
```

> "Copy it, drop it in your migration file, deploy. Done."

*Show the query moving to resolved in the dashboard.*

---

### 2:30 – 2:50 | Index health + CI

*Navigate to Indexes tab.*

> "We also found 12 unused indexes wasting 340MB and slowing down every write."

*Navigate to CI tab.*

> "And for the next PR — this endpoint catches slow queries before they ship."

```bash
curl -X POST .../api/v1/ci/check \
  -d '{"query":"SELECT...","fail_on_seq_scan":true}'
# → {"passed": false, "badge": "FAIL", "fail_reasons": ["seq_scan_detected"]}
```

---

### 2:50 – 3:00 | Close

> "QuerySense. Detect, analyze, benchmark, fix.
> Zero production risk. Fully automated."

*End on dashboard — green dot, metrics showing improvement.*

---

## Key numbers to mention
- 2,840ms → 180ms (94% improvement)
- 10 phases, 48 hours
- 7 Docker services
- PostgreSQL + MySQL
- Real shadow DB — not simulated
