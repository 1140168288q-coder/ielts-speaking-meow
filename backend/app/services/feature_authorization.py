"""统一 feature entitlement 与周期 quota 授权。

这里只持久化能力键、请求标识和计量单位，不接收也不保存答案正文。
"""
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from uuid import uuid4

from fastapi import Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..commercial_models import (
    AccountBillingState,
    EntitlementOverride,
    UsageCounter,
    UsageEvent,
)
from ..config import Settings
from ..errors import conflict, forbidden, invalid_request, quota_exceeded
from ..models import User

_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


class FeatureKey(StrEnum):
    SYNC = "sync"
    FEEDBACK = "feedback"
    ORGANIZE = "organize"
    TTS = "tts"
    PROVIDER_VERIFY = "provider_verify"


@dataclass(frozen=True)
class FeaturePolicy:
    free_quota: int | None
    period: str
    unit: str


@dataclass(frozen=True)
class FeatureCapability:
    feature: FeatureKey
    enabled: bool
    source: str
    reason: str | None
    quota_limit: int | None
    quota_used: int
    quota_remaining: int | None
    period: str
    unit: str
    resets_at: datetime


class FeatureAuthorizationService:
    def __init__(self, settings: Settings) -> None:
        self._policies = {
            FeatureKey.SYNC: FeaturePolicy(None, "month", "request"),
            FeatureKey.FEEDBACK: FeaturePolicy(
                settings.free_feedback_monthly_quota, "month", "request"
            ),
            FeatureKey.ORGANIZE: FeaturePolicy(
                settings.free_organize_monthly_quota, "month", "request"
            ),
            FeatureKey.TTS: FeaturePolicy(
                settings.free_tts_characters_monthly_quota, "month", "character"
            ),
            FeatureKey.PROVIDER_VERIFY: FeaturePolicy(
                settings.free_provider_verify_daily_quota, "day", "request"
            ),
        }

    async def get_billing_state(
        self, db: AsyncSession, user_id: str, *, create: bool = False
    ) -> AccountBillingState:
        state = await db.get(AccountBillingState, user_id)
        if state is None:
            state = AccountBillingState(
                user_id=user_id,
                plan="free",
                subscription_status="none",
            )
            if create:
                db.add(state)
                await db.flush()
        return state

    async def capabilities(
        self, db: AsyncSession, user: User
    ) -> dict[FeatureKey, FeatureCapability]:
        return {
            feature: await self._resolve_capability(db, user, feature)
            for feature in FeatureKey
        }

    async def require_feature(
        self, db: AsyncSession, user: User, feature: FeatureKey
    ) -> FeatureCapability:
        capability = await self._resolve_capability(db, user, feature)
        self._raise_if_unavailable(capability, required_units=1)
        return capability

    async def consume(
        self,
        db: AsyncSession,
        user: User,
        feature: FeatureKey,
        *,
        units: int,
        request_id: str,
        idempotency_key: str | None,
    ) -> FeatureCapability:
        if units <= 0:
            raise invalid_request("用量单位必须大于 0。")

        # PostgreSQL 上按用户串行化额度消费，避免并发越过同一周期的上限。
        await db.scalar(select(User.id).where(User.id == user.id).with_for_update())

        if idempotency_key is not None:
            replay = await db.scalar(
                select(UsageEvent.id).where(
                    UsageEvent.user_id == user.id,
                    UsageEvent.feature_key == feature.value,
                    UsageEvent.idempotency_key == idempotency_key,
                )
            )
            if replay is not None:
                raise conflict(
                    "idempotency-key-replayed",
                    "此请求标识已经使用，请为新操作生成新的请求标识。",
                )

        capability = await self._resolve_capability(db, user, feature)
        self._raise_if_unavailable(capability, required_units=units)

        now = datetime.now(timezone.utc)
        period_start, period_end = self._period_bounds(now, capability.period)
        counter = await db.scalar(
            select(UsageCounter)
            .where(
                UsageCounter.user_id == user.id,
                UsageCounter.feature_key == feature.value,
                UsageCounter.period_start == period_start,
            )
            .with_for_update()
        )
        if counter is None:
            counter = UsageCounter(
                user_id=user.id,
                feature_key=feature.value,
                period_start=period_start,
                period_end=period_end,
                used_units=0,
                updated_at=now,
            )
            db.add(counter)

        # 再按锁定后的 counter 校验一次，防止 capability 查询到陈旧值。
        limit = capability.quota_limit
        if limit is not None and counter.used_units + units > limit:
            raise quota_exceeded()

        counter.used_units += units
        counter.updated_at = now
        db.add(
            UsageEvent(
                user_id=user.id,
                feature_key=feature.value,
                request_id=request_id,
                idempotency_key=idempotency_key,
                units=units,
                period_start=period_start,
                occurred_at=now,
            )
        )
        await db.commit()
        remaining = None if limit is None else max(0, limit - counter.used_units)
        return FeatureCapability(
            feature=capability.feature,
            enabled=capability.enabled,
            source=capability.source,
            reason=capability.reason,
            quota_limit=limit,
            quota_used=counter.used_units,
            quota_remaining=remaining,
            period=capability.period,
            unit=capability.unit,
            resets_at=period_end,
        )

    async def _resolve_capability(
        self, db: AsyncSession, user: User, feature: FeatureKey
    ) -> FeatureCapability:
        now = datetime.now(timezone.utc)
        policy = self._policies[feature]
        billing = await self.get_billing_state(db, user.id)
        quota_limit = None if billing.plan == "pro" else policy.free_quota
        enabled = True
        source = f"plan:{billing.plan}"
        reason = None

        override = await db.scalar(
            select(EntitlementOverride).where(
                EntitlementOverride.user_id == user.id,
                EntitlementOverride.feature_key == feature.value,
                or_(
                    EntitlementOverride.expires_at.is_(None),
                    EntitlementOverride.expires_at > now,
                ),
            )
        )
        if override is not None:
            source = "override"
            if override.enabled is not None:
                enabled = override.enabled
            if override.unlimited:
                quota_limit = None
            elif override.quota_limit is not None:
                quota_limit = override.quota_limit
            if not enabled:
                reason = "feature-disabled"

        if user.status != "active" or user.deleted_at is not None:
            enabled = False
            reason = "account-inactive"
        elif user.email_verified_at is None:
            enabled = False
            reason = "email-not-verified"

        period_start, period_end = self._period_bounds(now, policy.period)
        used = (
            await db.scalar(
                select(UsageCounter.used_units).where(
                    UsageCounter.user_id == user.id,
                    UsageCounter.feature_key == feature.value,
                    UsageCounter.period_start == period_start,
                )
            )
            or 0
        )
        remaining = None if quota_limit is None else max(0, quota_limit - used)
        return FeatureCapability(
            feature=feature,
            enabled=enabled,
            source=source,
            reason=reason,
            quota_limit=quota_limit,
            quota_used=used,
            quota_remaining=remaining,
            period=policy.period,
            unit=policy.unit,
            resets_at=period_end,
        )

    @staticmethod
    def _raise_if_unavailable(
        capability: FeatureCapability, *, required_units: int
    ) -> None:
        if not capability.enabled:
            if capability.reason == "email-not-verified":
                raise forbidden(
                    "email-not-verified",
                    "请先完成邮箱验证后再使用云端能力。",
                )
            if capability.reason == "account-inactive":
                raise forbidden("account-inactive", "该账号当前不可使用云端能力。")
            raise forbidden("feature-not-entitled", "当前账号暂未开通此能力。")
        if (
            capability.quota_remaining is not None
            and capability.quota_remaining < required_units
        ):
            raise quota_exceeded()

    @staticmethod
    def _period_bounds(now: datetime, period: str) -> tuple[datetime, datetime]:
        if period == "day":
            start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
            return start, start + timedelta(days=1)
        start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        if now.month == 12:
            end = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            end = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)
        return start, end


def usage_identifiers(request: Request) -> tuple[str, str | None]:
    request_id = str(getattr(request.state, "request_id", "") or uuid4().hex)
    raw_idempotency = request.headers.get("X-Idempotency-Key")
    if raw_idempotency is None:
        return request_id, None
    idempotency_key = raw_idempotency.strip()
    if not _IDEMPOTENCY_KEY.fullmatch(idempotency_key):
        raise invalid_request(
            "X-Idempotency-Key 只能包含字母、数字、点、下划线、冒号或短横线，"
            "且长度不得超过 128。"
        )
    return request_id, idempotency_key
