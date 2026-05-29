import pytest


def test_analyze_rejects_non_select(client, auth_headers):
    response = client.post(
        "/api/v1/queries/analyze",
        headers=auth_headers,
        json={"query": "DROP TABLE users"},
    )
    assert response.status_code == 400


def test_analyze_rejects_delete(client, auth_headers):
    response = client.post(
        "/api/v1/queries/analyze",
        headers=auth_headers,
        json={"query": "DELETE FROM users WHERE 1=1"},
    )
    assert response.status_code == 400


def test_analyze_requires_auth(client):
    response = client.post(
        "/api/v1/queries/analyze",
        json={"query": "SELECT 1"},
    )
    assert response.status_code == 401


@pytest.mark.integration
def test_analyze_select_returns_structure(client, auth_headers):
    """Requires live DB connection — skipped in unit test runs."""
    response = client.post(
        "/api/v1/queries/analyze",
        headers=auth_headers,
        json={"query": "SELECT * FROM users LIMIT 1"},
    )
    assert response.status_code in (200, 422)
    if response.status_code == 200:
        data = response.json()
        assert "issues" in data
        assert "recommendations" in data
