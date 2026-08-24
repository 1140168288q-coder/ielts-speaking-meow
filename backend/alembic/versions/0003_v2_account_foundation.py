"""V2 账号生命周期、权益、用量与支付 webhook 基础。

Revision ID: 0003_v2_account_foundation
Revises: 0002_account_recovery
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0003_v2_account_foundation"
down_revision: str | Sequence[str] | None = "0002_account_recovery"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    user_checks = {
        constraint["name"]
        for constraint in inspector.get_check_constraints("users")
        if constraint.get("name")
    }
    with op.batch_alter_table("users") as batch_op:
        if "display_name" not in user_columns:
            batch_op.add_column(sa.Column("display_name", sa.String(80), nullable=True))
        if "status" not in user_columns:
            batch_op.add_column(
                sa.Column(
                    "status",
                    sa.String(24),
                    nullable=False,
                    server_default=sa.text("'active'"),
                )
            )
        if "updated_at" not in user_columns:
            batch_op.add_column(
                sa.Column(
                    "updated_at",
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.text("CURRENT_TIMESTAMP"),
                )
            )
        if "deleted_at" not in user_columns:
            batch_op.add_column(
                sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True)
            )
        if "ck_users_status" not in user_checks:
            batch_op.create_check_constraint(
                "ck_users_status",
                "status IN ('active', 'suspended', 'deleted')",
            )

    tables = _tables()
    if "account_billing_states" not in tables:
        op.create_table(
            "account_billing_states",
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column(
                "plan",
                sa.String(24),
                nullable=False,
                server_default=sa.text("'free'"),
            ),
            sa.Column(
                "subscription_status",
                sa.String(24),
                nullable=False,
                server_default=sa.text("'none'"),
            ),
            sa.Column("provider", sa.String(32), nullable=True),
            sa.Column("provider_customer_id", sa.String(128), nullable=True),
            sa.Column("provider_subscription_id", sa.String(128), nullable=True),
            sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.CheckConstraint("plan IN ('free', 'pro')", name="ck_billing_plan"),
            sa.CheckConstraint(
                "subscription_status IN "
                "('none', 'trialing', 'active', 'past_due', 'canceled')",
                name="ck_billing_subscription_status",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("user_id"),
            sa.UniqueConstraint(
                "provider_customer_id", name="uq_billing_provider_customer_id"
            ),
            sa.UniqueConstraint(
                "provider_subscription_id", name="uq_billing_provider_subscription_id"
            ),
        )

    if "entitlement_overrides" not in tables:
        op.create_table(
            "entitlement_overrides",
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("feature_key", sa.String(64), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=True),
            sa.Column("quota_limit", sa.Integer(), nullable=True),
            sa.Column(
                "unlimited",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("reason", sa.String(240), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.CheckConstraint(
                "quota_limit IS NULL OR quota_limit >= 0",
                name="ck_entitlement_override_quota_limit",
            ),
            sa.CheckConstraint(
                "NOT (unlimited AND quota_limit IS NOT NULL)",
                name="ck_entitlement_override_quota_mode",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id",
                "feature_key",
                name="uq_entitlement_override_user_feature",
            ),
        )
        op.create_index(
            "ix_entitlement_overrides_user_id",
            "entitlement_overrides",
            ["user_id"],
        )
        op.create_index(
            "ix_entitlement_overrides_expires_at",
            "entitlement_overrides",
            ["expires_at"],
        )

    if "usage_events" not in tables:
        op.create_table(
            "usage_events",
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("feature_key", sa.String(64), nullable=False),
            sa.Column("request_id", sa.String(64), nullable=False),
            sa.Column("idempotency_key", sa.String(128), nullable=True),
            sa.Column("units", sa.Integer(), nullable=False),
            sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "occurred_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.CheckConstraint("units > 0", name="ck_usage_event_units"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id",
                "feature_key",
                "idempotency_key",
                name="uq_usage_event_user_feature_idempotency",
            ),
        )
        op.create_index("ix_usage_events_user_id", "usage_events", ["user_id"])
        op.create_index(
            "ix_usage_events_user_feature_time",
            "usage_events",
            ["user_id", "feature_key", "occurred_at"],
        )

    if "usage_counters" not in tables:
        op.create_table(
            "usage_counters",
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("feature_key", sa.String(64), nullable=False),
            sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
            sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "used_units",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.CheckConstraint(
                "used_units >= 0", name="ck_usage_counter_used_units"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "user_id",
                "feature_key",
                "period_start",
                name="uq_usage_counter_period",
            ),
        )
        op.create_index("ix_usage_counters_user_id", "usage_counters", ["user_id"])

    if "webhook_events" not in tables:
        op.create_table(
            "webhook_events",
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.String(36), nullable=True),
            sa.Column("provider", sa.String(32), nullable=False),
            sa.Column("provider_event_id", sa.String(128), nullable=False),
            sa.Column("event_type", sa.String(128), nullable=False),
            sa.Column("payload_hash", sa.String(64), nullable=False),
            sa.Column(
                "status",
                sa.String(24),
                nullable=False,
                server_default=sa.text("'received'"),
            ),
            sa.Column(
                "received_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("error_code", sa.String(128), nullable=True),
            sa.CheckConstraint(
                "status IN ('received', 'processed', 'failed', 'ignored')",
                name="ck_webhook_event_status",
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "provider",
                "provider_event_id",
                name="uq_webhook_event_provider_id",
            ),
        )
        op.create_index("ix_webhook_events_user_id", "webhook_events", ["user_id"])

    op.execute(
        sa.text(
            """
            INSERT INTO account_billing_states
                (user_id, plan, subscription_status, created_at, updated_at)
            SELECT users.id, 'free', 'none', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM users
            WHERE NOT EXISTS (
                SELECT 1
                FROM account_billing_states billing
                WHERE billing.user_id = users.id
            )
            """
        )
    )


def downgrade() -> None:
    for table in (
        "webhook_events",
        "usage_counters",
        "usage_events",
        "entitlement_overrides",
        "account_billing_states",
    ):
        if table in _tables():
            op.drop_table(table)

    inspector = sa.inspect(op.get_bind())
    if "users" not in _tables():
        return
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    user_checks = {
        constraint["name"]
        for constraint in inspector.get_check_constraints("users")
        if constraint.get("name")
    }
    with op.batch_alter_table("users") as batch_op:
        if "ck_users_status" in user_checks:
            batch_op.drop_constraint("ck_users_status", type_="check")
        for column in ("deleted_at", "updated_at", "status", "display_name"):
            if column in user_columns:
                batch_op.drop_column(column)
