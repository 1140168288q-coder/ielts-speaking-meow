"""统一 feature entitlement 与周期 quota 授权。

这里只持久化能力键、请求标识和计量单位，不接收也不保存答案正文。
"""
import asyncio
import hashlib
import json
import re
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from uuid import uuid4

from fastapi import Request
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

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
    MATERIAL_SUGGEST = "material_suggest"
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
        # 测试 SQLite 与单进程开发栈没有 PostgreSQL 的行锁语义；结算本身很短，
        # 用进程内互斥锁补上同一 Backend 实例内的原子边界。生产多 worker 仍由
        # PostgreSQL 的用户行锁和唯一约束兜底。
        self._settle_lock = asyncio.Lock()
        self._idempotency_locks: dict[str, asyncio.Lock] = {}
        self._idempotency_lock_refs: dict[str, int] = {}
        self._result_cache: dict[str, tuple[str, object, float]] = {}
        self._result_cache_ttl_seconds = 24 * 60 * 60
        self._policies = {
            FeatureKey.SYNC: FeaturePolicy(None, "month", "request"),
            FeatureKey.FEEDBACK: FeaturePolicy(
                settings.free_feedback_monthly_quota, "month", "request"
            ),
            FeatureKey.ORGANIZE: FeaturePolicy(
                settings.free_organize_monthly_quota, "month", "request"
            ),
            FeatureKey.MATERIAL_SUGGEST: FeaturePolicy(
                settings.free_material_suggest_monthly_quota, "month", "request"
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

    async def authorize(
        self,
        db: AsyncSession,
        user: User,
        feature: FeatureKey,
        *,
        units: int,
        idempotency_key: str | None = None,
        request_hash: str | None = None,
    ) -> FeatureCapability:
        """检查本次调用是否有资格使用额度，但不提前扣费。"""
        if units <= 0:
            raise invalid_request("用量单位必须大于 0。")
        if idempotency_key is not None:
            # Keep the transaction open across the provider call. On
            # PostgreSQL this serializes the same user's in-flight keyed
            # requests across workers; the second request then sees the
            # committed UsageEvent and can use the short-lived result cache
            # without calling or charging the provider again.
            await db.scalar(
                select(User.id).where(User.id == user.id).with_for_update()
            )
        capability = await self._resolve_capability(db, user, feature)
        if idempotency_key is not None:
            replay = await db.scalar(
                select(UsageEvent).where(
                    UsageEvent.user_id == user.id,
                    UsageEvent.feature_key == feature.value,
                    UsageEvent.idempotency_key == idempotency_key,
                )
            )
            if replay is not None:
                if replay.request_hash != request_hash:
                    raise conflict(
                        "idempotency-key-reused",
                        "此请求标识已绑定其他内容，请为新操作生成新的请求标识。",
                    )
                if not capability.enabled:
                    self._raise_if_unavailable(capability, required_units=units)
                # 同一个请求可以在额度用尽后安全重放；路由必须从短期
                # 结果缓存返回，不能再次调用上游。
                return capability
        self._raise_if_unavailable(capability, required_units=units)
        return capability

    async def settle(
        self,
        db: AsyncSession,
        user: User,
        feature: FeatureKey,
        *,
        units: int,
        request_id: str,
        idempotency_key: str | None,
        request_hash: str | None = None,
    ) -> FeatureCapability:
        async with self._settle_lock:
            return await self._settle_unlocked(
                db,
                user,
                feature,
                units=units,
                request_id=request_id,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )

    async def _settle_unlocked(
        self,
        db: AsyncSession,
        user: User,
        feature: FeatureKey,
        *,
        units: int,
        request_id: str,
        idempotency_key: str | None,
        request_hash: str | None,
    ) -> FeatureCapability:
        """在合法结果已经准备返回后原子结算一次额度。

        这里不保存请求正文或 AI 返回；幂等键只关联一条计量事件。
        """
        if units <= 0:
            raise invalid_request("用量单位必须大于 0。")

        # PostgreSQL 上按用户串行化 settle，避免并发请求越过同一周期上限。
        await db.scalar(select(User.id).where(User.id == user.id).with_for_update())

        if idempotency_key is not None:
            replay = await db.scalar(
                select(UsageEvent).where(
                    UsageEvent.user_id == user.id,
                    UsageEvent.feature_key == feature.value,
                    UsageEvent.idempotency_key == idempotency_key,
                )
            )
            if replay is not None:
                if replay.request_hash != request_hash:
                    raise conflict(
                        "idempotency-key-reused",
                        "此请求标识已绑定其他内容，请为新操作生成新的请求标识。",
                    )
                return await self._resolve_capability(db, user, feature)

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
                request_hash=request_hash,
                units=units,
                period_start=period_start,
                occurred_at=now,
            )
        )
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            if idempotency_key is not None:
                replay = await db.scalar(
                    select(UsageEvent).where(
                        UsageEvent.user_id == user.id,
                        UsageEvent.feature_key == feature.value,
                        UsageEvent.idempotency_key == idempotency_key,
                    )
                )
                if replay is not None and replay.request_hash == request_hash:
                    return await self._resolve_capability(db, user, feature)
            raise

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

    async def consume(
        self,
        db: AsyncSession,
        user: User,
        feature: FeatureKey,
        *,
        units: int,
        request_id: str,
        idempotency_key: str | None,
        request_hash: str | None = None,
    ) -> FeatureCapability:
        if units <= 0:
            raise invalid_request("用量单位必须大于 0。")

        # PostgreSQL 上按用户串行化额度消费，避免并发越过同一周期的上限。
        await db.scalar(select(User.id).where(User.id == user.id).with_for_update())

        if idempotency_key is not None:
            replay = await db.scalar(
                select(UsageEvent).where(
                    UsageEvent.user_id == user.id,
                    UsageEvent.feature_key == feature.value,
                    UsageEvent.idempotency_key == idempotency_key,
                )
            )
            if replay is not None:
                if replay.request_hash != request_hash:
                    raise conflict(
                        "idempotency-key-reused",
                        "此请求标识已绑定其他内容，请为新操作生成新的请求标识。",
                    )
                raise conflict(
                    "idempotency-key-replayed",
                    "此请求标识已经使用，请重试原操作或生成新的请求标识。",
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
                request_hash=request_hash,
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

    @asynccontextmanager
    async def idempotency_lock(
        self,
        user_id: str,
        feature: FeatureKey,
        idempotency_key: str | None,
    ):
        if idempotency_key is None:
            yield
            return
        key = f"{user_id}:{feature.value}:{idempotency_key}"
        lock = self._idempotency_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            self._idempotency_locks[key] = lock
        self._idempotency_lock_refs[key] = self._idempotency_lock_refs.get(key, 0) + 1
        try:
            async with lock:
                yield
        finally:
            remaining = self._idempotency_lock_refs.get(key, 1) - 1
            if remaining <= 0:
                self._idempotency_lock_refs.pop(key, None)
                if self._idempotency_locks.get(key) is lock and not lock.locked():
                    self._idempotency_locks.pop(key, None)
            else:
                self._idempotency_lock_refs[key] = remaining

    def get_cached_result(
        self,
        user_id: str,
        feature: FeatureKey,
        idempotency_key: str | None,
        request_hash: str | None,
    ) -> object | None:
        if idempotency_key is None or request_hash is None:
            return None
        key = f"{user_id}:{feature.value}:{idempotency_key}"
        cached = self._result_cache.get(key)
        if cached is None:
            return None
        cached_hash, result, expires_at = cached
        if expires_at <= time.monotonic():
            self._result_cache.pop(key, None)
            return None
        if cached_hash != request_hash:
            raise conflict(
                "idempotency-key-reused",
                "此请求标识已绑定其他内容，请为新操作生成新的请求标识。",
            )
        return result

    def cache_result(
        self,
        user_id: str,
        feature: FeatureKey,
        idempotency_key: str | None,
        request_hash: str | None,
        result: object,
    ) -> None:
        if idempotency_key is None or request_hash is None:
            return
        key = f"{user_id}:{feature.value}:{idempotency_key}"
        self._result_cache[key] = (
            request_hash,
            result,
            time.monotonic() + self._result_cache_ttl_seconds,
        )
        if len(self._result_cache) > 256:
            oldest = min(self._result_cache, key=lambda item: self._result_cache[item][2])
            self._result_cache.pop(oldest, None)

    async def has_idempotency_event(
        self,
        db: AsyncSession,
        user: User,
        feature: FeatureKey,
        idempotency_key: str,
        request_hash: str,
    ) -> bool:
        replay = await db.scalar(
            select(UsageEvent).where(
                UsageEvent.user_id == user.id,
                UsageEvent.feature_key == feature.value,
                UsageEvent.idempotency_key == idempotency_key,
            )
        )
        if replay is None:
            return False
        if replay.request_hash != request_hash:
            raise conflict(
                "idempotency-key-reused",
                "此请求标识已绑定其他内容，请为新操作生成新的请求标识。",
            )
        return True


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


def request_fingerprint(route: str, payload: object) -> str:
    """Hash a route plus canonical payload without retaining private content."""
    canonical = json.dumps(
        {"route": route, "payload": payload},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()
