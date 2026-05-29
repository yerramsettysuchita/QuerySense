"""Initial schema — all tables

Revision ID: 001
Revises:
Create Date: 2026-01-01 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Auth ──────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("is_verified", sa.Boolean(), default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_workspaces_slug", "workspaces", ["slug"])

    op.create_table(
        "workspace_members",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, default="member"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "api_keys",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("key_hash", sa.String(255), nullable=False, unique=True),
        sa.Column("key_preview", sa.String(30), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "db_connections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("db_type", sa.String(20), nullable=False),
        sa.Column("connection_url_encrypted", sa.String(1000), nullable=False),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("port", sa.String(10), nullable=False),
        sa.Column("database", sa.String(100), nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pg_stat_statements_enabled", sa.Boolean(), default=False),
        sa.Column("status", sa.String(20), default="unchecked"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Legacy connection model ───────────────────────────────────────────────
    op.create_table(
        "database_connections",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("db_type", sa.String(20), nullable=False),
        sa.Column("host", sa.String(255), nullable=False),
        sa.Column("port", sa.Integer(), nullable=False),
        sa.Column("database", sa.String(100), nullable=False),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("password_encrypted", sa.String(500), nullable=False),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Queries ───────────────────────────────────────────────────────────────
    op.create_table(
        "slow_queries",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("connection_id", sa.String(), sa.ForeignKey("database_connections.id"), nullable=True),
        sa.Column("query_fingerprint", sa.String(64), nullable=False, index=True),
        sa.Column("query_text", sa.Text(), nullable=False),
        sa.Column("avg_exec_time_ms", sa.Float(), nullable=False),
        sa.Column("max_exec_time_ms", sa.Float(), nullable=False),
        sa.Column("calls", sa.Integer(), default=1),
        sa.Column("db_type", sa.String(20), nullable=False, default="postgresql"),
        sa.Column("is_anomaly", sa.Boolean(), default=False),
        sa.Column("is_resolved", sa.Boolean(), default=False),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "query_history",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("slow_query_id", sa.String(), sa.ForeignKey("slow_queries.id"), nullable=False),
        sa.Column("exec_time_ms", sa.Float(), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "query_recommendations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("slow_query_id", sa.String(), sa.ForeignKey("slow_queries.id"), nullable=False),
        sa.Column("rec_type", sa.String(30), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("sql_fix", sa.Text(), nullable=False),
        sa.Column("estimated_improvement_pct", sa.Float(), nullable=False),
        sa.Column("risk_level", sa.String(10), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("ai_explanation", sa.Text(), nullable=True),
        sa.Column("is_applied", sa.Boolean(), default=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "benchmark_results",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("recommendation_id", sa.String(), sa.ForeignKey("query_recommendations.id"), nullable=False),
        sa.Column("before_ms", sa.Float(), nullable=False),
        sa.Column("after_ms", sa.Float(), nullable=False),
        sa.Column("improvement_pct", sa.Float(), nullable=False),
        sa.Column("iterations", sa.Integer(), nullable=False),
        sa.Column("tested_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Agent ─────────────────────────────────────────────────────────────────
    op.create_table(
        "agent_decisions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("slow_query_id", sa.String(), nullable=False, index=True),
        sa.Column("decision", sa.String(20), nullable=False),
        sa.Column("reasoning", sa.Text(), nullable=False),
        sa.Column("actions_taken", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "agent_memory",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("query_fingerprint", sa.String(16), nullable=False, unique=True, index=True),
        sa.Column("shape_hash", sa.String(16), nullable=False, index=True),
        sa.Column("query_text", sa.Text(), nullable=False),
        sa.Column("issue_type", sa.String(50), nullable=True),
        sa.Column("fix_applied", sa.Text(), nullable=True),
        sa.Column("before_ms", sa.Float(), nullable=True),
        sa.Column("after_ms", sa.Float(), nullable=True),
        sa.Column("improvement_pct", sa.Float(), nullable=True),
        sa.Column("outcome", sa.String(20), nullable=True),
        sa.Column("times_recalled", sa.Integer(), default=0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "weekly_reports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("week_start", sa.String(10), nullable=False),
        sa.Column("week_end", sa.String(10), nullable=False),
        sa.Column("total_queries_analyzed", sa.Integer(), default=0),
        sa.Column("total_fixes_applied", sa.Integer(), default=0),
        sa.Column("total_ms_saved", sa.Float(), default=0.0),
        sa.Column("top_issues", sa.JSON(), nullable=True),
        sa.Column("narrative", sa.Text(), nullable=True),
        sa.Column("slack_posted", sa.Integer(), default=0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("weekly_reports")
    op.drop_table("agent_memory")
    op.drop_table("agent_decisions")
    op.drop_table("benchmark_results")
    op.drop_table("query_recommendations")
    op.drop_table("query_history")
    op.drop_table("slow_queries")
    op.drop_table("database_connections")
    op.drop_table("db_connections")
    op.drop_table("api_keys")
    op.drop_table("workspace_members")
    op.drop_table("workspaces")
    op.drop_table("users")
