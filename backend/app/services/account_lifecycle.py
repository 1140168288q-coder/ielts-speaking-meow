"""账号资料、全端退出与隐私删除。"""
import asyncio
import secrets
from datetime import datetime, timezone

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..commercial_models import (
    AccountBillingState,
    EntitlementOverride,
    UsageCounter,
    UsageEvent,
    WebhookEvent,
)
from ..errors import BackendError
from ..models import (
    AccountToken,
    AuthSession,
    SyncChange,
    SyncEntity,
    SyncOperation,
    User,
)
from .auth_service import PASSWORD_HASHER


class AccountLifecycleService:
    async def update_profile(
        self, db: AsyncSession, user: User, *, display_name: str | None
    ) -> User:
        user.display_name = display_name
        user.updated_at = datetime.now(timezone.utc)
        await db.commit()
        return user

    async def logout_all(self, db: AsyncSession, user_id: str) -> None:
        now = datetime.now(timezone.utc)
        await db.execute(
            update(AuthSession)
            .where(
                AuthSession.user_id == user_id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        await db.commit()

    async def delete_account(
        self, db: AsyncSession, user: User, *, password: str
    ) -> None:
        try:
            valid_password = await asyncio.to_thread(
                PASSWORD_HASHER.verify, password, user.password_hash
            )
        except Exception:
            valid_password = False
        if not valid_password:
            raise BackendError(401, "invalid-password", "密码不正确。")

        now = datetime.now(timezone.utc)
        replacement_hash = await asyncio.to_thread(
            PASSWORD_HASHER.hash, secrets.token_urlsafe(32)
        )

        # 用户生成内容、会话、恢复 token、细粒度权益和用量全部清除。
        # User 仅保留不可登录的匿名 tombstone，支持审计已注销状态。
        for model in (
            SyncOperation,
            SyncChange,
            SyncEntity,
            AccountToken,
            AuthSession,
            EntitlementOverride,
            UsageEvent,
            UsageCounter,
            AccountBillingState,
        ):
            await db.execute(delete(model).where(model.user_id == user.id))

        await db.execute(
            update(WebhookEvent)
            .where(WebhookEvent.user_id == user.id)
            .values(user_id=None)
        )

        user.email = f"deleted-{user.id}@deleted.invalid"
        user.password_hash = replacement_hash
        user.display_name = None
        user.status = "deleted"
        user.email_verified_at = None
        user.updated_at = now
        user.deleted_at = now
        await db.commit()
