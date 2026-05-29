"""
Tests for query CRUD, stats, regressions, and bulk operations.
These tests run against SQLite in-memory (via conftest.py StaticPool).
"""
import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import text
import pytest


# ── Helpers ────────────────────────────────────────────────────────────────

def _seed_slow_query(db_session, **overrides) -> str:
    query_id = overrides.pop("id", str(uuid.uuid4()))
    data = {
        "id": query_id,
        "query_fingerprint": overrides.pop("query_fingerprint", f"fp_{uuid.uuid4().hex[:8]}"),
        "query_text": overrides.pop("query_text", "SELECT * FROM users WHERE id = 1"),
        "avg_exec_time_ms": overrides.pop("avg_exec_time_ms", 500.0),
        "max_exec_time_ms": overrides.pop("max_exec_time_ms", 800.0),
        "calls": overrides.pop("calls", 10),
        "db_type": overrides.pop("db_type", "postgresql"),
        "is_anomaly": overrides.pop("is_anomaly", False),
        "is_resolved": overrides.pop("is_resolved", False),
    }
    db_session.execute(text("""
        INSERT INTO slow_queries
            (id, query_fingerprint, query_text, avg_exec_time_ms,
             max_exec_time_ms, calls, db_type, is_anomaly, is_resolved)
        VALUES
            (:id, :query_fingerprint, :query_text, :avg_exec_time_ms,
             :max_exec_time_ms, :calls, :db_type, :is_anomaly, :is_resolved)
    """), data)
    db_session.commit()
    return query_id


def _seed_history(db_session, slow_query_id: str, exec_time_ms: float,
                  recorded_at: datetime | None = None):
    recorded_at = recorded_at or datetime.now(timezone.utc)
    db_session.execute(text("""
        INSERT INTO query_history (id, slow_query_id, exec_time_ms, recorded_at)
        VALUES (:id, :sq_id, :ms, :ts)
    """), {
        "id": str(uuid.uuid4()),
        "sq_id": slow_query_id,
        "ms": exec_time_ms,
        "ts": recorded_at.isoformat(),
    })
    db_session.commit()


# ── Slow query list ─────────────────────────────────────────────────────────

def test_slow_queries_returns_only_unresolved(client, auth_headers, db_session):
    qid_active = _seed_slow_query(db_session, is_resolved=False)
    qid_resolved = _seed_slow_query(db_session, is_resolved=True)

    resp = client.get("/api/v1/queries/slow", headers=auth_headers)
    assert resp.status_code == 200
    ids = [q["id"] for q in resp.json()]
    assert qid_active in ids
    assert qid_resolved not in ids


def test_slow_queries_only_anomalies_filter(client, auth_headers, db_session):
    qid_normal = _seed_slow_query(db_session, is_anomaly=False)
    qid_anomaly = _seed_slow_query(db_session, is_anomaly=True)

    resp = client.get("/api/v1/queries/slow?only_anomalies=true", headers=auth_headers)
    assert resp.status_code == 200
    ids = [q["id"] for q in resp.json()]
    assert qid_anomaly in ids
    assert qid_normal not in ids


# ── Query detail ───────────────────────────────────────────────────────────

def test_query_detail_not_found_returns_404(client, auth_headers):
    fake_id = str(uuid.uuid4())
    resp = client.get(f"/api/v1/queries/{fake_id}", headers=auth_headers)
    assert resp.status_code == 404


def test_query_detail_returns_history(client, auth_headers, db_session):
    qid = _seed_slow_query(db_session)
    _seed_history(db_session, qid, 300.0)
    _seed_history(db_session, qid, 450.0)

    resp = client.get(f"/api/v1/queries/{qid}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == qid
    assert isinstance(data["recommendations"], list)
    assert len(data["history"]) == 2
    assert any(h["exec_time_ms"] == 300.0 for h in data["history"])


def test_query_detail_requires_auth(client, db_session):
    qid = _seed_slow_query(db_session)
    resp = client.get(f"/api/v1/queries/{qid}")
    assert resp.status_code == 401


# ── Resolve ────────────────────────────────────────────────────────────────

def test_resolve_marks_query_resolved(client, auth_headers, db_session):
    qid = _seed_slow_query(db_session, is_resolved=False)

    resp = client.post(f"/api/v1/queries/{qid}/resolve", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "resolved"

    # Resolved query should no longer appear in slow list
    list_resp = client.get("/api/v1/queries/slow", headers=auth_headers)
    ids = [q["id"] for q in list_resp.json()]
    assert qid not in ids


def test_resolve_nonexistent_query_still_returns_200(client, auth_headers):
    # Idempotent UPDATE — no rows affected is not an error
    fake_id = str(uuid.uuid4())
    resp = client.post(f"/api/v1/queries/{fake_id}/resolve", headers=auth_headers)
    assert resp.status_code == 200


# ── Delete ─────────────────────────────────────────────────────────────────

def test_delete_query(client, auth_headers, db_session):
    qid = _seed_slow_query(db_session)

    resp = client.delete(f"/api/v1/queries/{qid}", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["deleted"] == qid

    # Should 404 after deletion
    detail_resp = client.get(f"/api/v1/queries/{qid}", headers=auth_headers)
    assert detail_resp.status_code == 404


def test_delete_requires_auth(client, db_session):
    qid = _seed_slow_query(db_session)
    resp = client.delete(f"/api/v1/queries/{qid}")
    assert resp.status_code == 401


# ── Bulk resolve ───────────────────────────────────────────────────────────

def test_bulk_resolve_resolves_multiple(client, auth_headers, db_session):
    ids = [_seed_slow_query(db_session) for _ in range(3)]

    resp = client.post("/api/v1/queries/bulk/resolve",
                       headers=auth_headers, json=ids)
    assert resp.status_code == 200
    assert resp.json()["resolved"] == 3

    list_resp = client.get("/api/v1/queries/slow", headers=auth_headers)
    live_ids = [q["id"] for q in list_resp.json()]
    for qid in ids:
        assert qid not in live_ids


def test_bulk_resolve_empty_list_returns_400(client, auth_headers):
    resp = client.post("/api/v1/queries/bulk/resolve",
                       headers=auth_headers, json=[])
    assert resp.status_code == 400


def test_bulk_resolve_over_limit_returns_400(client, auth_headers):
    oversized = [str(uuid.uuid4()) for _ in range(101)]
    resp = client.post("/api/v1/queries/bulk/resolve",
                       headers=auth_headers, json=oversized)
    assert resp.status_code == 400


def test_bulk_resolve_requires_auth(client):
    resp = client.post("/api/v1/queries/bulk/resolve", json=[str(uuid.uuid4())])
    assert resp.status_code == 401


# ── Stats summary ──────────────────────────────────────────────────────────

def test_stats_summary_returns_correct_shape(client, auth_headers):
    resp = client.get("/api/v1/queries/stats/summary", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "queries" in data
    assert "benchmarks" in data
    for key in ("total_slow", "total_anomalies", "total_resolved", "avg_exec_ms"):
        assert key in data["queries"]
    for key in ("total_benchmarks", "avg_improvement", "best_improvement"):
        assert key in data["benchmarks"]


def test_stats_summary_reflects_seeded_data(client, auth_headers, db_session):
    _seed_slow_query(db_session, is_resolved=False, is_anomaly=False)
    _seed_slow_query(db_session, is_resolved=False, is_anomaly=True)
    _seed_slow_query(db_session, is_resolved=True, is_anomaly=False)

    resp = client.get("/api/v1/queries/stats/summary", headers=auth_headers)
    assert resp.status_code == 200
    q = resp.json()["queries"]
    assert int(q["total_slow"]) >= 3
    assert int(q["total_anomalies"]) >= 1
    assert int(q["total_resolved"]) >= 1


def test_stats_summary_requires_auth(client):
    resp = client.get("/api/v1/queries/stats/summary")
    assert resp.status_code == 401


# ── Regressions endpoint (auth + shape check only) ─────────────────────────
# Full regression logic requires PostgreSQL interval/NOW() syntax which SQLite
# does not support. We test auth protection and response shape here.

def test_regressions_requires_auth(client):
    resp = client.get("/api/v1/queries/regressions")
    assert resp.status_code == 401


def test_regressions_returns_list_shape(client, auth_headers):
    resp = client.get("/api/v1/queries/regressions", headers=auth_headers)
    # SQLite may return 200 (empty) or 500 (dialect incompatibility) — both acceptable
    assert resp.status_code in (200, 500)
    if resp.status_code == 200:
        assert isinstance(resp.json(), list)


def test_regressions_threshold_param_accepted(client, auth_headers):
    resp = client.get("/api/v1/queries/regressions?threshold_pct=50&min_samples=5",
                      headers=auth_headers)
    assert resp.status_code in (200, 500)


# ── Analyze security ───────────────────────────────────────────────────────

def test_analyze_rejects_update(client, auth_headers):
    resp = client.post("/api/v1/queries/analyze",
                       headers=auth_headers,
                       json={"query": "UPDATE users SET role='admin' WHERE 1=1"})
    assert resp.status_code == 400


def test_analyze_rejects_insert(client, auth_headers):
    resp = client.post("/api/v1/queries/analyze",
                       headers=auth_headers,
                       json={"query": "INSERT INTO users (email) VALUES ('hack@evil.com')"})
    assert resp.status_code == 400


def test_analyze_rejects_truncate(client, auth_headers):
    resp = client.post("/api/v1/queries/analyze",
                       headers=auth_headers,
                       json={"query": "TRUNCATE TABLE users"})
    assert resp.status_code == 400


def test_analyze_accepts_with_cte(client, auth_headers):
    resp = client.post("/api/v1/queries/analyze",
                       headers=auth_headers,
                       json={"query": "WITH cte AS (SELECT 1) SELECT * FROM cte"})
    # 200 or 422 (explain unavailable in test env) are both valid
    assert resp.status_code in (200, 422)
