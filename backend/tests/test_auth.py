import uuid


def test_signup_returns_token(client):
    unique = str(uuid.uuid4())[:8]
    resp = client.post("/api/v1/auth/signup", json={
        "name": "Suchita",
        "email": f"suchita_{unique}@test.com",
        "password": "password123",
        "workspace_name": "My Workspace",
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["success"] is True
    assert "token" in data["data"]
    assert data["data"]["user"]["email"] == f"suchita_{unique}@test.com"
    assert data["data"]["workspace"]["name"] == "My Workspace"


def test_duplicate_email_returns_409(client):
    unique = str(uuid.uuid4())[:8]
    payload = {
        "name": "User",
        "email": f"dup_{unique}@test.com",
        "password": "password123",
        "workspace_name": "WS",
    }
    client.post("/api/v1/auth/signup", json=payload)
    resp = client.post("/api/v1/auth/signup", json=payload)
    assert resp.status_code == 409


def test_login_valid_credentials(client, auth_headers):
    assert auth_headers is not None


def test_login_wrong_password_returns_401(client):
    unique = str(uuid.uuid4())[:8]
    client.post("/api/v1/auth/signup", json={
        "name": "U", "email": f"u_{unique}@test.com",
        "password": "correct", "workspace_name": "W",
    })
    resp = client.post("/api/v1/auth/login", json={
        "email": f"u_{unique}@test.com",
        "password": "wrong",
    })
    assert resp.status_code == 401


def test_protected_route_no_auth_returns_401(client):
    resp = client.get("/api/v1/queries/slow")
    assert resp.status_code == 401


def test_protected_route_with_auth_returns_200(client, auth_headers):
    resp = client.get("/api/v1/queries/slow", headers=auth_headers)
    assert resp.status_code == 200


def test_me_endpoint(client, auth_headers):
    resp = client.get("/api/v1/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    assert "user" in resp.json()["data"]


def test_connection_test_no_auth_required(client):
    resp = client.post("/api/v1/connections/test", json={
        "url": "postgresql://postgres:postgres@localhost:5432/querysense_main"
    })
    assert resp.status_code != 401


def test_analyze_rejects_non_select(client, auth_headers):
    resp = client.post("/api/v1/queries/analyze",
        headers=auth_headers,
        json={"query": "DROP TABLE users"})
    assert resp.status_code == 400


def test_analyze_rejects_delete(client, auth_headers):
    resp = client.post("/api/v1/queries/analyze",
        headers=auth_headers,
        json={"query": "DELETE FROM users WHERE 1=1"})
    assert resp.status_code == 400


def test_analyze_accepts_select(client, auth_headers):
    resp = client.post("/api/v1/queries/analyze",
        headers=auth_headers,
        json={"query": "SELECT u.name, COUNT(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.id, u.name"})
    assert resp.status_code in (200, 422)


def test_health_endpoint(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_api_key_create_and_use(client, auth_headers):
    resp = client.post("/api/v1/auth/api-keys",
        headers=auth_headers,
        json={"name": "test-key"})
    assert resp.status_code == 200, resp.text
    raw_key = resp.json()["key"]
    assert raw_key.startswith("qs_live_")

    resp2 = client.get("/api/v1/queries/slow",
        headers={"Authorization": raw_key})
    assert resp2.status_code == 200


def test_api_key_revoke(client, auth_headers):
    resp = client.post("/api/v1/auth/api-keys",
        headers=auth_headers,
        json={"name": "revoke-me"})
    assert resp.status_code == 200
    key_id = resp.json().get("id")
    if key_id:
        resp2 = client.delete(f"/api/v1/auth/api-keys/{key_id}",
            headers=auth_headers)
        assert resp2.status_code == 200


def test_stale_indexes_endpoint(client, auth_headers):
    resp = client.get("/api/v1/indexes/stale", headers=auth_headers)
    assert resp.status_code == 200


def test_slow_queries_list_empty_for_new_workspace(client, auth_headers):
    resp = client.get("/api/v1/queries/slow", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_benchmark_history_empty_for_new_workspace(client, auth_headers):
    resp = client.get("/api/v1/benchmark/history", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_memory_summary(client, auth_headers):
    resp = client.get("/api/v1/memory/summary", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_memories" in data


def test_vision_status(client, auth_headers):
    resp = client.get("/api/v1/vision/status", headers=auth_headers)
    assert resp.status_code == 200
    assert "configured" in resp.json()


def test_ci_check_endpoint(client, auth_headers):
    resp = client.post("/api/v1/ci/check",
        headers=auth_headers,
        json={
            "query": "SELECT * FROM orders WHERE user_id = 1",
            "fail_on_seq_scan": True,
            "fail_threshold_ms": 1000,
        })
    assert resp.status_code in (200, 422)


def test_agent_history_empty(client, auth_headers):
    resp = client.get("/api/v1/agent/history", headers=auth_headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
