"""云账号与增量同步基线。

Revision ID: 0001_cloud_accounts_and_sync
Revises:
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0001_cloud_accounts_and_sync"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()
    if "users" not in tables:
        op.create_table(
            "users",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("email", sa.String(length=320), nullable=False),
            sa.Column("password_hash", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_users_email", "users", ["email"], unique=True)

    if "auth_sessions" not in tables:
        op.create_table(
            "auth_sessions",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])
        op.create_index("ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"], unique=True)
        op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])

    if "sync_entities" not in tables:
        op.create_table(
            "sync_entities",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("entity_type", sa.String(length=32), nullable=False),
            sa.Column("entity_id", sa.String(length=128), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_cursor", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "entity_type", "entity_id", name="uq_sync_entity_owner_key"),
        )
        op.create_index("ix_sync_entities_user_id", "sync_entities", ["user_id"])

    if "sync_changes" not in tables:
        op.create_table(
            "sync_changes",
            sa.Column("cursor", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("entity_type", sa.String(length=32), nullable=False),
            sa.Column("entity_id", sa.String(length=128), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("cursor"),
        )
        op.create_index("ix_sync_changes_user_cursor", "sync_changes", ["user_id", "cursor"])
        op.create_index("ix_sync_changes_user_id", "sync_changes", ["user_id"])

    if "sync_operations" not in tables:
        op.create_table(
            "sync_operations",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("operation_id", sa.String(length=128), nullable=False),
            sa.Column("request_hash", sa.String(length=64), nullable=False),
            sa.Column("result", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "operation_id", name="uq_sync_operation_owner_id"),
        )
        op.create_index("ix_sync_operations_user_id", "sync_operations", ["user_id"])


def downgrade() -> None:
    for table in (
        "sync_operations",
        "sync_changes",
        "sync_entities",
        "auth_sessions",
        "users",
    ):
        if table in _tables():
            op.drop_table(table)
