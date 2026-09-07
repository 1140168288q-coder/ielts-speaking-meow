"""Bind usage idempotency keys to a non-reversible request fingerprint."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0004_usage_request_hash"
down_revision: str | Sequence[str] | None = "0003_v2_account_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("usage_events")}
    if "request_hash" not in columns:
        with op.batch_alter_table("usage_events") as batch_op:
            batch_op.add_column(sa.Column("request_hash", sa.String(64), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("usage_events")}
    if "request_hash" in columns:
        with op.batch_alter_table("usage_events") as batch_op:
            batch_op.drop_column("request_hash")
