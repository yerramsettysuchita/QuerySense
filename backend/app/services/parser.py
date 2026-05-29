import re
import hashlib
from dataclasses import dataclass, field
from typing import Optional
from sqlalchemy import text
from app.core.logging import logger


@dataclass
class PlanNode:
    node_type: str
    relation: Optional[str]
    rows_estimated: int
    rows_actual: int
    cost_total: float
    shared_hit: int
    shared_read: int
    children: list = field(default_factory=list)


@dataclass
class ExplainResult:
    raw_plan: dict
    nodes: list[PlanNode]
    total_exec_ms: float
    issues: list[dict]
    fingerprint: str


def fingerprint_query(query: str) -> str:
    normalized = re.sub(r"\s+", " ", query.strip().lower())
    normalized = re.sub(r"'[^']*'", "?", normalized)
    normalized = re.sub(r"\b\d+\b", "?", normalized)
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def _walk_plan(node: dict, collected: list[PlanNode]):
    pn = PlanNode(
        node_type=node.get("Node Type", "Unknown"),
        relation=node.get("Relation Name"),
        rows_estimated=node.get("Plan Rows", 0),
        rows_actual=node.get("Actual Rows", 0),
        cost_total=node.get("Total Cost", 0.0),
        shared_hit=node.get("Shared Hit Blocks", 0),
        shared_read=node.get("Shared Read Blocks", 0),
    )
    collected.append(pn)
    for child in node.get("Plans", []):
        _walk_plan(child, collected)


def _detect_issues(nodes: list[PlanNode], query: str) -> list[dict]:
    issues = []

    for node in nodes:
        # Full table scan
        if node.node_type == "Seq Scan" and node.rows_estimated > 0:
            issues.append({
                "type": "seq_scan",
                "severity": "high",
                "table": node.relation,
                "message": f"Full table scan on '{node.relation}' ({node.rows_estimated:,} rows). An index would eliminate this.",
            })

        # High cost-to-rows ratio — planner may be working harder than needed
        if node.rows_estimated > 0 and node.cost_total > 0:
            cost_per_row = node.cost_total / node.rows_estimated
            if cost_per_row > 500 and node.node_type == "Seq Scan":
                issues.append({
                    "type": "stale_stats",
                    "severity": "medium",
                    "table": node.relation,
                    "message": f"High cost-per-row on '{node.relation}' ({cost_per_row:,.0f} cost/row). Statistics may be stale — run ANALYZE.",
                })

        # Hash join on huge rowset — missing index on join key
        if node.node_type == "Hash Join" and node.rows_estimated > 50_000:
            issues.append({
                "type": "missing_join_index",
                "severity": "high",
                "table": node.relation,
                "message": f"Hash join across {node.rows_estimated:,} rows. Index on join key would convert this to nested loop.",
            })

        # Sort without index — expensive for ORDER BY / GROUP BY
        if node.node_type == "Sort" and node.rows_estimated > 5_000:
            issues.append({
                "type": "expensive_sort",
                "severity": "medium",
                "table": node.relation,
                "message": f"In-memory sort over {node.rows_estimated:,} rows. An index matching ORDER BY/GROUP BY eliminates this.",
            })

        # High disk reads — not in buffer cache
        if node.shared_read > 1000:
            issues.append({
                "type": "high_disk_reads",
                "severity": "medium",
                "table": node.relation,
                "message": f"{node.shared_read:,} disk block reads. Data not in buffer cache — check shared_buffers config.",
            })

    # N+1 pattern — detect "IN (?)" with large lists
    if re.search(r"IN\s*\([^)]{200,}\)", query, re.IGNORECASE):
        issues.append({
            "type": "n_plus_one",
            "severity": "high",
            "table": None,
            "message": "Large IN(...) clause detected. Likely N+1 pattern — rewrite as JOIN or use ANY($1::int[]).",
        })

    # GROUP BY without index
    group_by_cols = re.findall(r"GROUP\s+BY\s+([\w\s,]+?)(?:ORDER|HAVING|LIMIT|$)", query, re.IGNORECASE)
    if group_by_cols and any(n.node_type == "HashAggregate" and n.rows_estimated > 100 for n in nodes):
        issues.append({
            "type": "unindexed_group_by",
            "severity": "medium",
            "table": None,
            "message": "HashAggregate on large dataset for GROUP BY. Consider a covering index or materialized view.",
        })

    return issues


def parse_explain(plan_json: list[dict], query: str) -> ExplainResult:
    root = plan_json[0]
    plan = root.get("Plan", {})
    # EXPLAIN without ANALYZE has no Execution Time — estimate from planner cost
    # (cost units are arbitrary but proportional; divide by 100 for a ms approximation)
    exec_time = root.get("Execution Time") or round(plan.get("Total Cost", 0.0) / 100, 2)

    nodes: list[PlanNode] = []
    _walk_plan(plan, nodes)
    issues = _detect_issues(nodes, query)

    return ExplainResult(
        raw_plan=root,
        nodes=nodes,
        total_exec_ms=exec_time,
        issues=issues,
        fingerprint=fingerprint_query(query),
    )


def run_explain(conn, query: str) -> Optional[ExplainResult]:
    try:
        # Use FORMAT JSON only — no ANALYZE so we don't actually execute the query.
        # This makes analysis instant regardless of how slow the query would be.
        result = conn.execute(text(f"EXPLAIN (FORMAT JSON) {query}"))
        plan_json = result.scalar()
        return parse_explain(plan_json, query)
    except Exception as e:
        logger.error("EXPLAIN failed", query=query[:100], error=str(e))
        return None
