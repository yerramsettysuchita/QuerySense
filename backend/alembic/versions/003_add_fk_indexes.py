"""Add FK indexes and unique constraint on workspace_members

Revision ID: 003
Revises: 002
Create Date: 2026-01-03 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_slow_queries_connection_id", "slow_queries", ["connection_id"])
    op.create_index("ix_query_recommendations_slow_query_id", "query_recommendations", ["slow_query_id"])
    op.create_index("ix_benchmark_results_recommendation_id", "benchmark_results", ["recommendation_id"])
    op.create_index("ix_query_history_slow_query_id", "query_history", ["slow_query_id"])
    op.create_index("ix_workspace_members_workspace_id", "workspace_members", ["workspace_id"])
    op.create_index("ix_workspace_members_user_id", "workspace_members", ["user_id"])
    op.create_index("ix_api_keys_workspace_id", "api_keys", ["workspace_id"])
    op.create_index("ix_db_connections_workspace_id", "db_connections", ["workspace_id"])
    op.create_unique_constraint(
        "uq_workspace_members_user_workspace",
        "workspace_members",
        ["workspace_id", "user_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_workspace_members_user_workspace", "workspace_members")
    op.drop_index("ix_db_connections_workspace_id")
    op.drop_index("ix_api_keys_workspace_id")
    op.drop_index("ix_workspace_members_user_id")
    op.drop_index("ix_workspace_members_workspace_id")
    op.drop_index("ix_query_history_slow_query_id")
    op.drop_index("ix_benchmark_results_recommendation_id")
    op.drop_index("ix_query_recommendations_slow_query_id")
    op.drop_index("ix_slow_queries_connection_id")
