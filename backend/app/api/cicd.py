from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
from app.services.analyzer import analyze_query
from app.services.mysql_monitor import run_mysql_explain
from app.core.config import settings
from app.core.logging import logger
from app.core.deps import get_current_user

router = APIRouter()


class CIRequest(BaseModel):
    query: str
    db_type: str = "postgresql"
    fail_on_seq_scan: bool = True
    fail_on_missing_index: bool = True
    fail_threshold_ms: float = 1000.0
    context: Optional[str] = None
    service: Optional[str] = None


class CIResponse(BaseModel):
    passed: bool
    exec_time_ms: Optional[float]
    issues: list[dict]
    recommendations: list[dict]
    fail_reasons: list[str]
    context: Optional[str]
    badge: str


@router.post("/check", response_model=CIResponse)
async def ci_check(req: CIRequest, current_user: dict = Depends(get_current_user)):
    """
    CI/CD integration endpoint. POST your query before deploying.
    Returns pass/fail + recommendations.

    GitHub Actions example:
        curl -X POST https://your-querysense/api/v1/ci/check \\
          -H "Content-Type: application/json" \\
          -d '{"query": "SELECT ...", "context": "PR-142", "fail_on_seq_scan": true}'
    """
    logger.info("CI check", context=req.context, service=req.service, db_type=req.db_type)

    if req.db_type == "mysql":
        result = run_mysql_explain(req.query)
    else:
        result = analyze_query(req.query)

    if "error" in result:
        from fastapi import HTTPException
        raise HTTPException(422, detail=result["error"])

    issues = result.get("issues", [])
    fail_reasons = []

    if req.fail_on_seq_scan and any(i["type"] == "seq_scan" for i in issues):
        fail_reasons.append("seq_scan_detected")

    if req.fail_on_missing_index and any(i["type"] in ("missing_index", "missing_join_index") for i in issues):
        fail_reasons.append("missing_index_detected")

    exec_time = result.get("exec_time_ms")
    if exec_time and exec_time > req.fail_threshold_ms:
        fail_reasons.append(f"exceeds_threshold_{req.fail_threshold_ms}ms")

    passed = len(fail_reasons) == 0

    return CIResponse(
        passed=passed,
        exec_time_ms=exec_time,
        issues=issues,
        recommendations=result.get("recommendations", []),
        fail_reasons=fail_reasons,
        context=req.context,
        badge="PASS" if passed else "FAIL",
    )


@router.get("/badge/{fingerprint}")
def ci_badge(fingerprint: str, current_user: dict = Depends(get_current_user)):
    """SVG badge for README — shows last CI result for a query fingerprint."""
    from app.db.session import AppSessionLocal
    from sqlalchemy import text

    with AppSessionLocal() as db:
        row = db.execute(text("""
            SELECT is_anomaly, avg_exec_time_ms
            FROM slow_queries
            WHERE query_fingerprint = :fp
            ORDER BY detected_at DESC
            LIMIT 1
        """), {"fp": fingerprint}).fetchone()

    if not row:
        color, label = "lightgrey", "unknown"
    elif row.is_anomaly or row.avg_exec_time_ms > settings.SLOW_QUERY_THRESHOLD_MS:
        color, label = "red", f"slow {row.avg_exec_time_ms:.0f}ms"
    else:
        color, label = "brightgreen", f"ok {row.avg_exec_time_ms:.0f}ms"

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="120" height="20">
  <rect width="70" height="20" fill="#555"/>
  <rect x="70" width="50" height="20" fill="{color}"/>
  <text x="35" y="14" fill="white" font-size="11" font-family="sans-serif" text-anchor="middle">QuerySense</text>
  <text x="95" y="14" fill="white" font-size="11" font-family="sans-serif" text-anchor="middle">{label}</text>
</svg>"""

    return Response(content=svg, media_type="image/svg+xml")
