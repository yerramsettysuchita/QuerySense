"""
Tests for the demo seed and clear endpoints.
Verifies that the full end-to-end seed populates every table
(slow_queries, query_recommendations, query_history, agent_decisions,
benchmark_results) and that clear removes it all cleanly.
"""
import uuid
from sqlalchemy import text


# ── Seed ──────────────────────────────────────────────────────────────────────

def test_seed_returns_counts(client, auth_headers):
    resp = client.post("/api/v1/demo/seed", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["seeded"] > 0
    assert data["recommendations"] > 0
    assert data["benchmarks"] > 0
    assert data["agent_decisions"] > 0


def test_seed_creates_demo_connection(client, auth_headers, db_session):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    row = db_session.execute(
        text("SELECT id FROM db_connections WHERE name = 'Demo Database' LIMIT 1")
    ).fetchone()
    assert row is not None


def test_seed_populates_slow_queries(client, auth_headers, db_session):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    count = db_session.execute(
        text("SELECT COUNT(*) FROM slow_queries")
    ).scalar()
    assert count >= 12


def test_seed_populates_recommendations(client, auth_headers, db_session):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    count = db_session.execute(
        text("SELECT COUNT(*) FROM query_recommendations")
    ).scalar()
    assert count >= 4


def test_seed_populates_query_history(client, auth_headers, db_session):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    count = db_session.execute(
        text("SELECT COUNT(*) FROM query_history")
    ).scalar()
    # 12 queries × 29 points each
    assert count >= 100


def test_seed_populates_agent_decisions(client, auth_headers, db_session):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    count = db_session.execute(
        text("SELECT COUNT(*) FROM agent_decisions")
    ).scalar()
    assert count >= 2


def test_seed_populates_benchmark_results(client, auth_headers, db_session):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    # benchmark_results joined to real recommendation IDs
    count = db_session.execute(
        text("""
            SELECT COUNT(*) FROM benchmark_results br
            JOIN query_recommendations qr ON br.recommendation_id = qr.id
        """)
    ).scalar()
    assert count >= 1


def test_seed_idempotent(client, auth_headers):
    """Calling seed twice should not insert duplicate rows."""
    first = client.post("/api/v1/demo/seed", headers=auth_headers).json()
    second = client.post("/api/v1/demo/seed", headers=auth_headers).json()
    # Second call seeded=0 because fingerprints already exist
    assert second["seeded"] == 0


def test_seed_slow_queries_visible_in_list(client, auth_headers):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    resp = client.get("/api/v1/queries/slow?limit=50", headers=auth_headers)
    assert resp.status_code == 200
    queries = resp.json()
    assert len(queries) >= 12


def test_seed_anomaly_queries_present(client, auth_headers):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    resp = client.get("/api/v1/queries/slow?only_anomalies=true", headers=auth_headers)
    assert resp.status_code == 200
    anomalies = resp.json()
    assert len(anomalies) >= 3


def test_seed_benchmark_history_visible(client, auth_headers):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    resp = client.get("/api/v1/benchmark/history", headers=auth_headers)
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) >= 1
    assert "title" in items[0]
    assert "before_ms" in items[0]
    assert "after_ms" in items[0]
    assert "improvement_pct" in items[0]


def test_seed_query_detail_has_recommendations(client, auth_headers):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    queries = client.get("/api/v1/queries/slow?limit=50", headers=auth_headers).json()
    # Find first query that should have recommendations (highest exec time = query 0)
    top = max(queries, key=lambda q: q["avg_exec_time_ms"])
    detail = client.get(f"/api/v1/queries/{top['id']}", headers=auth_headers).json()
    assert len(detail["recommendations"]) >= 1
    rec = detail["recommendations"][0]
    assert "title" in rec
    assert "sql_fix" in rec
    assert "confidence" in rec
    assert 0 < rec["confidence"] <= 1


def test_seed_query_detail_has_history(client, auth_headers):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    queries = client.get("/api/v1/queries/slow?limit=50", headers=auth_headers).json()
    top = max(queries, key=lambda q: q["avg_exec_time_ms"])
    detail = client.get(f"/api/v1/queries/{top['id']}", headers=auth_headers).json()
    assert len(detail["history"]) >= 20
    for point in detail["history"]:
        assert "exec_time_ms" in point
        assert "recorded_at" in point


def test_seed_agent_decision_accessible(client, auth_headers):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    queries = client.get("/api/v1/queries/slow?limit=50", headers=auth_headers).json()
    top = max(queries, key=lambda q: q["avg_exec_time_ms"])
    resp = client.get(f"/api/v1/agent/result/{top['id']}", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "complete"
    assert "decision" in data
    assert "reasoning" in data


# ── Clear ─────────────────────────────────────────────────────────────────────

def test_clear_removes_demo_connection(client, auth_headers, db_session):
    client.post("/api/v1/demo/seed", headers=auth_headers)
    client.delete("/api/v1/demo/clear", headers=auth_headers)
    row = db_session.execute(
        text("SELECT id FROM db_connections WHERE name = 'Demo Database' LIMIT 1")
    ).fetchone()
    assert row is None


def test_clear_removes_slow_queries(client, auth_headers, db_session):
    client.post("/api/v1/demo/seed", headers=auth_headers)

    # Count queries belonging to demo connection before clear
    before = db_session.execute(text("""
        SELECT COUNT(*) FROM slow_queries sq
        JOIN db_connections dc ON sq.connection_id = dc.id
        WHERE dc.name = 'Demo Database'
    """)).scalar()
    assert before >= 12

    client.delete("/api/v1/demo/clear", headers=auth_headers)

    after = db_session.execute(text("""
        SELECT COUNT(*) FROM slow_queries sq
        JOIN db_connections dc ON sq.connection_id = dc.id
        WHERE dc.name = 'Demo Database'
    """)).scalar()
    assert after == 0


def test_clear_is_idempotent(client, auth_headers):
    """Clearing when no demo data exists should not error."""
    resp1 = client.delete("/api/v1/demo/clear", headers=auth_headers)
    resp2 = client.delete("/api/v1/demo/clear", headers=auth_headers)
    assert resp1.status_code == 200
    assert resp2.status_code == 200


def test_clear_requires_auth(client):
    resp = client.delete("/api/v1/demo/clear")
    assert resp.status_code == 401


def test_seed_requires_auth(client):
    resp = client.post("/api/v1/demo/seed")
    assert resp.status_code == 401


def test_seed_and_clear_full_cycle(client, auth_headers, db_session):
    """Seed → verify data → clear → verify gone."""
    client.post("/api/v1/demo/seed", headers=auth_headers)

    queries_after_seed = client.get(
        "/api/v1/queries/slow?limit=50", headers=auth_headers
    ).json()
    assert len(queries_after_seed) >= 12

    client.delete("/api/v1/demo/clear", headers=auth_headers)

    queries_after_clear = client.get(
        "/api/v1/queries/slow?limit=50", headers=auth_headers
    ).json()
    assert len(queries_after_clear) == 0
