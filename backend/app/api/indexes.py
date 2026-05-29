from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.services.stale_indexes import (
    run_stale_index_report,
    get_bloated_indexes,
    get_duplicate_indexes,
    generate_drop_sql,
)
from app.services.mysql_monitor import run_mysql_explain, get_mysql_stale_indexes
from app.core.deps import get_current_user

router = APIRouter()


class MySQLAnalyzeRequest(BaseModel):
    query: str


@router.get("/stale")
def stale_indexes(current_user: dict = Depends(get_current_user)):
    return run_stale_index_report()


@router.get("/bloated")
def bloated_indexes(current_user: dict = Depends(get_current_user)):
    return get_bloated_indexes()


@router.get("/duplicate")
def duplicate_indexes(current_user: dict = Depends(get_current_user)):
    return get_duplicate_indexes()


@router.get("/drop-sql/{index_name}")
def drop_sql(index_name: str, schema: str = "public", current_user: dict = Depends(get_current_user)):
    sql = generate_drop_sql(index_name, schema)
    return {
        "index": index_name,
        "drop_sql": sql,
        "warning": "Run CONCURRENTLY to avoid locking. Verify index is truly unused first.",
    }


@router.post("/mysql/analyze")
def mysql_analyze(req: MySQLAnalyzeRequest, current_user: dict = Depends(get_current_user)):
    if not req.query.strip().upper().startswith(("SELECT", "WITH")):
        raise HTTPException(400, "Only SELECT queries supported")
    return run_mysql_explain(req.query)


@router.get("/mysql/stale")
def mysql_stale(current_user: dict = Depends(get_current_user)):
    return get_mysql_stale_indexes()
