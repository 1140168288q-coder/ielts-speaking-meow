"""账号商业化、权益和用量的持久化模型。"""
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class AccountBillingState(Base):
    """账号当前商业状态；支付接入后由 webhook 更新，不保存支付凭证。"""

    __tablename__ = "account_billing_states"
    __table_args__ = (
        CheckConstraint("plan IN ('free', 'pro')", name="ck_billing_plan"),
        CheckConstraint(
            "subscription_status IN "
            "('none', 'trialing', 'active', 'past_due', 'canceled')",
            name="ck_billing_subscription_status",
        ),
    )

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    plan: Mapped[str] = mapped_column(String(24), default="free")
    subscription_status: Mapped[str] = mapped_column(String(24), default="none")
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    provider_customer_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True
    )
    provider_subscription_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True
    )
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class EntitlementOverride(Base):
    """按用户覆盖单项能力，供运营补偿、内测或未来客服后台使用。"""

    __tablename__ = "entitlement_overrides"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "feature_key", name="uq_entitlement_override_user_feature"
        ),
        CheckConstraint(
            "quota_limit IS NULL OR quota_limit >= 0",
            name="ck_entitlement_override_quota_limit",
        ),
        CheckConstraint(
            "NOT (unlimited AND quota_limit IS NOT NULL)",
            name="ck_entitlement_override_quota_mode",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    feature_key: Mapped[str] = mapped_column(String(64))
    enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    quota_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    unlimited: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class UsageEvent(Base):
    """一次计费用量事件；只记标识和单位，绝不保存答案或合成文本。"""

    __tablename__ = "usage_events"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "feature_key",
            "idempotency_key",
            name="uq_usage_event_user_feature_idempotency",
        ),
        CheckConstraint("units > 0", name="ck_usage_event_units"),
        Index(
            "ix_usage_events_user_feature_time",
            "user_id",
            "feature_key",
            "occurred_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    feature_key: Mapped[str] = mapped_column(String(64))
    request_id: Mapped[str] = mapped_column(String(64))
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    units: Mapped[int] = mapped_column(Integer)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class UsageCounter(Base):
    """按用户、能力和计费周期聚合的原子计数。"""

    __tablename__ = "usage_counters"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "feature_key", "period_start", name="uq_usage_counter_period"
        ),
        CheckConstraint("used_units >= 0", name="ck_usage_counter_used_units"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    feature_key: Mapped[str] = mapped_column(String(64))
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_units: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class WebhookEvent(Base):
    """未来支付 webhook 的去重/审计占位，只保存 payload 摘要。"""

    __tablename__ = "webhook_events"
    __table_args__ = (
        UniqueConstraint(
            "provider", "provider_event_id", name="uq_webhook_event_provider_id"
        ),
        CheckConstraint(
            "status IN ('received', 'processed', 'failed', 'ignored')",
            name="ck_webhook_event_status",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    provider: Mapped[str] = mapped_column(String(32))
    provider_event_id: Mapped[str] = mapped_column(String(128))
    event_type: Mapped[str] = mapped_column(String(128))
    payload_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="received")
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    processed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
