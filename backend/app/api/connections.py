from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from app.db.session import get_app_db
from app.core.deps import get_current_user
from app.services.connection_wizard import test_connection, save_connection, get_decrypted_url
from app.core.logging import logger
from app.schemas.response import ok

router = APIRouter()


class TestConnectionRequest(BaseModel):
    url: str


class SaveConnectionRequest(BaseModel):
    name: str
    url: str


@router.post("/test")
async def test_db_connection(req: TestConnectionRequest):
    if not req.url.strip():
        raise HTTPException(400, "Connection URL is required")
    return test_connection(req.url)


@router.post("/save")
def save_db_connection(
    req: SaveConnectionRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_app_db),
):
    test_result = test_connection(req.url)
    if not test_result["success"]:
        raise HTTPException(422, f"Connection test failed: {test_result['error']}")

    connection_id = save_connection(
        workspace_id=current_user["workspace_id"],
        name=req.name,
        url=req.url,
        test_result=test_result,
        db=db,
    )

    background_tasks.add_task(_initial_reset, req.url, connection_id)

    return ok({
        "connection_id": connection_id,
        "name": req.name,
        "status": "ok",
        "pg_stat_statements": test_result.get("pg_stat_statements"),
        "warnings": test_result.get("warnings", []),
        "tables": test_result.get("permissions", {}).get("tables", []),
        "message": "Connection saved. QuerySense is now monitoring this database.",
    })


def _initial_reset(url: str, connection_id: str):
    """Reset pg_stat_statements on first connection so we start fresh."""
    try:
        from sqlalchemy import create_engine
        engine = create_engine(url, pool_pre_ping=True)
        with engine.connect() as conn:
            try:
                conn.execute(text("SELECT pg_stat_statements_reset()"))
                conn.commit()
            except Exception:
                pass  # Not a superuser — fine, we just won't reset
        engine.dispose()
        logger.info("Initial reset complete", connection_id=connection_id)
    except Exception as e:
        logger.warning("Initial reset failed", connection_id=connection_id, error=str(e))


@router.get("/")
def list_connections(current_user: dict = Depends(get_current_user), db: Session = Depends(get_app_db)):
    rows = db.execute(text("""
        SELECT id, name, db_type, host, port, database, username,
               is_active, status, pg_stat_statements_enabled,
               last_checked_at, created_at
        FROM db_connections
        WHERE workspace_id = :ws_id AND is_active IS NOT FALSE
        ORDER BY created_at DESC
    """), {"ws_id": current_user["workspace_id"]}).fetchall()
    return ok([dict(r._mapping) for r in rows])


@router.get("/{connection_id}/health")
def connection_health(
    connection_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_app_db),
):
    url = get_decrypted_url(connection_id, current_user["workspace_id"], db)
    if not url:
        raise HTTPException(404, "Connection not found")

    result = test_connection(url)
    db.execute(text("""
        UPDATE db_connections SET status = :status, last_checked_at = NOW() WHERE id = :id
    """), {"status": "ok" if result["success"] else "error", "id": connection_id})
    db.commit()
    return result


@router.delete("/{connection_id}")
def delete_connection(
    connection_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_app_db),
):
    db.execute(text("""
        UPDATE db_connections SET is_active = false
        WHERE id = :id AND workspace_id = :ws_id
    """), {"id": connection_id, "ws_id": current_user["workspace_id"]})
    db.commit()
    return {"deleted": connection_id}
