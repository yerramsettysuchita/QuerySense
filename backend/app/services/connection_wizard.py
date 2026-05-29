"""
Connection wizard — tests a DB URL, checks capabilities, saves encrypted.
"""
import re
import uuid
import time
from typing import Optional
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from app.core.security import encrypt_connection_url, decrypt_connection_url
from app.core.logging import logger


def _parse_url(url: str) -> dict:
    # Allow database names with hyphens and other chars (Supabase uses them)
    pg = r"postgresql(?:\+\w+)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/([^?]+)"
    my = r"mysql(?:\+\w+)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/([^?]+)"

    for pattern, db_type in [(pg, "postgresql"), (my, "mysql")]:
        m = re.match(pattern, url.strip())
        if m:
            return {
                "db_type": db_type,
                "username": m.group(1),
                "password": m.group(2),
                "host": m.group(3),
                "port": m.group(4) or ("5432" if db_type == "postgresql" else "3306"),
                "database": m.group(5).split("?")[0],  # strip query string
            }
    return {}


def _check_pg_stat_statements(engine) -> dict:
    with engine.connect() as conn:
        try:
            count = conn.execute(text("SELECT COUNT(*) FROM pg_stat_statements LIMIT 1")).scalar()
            return {"enabled": True, "query_count": count, "message": f"pg_stat_statements active — {count} queries tracked"}
        except Exception:
            try:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_stat_statements"))
                conn.commit()
                return {"enabled": True, "query_count": 0, "message": "pg_stat_statements enabled successfully"}
            except Exception as e:
                return {
                    "enabled": False,
                    "query_count": 0,
                    "message": (
                        "pg_stat_statements unavailable. QuerySense can still analyze queries you paste manually, "
                        "but automatic slow query detection requires this extension."
                    ),
                }


def _check_permissions(engine, db_type: str) -> dict:
    checks = {"can_read": False, "can_explain": False, "table_count": 0, "tables": []}
    tables = []

    with engine.connect() as conn:
        try:
            if db_type == "postgresql":
                rows = conn.execute(text(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LIMIT 20"
                )).fetchall()
            else:
                rows = conn.execute(text("SHOW TABLES")).fetchall()

            tables = [r[0] for r in rows]
            checks["can_read"] = True
            checks["table_count"] = len(tables)
            checks["tables"] = tables
        except Exception as e:
            checks["read_error"] = str(e)

        if tables:
            try:
                conn.execute(text(f"EXPLAIN SELECT * FROM {tables[0]} LIMIT 1"))
                checks["can_explain"] = True
            except Exception as e:
                checks["explain_error"] = str(e)

    return checks


def test_connection(url: str) -> dict:
    parsed = _parse_url(url)
    if not parsed:
        return {
            "success": False,
            "error": "Could not parse connection URL. Expected: postgresql://user:pass@host:5432/dbname",
            "parsed": None,
        }

    result = {
        "success": False,
        "db_type": parsed["db_type"],
        "host": parsed["host"],
        "port": parsed["port"],
        "database": parsed["database"],
        "username": parsed["username"],
        "latency_ms": None,
        "pg_stat_statements": None,
        "permissions": None,
        "error": None,
        "warnings": [],
        "ready_for_monitoring": False,
    }

    try:
        # Build connect_args — add SSL if URL contains sslmode=require (Supabase, RDS)
        connect_args: dict = {"connect_timeout": 10}
        if "sslmode=require" in url or "supabase.co" in url or "amazonaws.com" in url:
            connect_args["sslmode"] = "require"

        engine = create_engine(url, pool_pre_ping=True, connect_args=connect_args)

        t0 = time.perf_counter()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        result["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
        result["success"] = True

        result["permissions"] = _check_permissions(engine, parsed["db_type"])

        if parsed["db_type"] == "postgresql":
            result["pg_stat_statements"] = _check_pg_stat_statements(engine)
            if not result["pg_stat_statements"]["enabled"]:
                result["warnings"].append(
                    "pg_stat_statements is not enabled. QuerySense can still analyze queries you paste manually, "
                    "but automatic slow query detection requires this extension."
                )

        if not result["permissions"].get("can_explain"):
            result["warnings"].append("EXPLAIN permission not available — query plan analysis will be limited.")

        result["ready_for_monitoring"] = (
            result["permissions"].get("can_read", False)
            and result["permissions"].get("can_explain", False)
        )

        engine.dispose()

    except OperationalError as e:
        err = str(e).lower()
        if "password" in err or "authentication" in err:
            result["error"] = "Authentication failed — check your username and password."
        elif "could not connect" in err or "connection refused" in err:
            result["error"] = f"Could not reach {parsed['host']}:{parsed['port']} — check host, port, and firewall rules."
        elif "does not exist" in err:
            result["error"] = f"Database '{parsed['database']}' does not exist."
        elif "ssl" in err or "certificate" in err:
            result["error"] = "SSL handshake failed — try adding ?sslmode=require to your connection URL."
        elif "timeout" in err:
            result["error"] = f"Connection timed out reaching {parsed['host']} — the host may be unreachable or behind a firewall."
        elif "too many connections" in err:
            result["error"] = "Too many connections — your database has reached its connection limit."
        else:
            result["error"] = str(e)[:300]
    except Exception as e:
        result["error"] = str(e)[:300]

    return result


def save_connection(workspace_id: str, name: str, url: str, test_result: dict, db) -> str:
    parsed = _parse_url(url)
    if not parsed:
        raise ValueError("Invalid connection URL")

    connection_id = str(uuid.uuid4())
    db.execute(text("""
        INSERT INTO db_connections
            (id, workspace_id, name, db_type, connection_url_encrypted,
             host, port, database, username, pg_stat_statements_enabled, status, is_active)
        VALUES
            (:id, :ws_id, :name, :db_type, :url_enc,
             :host, :port, :database, :username, :pg_stat, :status, true)
    """), {
        "id": connection_id,
        "ws_id": workspace_id,
        "name": name,
        "db_type": parsed["db_type"],
        "url_enc": encrypt_connection_url(url),
        "host": parsed["host"],
        "port": parsed["port"],
        "database": parsed["database"],
        "username": parsed["username"],
        "pg_stat": test_result.get("pg_stat_statements", {}).get("enabled", False),
        "status": "ok" if test_result["success"] else "error",
    })
    db.commit()
    return connection_id


def get_decrypted_url(connection_id: str, workspace_id: str, db) -> Optional[str]:
    row = db.execute(text("""
        SELECT connection_url_encrypted FROM db_connections
        WHERE id = :id AND workspace_id = :ws_id AND is_active = true
    """), {"id": connection_id, "ws_id": workspace_id}).fetchone()
    if not row:
        return None
    return decrypt_connection_url(row.connection_url_encrypted)
