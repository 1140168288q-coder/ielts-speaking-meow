"""邮箱验证与密码找回。

Revision ID: 0002_account_recovery
Revises: 0001_cloud_accounts_and_sync
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0002_account_recovery"
down_revision: str | Sequence[str] | None = "0001_cloud_accounts_and_sync"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "email_verified_at" not in user_columns:
        with op.batch_alter_table("users") as batch_op:
            batch_op.add_column(
                sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True)
            )

    if "account_tokens" not in _tables():
        op.create_table(
            "account_tokens",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("purpose", sa.String(length=32), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint(
                "purpose IN ('verify_email', 'reset_password')",
                name="ck_account_tokens_purpose",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_account_tokens_expires_at", "account_tokens", ["expires_at"])
        op.create_index("ix_account_tokens_token_hash", "account_tokens", ["token_hash"], unique=True)
        op.create_index("ix_account_tokens_user_id", "account_tokens", ["user_id"])
        op.create_index("ix_account_tokens_user_purpose", "account_tokens", ["user_id", "purpose"])


def downgrade() -> None:
    if "account_tokens" in _tables():
        op.drop_table("account_tokens")
    inspector = sa.inspect(op.get_bind())
    if "users" in _tables() and "email_verified_at" in {
        column["name"] for column in inspector.get_columns("users")
    }:
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_column("email_verified_at")
