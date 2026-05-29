"""Drop legacy database_connections, re-point slow_queries.connection_id to db_connections

Revision ID: 002
Revises: 001
Create Date: 2026-01-02 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old FK and add new one pointing to db_connections
    with op.batch_alter_table("slow_queries") as batch_op:
        batch_op.drop_constraint("slow_queries_connection_id_fkey", type_="foreignkey")
        batch_op.create_foreign_key(
            "fk_slow_queries_connection_id",
            "db_connections",
            ["connection_id"],
            ["id"],
        )

    op.drop_table("database_connections")


def downgrade() -> None:
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

    with op.batch_alter_table("slow_queries") as batch_op:
        batch_op.drop_constraint("fk_slow_queries_connection_id", type_="foreignkey")
        batch_op.create_foreign_key(
            "slow_queries_connection_id_fkey",
            "database_connections",
            ["connection_id"],
            ["id"],
        )
