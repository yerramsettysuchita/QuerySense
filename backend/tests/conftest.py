import os

# Set env vars BEFORE any app imports so pydantic_settings picks them up
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production-32chars!")

import pytest
import uuid
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

# SQLite in-memory with StaticPool so all connections share the same DB
_TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_TestSessionLocal = sessionmaker(bind=_TEST_ENGINE, autocommit=False, autoflush=False)

# Patch session module BEFORE importing app.main so main.py picks up the test engine
import app.db.session as _db_session
_db_session.app_engine = _TEST_ENGINE
_db_session.AppSessionLocal = _TestSessionLocal

from fastapi.testclient import TestClient
from app.main import app as fastapi_app  # alias to avoid shadowing the 'app' package name
from app.db.base import Base
from app.db.session import get_app_db
from app import models as _models  # registers all ORM classes with Base.metadata without rebinding 'app'


def _override_get_app_db():
    db = _TestSessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


fastapi_app.dependency_overrides[get_app_db] = _override_get_app_db


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=_TEST_ENGINE)
    yield


@pytest.fixture
def client():
    with TestClient(fastapi_app) as c:
        yield c


@pytest.fixture
def db_session():
    """Yields a raw SQLAlchemy session for seeding test data directly."""
    db = _TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def auth_headers(client):
    """Creates a fresh user + workspace and returns auth headers."""
    unique = str(uuid.uuid4())[:8]
    resp = client.post("/api/v1/auth/signup", json={
        "name": "Test User",
        "email": f"test_{unique}@example.com",
        "password": "password123",
        "workspace_name": f"Workspace {unique}",
    })
    assert resp.status_code == 200, resp.text
    token = resp.json()["data"]["token"]
    return {"Authorization": f"Bearer {token}"}
