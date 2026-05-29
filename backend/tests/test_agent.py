import pytest
from unittest.mock import patch, AsyncMock, MagicMock


# ── shared mock data ──────────────────────────────────────────────────────────

_MOCK_ANALYZE_RESULT = {
    "fingerprint": "abc123def456",
    "exec_time_ms": 2840.5,
    "issues": [
        {
            "type": "seq_scan",
            "severity": "high",
            "table": "orders",
            "message": "Full table scan on 'orders' (500000 rows). An index would eliminate this.",
        }
    ],
    "recommendations": [
        {
            "type": "index",
            "title": "Add index on orders(user_id)",
            "description": "Full table scan detected",
            "sql": "CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders (user_id);",
            "estimated_improvement_pct": 85.0,
            "risk": "low",
            "confidence": 0.92,
        }
    ],
    "plan_nodes": [
        {
            "type": "Seq Scan",
            "table": "orders",
            "rows_estimated": 500000,
            "rows_actual": 487234,
            "cost": 98234.5,
        }
    ],
}

_MOCK_CLEAN_RESULT = {
    "fingerprint": "clean123",
    "exec_time_ms": 45.2,
    "issues": [],
    "recommendations": [],
    "plan_nodes": [],
}

_MOCK_AI_EXPLANATION = (
    "The query performs a full table scan on 'orders' (500k rows) because there is no "
    "index on orders.user_id. Adding a B-tree index would drop execution time by ~85%."
)


# ── analyze + AI explanation ──────────────────────────────────────────────────

def test_analyze_with_ai_explanation(client, auth_headers):
    """Full analyze flow: issues found → AI explanation generated and returned."""
    with patch("app.api.queries.analyze_query", return_value=_MOCK_ANALYZE_RESULT), \
         patch("app.api.queries.ask_claude", new_callable=AsyncMock, return_value=_MOCK_AI_EXPLANATION):
        resp = client.post(
            "/api/v1/queries/analyze",
            headers=auth_headers,
            json={"query": "SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id"},
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "issues" in data
    assert len(data["issues"]) > 0
    assert data["issues"][0]["type"] == "seq_scan"
    assert "ai_explanation" in data
    assert data["ai_explanation"] == _MOCK_AI_EXPLANATION


def test_analyze_without_ai_still_returns_issues(client, auth_headers):
    """Analyze still returns issues even when OpenRouter returns None."""
    with patch("app.api.queries.analyze_query", return_value=_MOCK_ANALYZE_RESULT), \
         patch("app.api.queries.ask_claude", new_callable=AsyncMock, return_value=None):
        resp = client.post(
            "/api/v1/queries/analyze",
            headers=auth_headers,
            json={"query": "SELECT u.name FROM users u JOIN orders o ON u.id = o.user_id"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert "issues" in data
    assert len(data["issues"]) > 0


# ── agent run endpoint ────────────────────────────────────────────────────────

def test_agent_run_triggers_background_task(client, auth_headers):
    """Agent run returns immediately with 'running' status."""
    with patch("app.api.agent._run_agent_task"):
        resp = client.post(
            "/api/v1/agent/run",
            headers=auth_headers,
            json={
                "query": "SELECT * FROM orders WHERE user_id = 1",
                "slow_query_id": "test-123",
                "auto_apply": False,
            },
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "running"
    assert "run_id" in data


def test_agent_rejects_non_select(client, auth_headers):
    """Agent refuses to analyze non-SELECT queries."""
    resp = client.post(
        "/api/v1/agent/run",
        headers=auth_headers,
        json={"query": "UPDATE users SET password = 'hacked'", "slow_query_id": "test-456"},
    )
    assert resp.status_code == 400


def test_agent_result_not_found_for_unknown_id(client, auth_headers):
    """Agent result returns pending_or_not_found for unknown run IDs."""
    resp = client.get("/api/v1/agent/result/nonexistent-id-12345", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending_or_not_found"


# ── memory recall ─────────────────────────────────────────────────────────────

def test_memory_recall_returns_list(client, auth_headers):
    """Memory recall endpoint returns a list of similar fixes."""
    resp = client.post(
        "/api/v1/memory/recall",
        headers=auth_headers,
        json={"query": "SELECT * FROM orders WHERE user_id = 1"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "fixes" in data
    assert isinstance(data["fixes"], list)


# ── weekly report trigger ─────────────────────────────────────────────────────

def test_weekly_report_trigger(client, auth_headers):
    """Weekly report can be triggered manually."""
    mock_result = {
        "total_slow": 5, "anomalies": 1, "fixes_applied": 3,
        "avg_improvement_pct": 72.0, "total_ms_saved": 12500.0,
        "narrative": "Good week.", "week_start": "2026-05-18", "week_end": "2026-05-25",
    }
    with patch("app.agent.report.run_weekly_report", new_callable=AsyncMock, return_value=mock_result):
        resp = client.post("/api/v1/memory/report/trigger", headers=auth_headers)
    assert resp.status_code == 200


# ── CI check ──────────────────────────────────────────────────────────────────

def test_ci_check_fails_on_seq_scan(client, auth_headers):
    """CI check returns FAIL when seq scan detected."""
    with patch("app.api.cicd.analyze_query", return_value=_MOCK_ANALYZE_RESULT):
        resp = client.post(
            "/api/v1/ci/check",
            headers=auth_headers,
            json={
                "query": "SELECT * FROM orders WHERE user_id = 1",
                "fail_on_seq_scan": True,
                "fail_threshold_ms": 1000,
            },
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["passed"] is False
    assert "seq_scan_detected" in data["fail_reasons"]
    assert data["badge"] == "FAIL"


def test_ci_check_passes_when_no_issues(client, auth_headers):
    """CI check returns PASS when EXPLAIN finds no issues."""
    with patch("app.api.cicd.analyze_query", return_value=_MOCK_CLEAN_RESULT):
        resp = client.post(
            "/api/v1/ci/check",
            headers=auth_headers,
            json={
                "query": "SELECT id FROM users WHERE email = 'test@test.com'",
                "fail_on_seq_scan": True,
                "fail_threshold_ms": 1000,
            },
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["passed"] is True
    assert data["badge"] == "PASS"
    assert data["fail_reasons"] == []


# ── Slack commands ────────────────────────────────────────────────────────────

def test_slack_command_help(client):
    """Slack help command returns usage instructions."""
    import urllib.parse
    body = urllib.parse.urlencode({
        "command": "/querysense",
        "text": "help",
        "user_name": "suchita",
    })
    resp = client.post(
        "/api/v1/slack/command",
        content=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200
    assert "querysense" in resp.json()["text"].lower()


def test_slack_command_status(client):
    """Slack status command returns response with text key."""
    import urllib.parse
    body = urllib.parse.urlencode({
        "command": "/querysense",
        "text": "status",
        "user_name": "suchita",
    })
    resp = client.post(
        "/api/v1/slack/command",
        content=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200
    assert "text" in resp.json()


# ── stream pulse ──────────────────────────────────────────────────────────────

def test_stream_pulse_returns_stats(client, auth_headers):
    """Pulse endpoint returns stats + recent queries structure."""
    resp = client.get("/api/v1/stream/pulse", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "stats" in data
    assert "recent" in data
    assert "timestamp" in data
