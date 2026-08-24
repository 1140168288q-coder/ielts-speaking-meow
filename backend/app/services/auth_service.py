"""邮箱密码认证与服务端可撤销会话。"""
import asyncio
import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from pwdlib import PasswordHash
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import (
    BackendError,
    conflict,
    not_configured,
    provider_error,
    unauthorized,
)
from ..models import AccountBillingState, AccountToken, AuthSession, User
from .email_sender import (
    AccountEmailService,
    EmailDeliveryDisabled,
    EmailDeliveryFailed,
)

PASSWORD_HASHER = PasswordHash.recommended()
# 未找到邮箱时仍执行一次 Argon2 校验，避免明显的账号存在性时序差异。
DUMMY_PASSWORD_HASH = PASSWORD_HASHER.hash("not-a-real-user-password")
ACCOUNT_TOKEN_BYTES = 32
AccountTokenPurpose = Literal["verify_email", "reset_password"]
logger = logging.getLogger(__name__)


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def digest_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@dataclass(frozen=True)
class IssuedSession:
    token: str
    session: AuthSession


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: AuthSession


@dataclass(frozen=True)
class IssuedAccountToken:
    token: str
    record: AccountToken


class AuthService:
    def __init__(
        self,
        session_ttl_seconds: int,
        email_verification_token_ttl_seconds: int,
        password_reset_token_ttl_seconds: int,
        account_email_service: AccountEmailService,
    ) -> None:
        self.session_ttl = timedelta(seconds=session_ttl_seconds)
        self.email_verification_token_ttl = timedelta(
            seconds=email_verification_token_ttl_seconds
        )
        self.password_reset_token_ttl = timedelta(
            seconds=password_reset_token_ttl_seconds
        )
        self.account_email_service = account_email_service

    async def register(
        self,
        db: AsyncSession,
        email: str,
        password: str,
        display_name: str | None = None,
    ) -> tuple[User, IssuedSession]:
        normalized_email = normalize_email(email)
        existing = await db.scalar(select(User).where(User.email == normalized_email))
        if existing is not None:
            raise conflict("email-already-registered", "该邮箱已注册,请直接登录。")

        password_hash = await asyncio.to_thread(PASSWORD_HASHER.hash, password)
        now = datetime.now(timezone.utc)
        user = User(
            email=normalized_email,
            password_hash=password_hash,
            display_name=display_name,
            status="active",
            created_at=now,
            updated_at=now,
        )
        db.add(user)
        try:
            await db.flush()
        except IntegrityError as exc:
            await db.rollback()
            raise conflict(
                "email-already-registered", "该邮箱已注册,请直接登录。"
            ) from exc


        db.add(
            AccountBillingState(
                user_id=user.id,
                plan="free",
                subscription_status="none",
                created_at=now,
                updated_at=now,
            )
        )
        issued = self._issue_session(user.id)
        db.add(issued.session)
        await db.commit()
        return user, issued

    async def login(
        self, db: AsyncSession, email: str, password: str
    ) -> tuple[User, IssuedSession]:
        normalized_email = normalize_email(email)
        user = await db.scalar(select(User).where(User.email == normalized_email))
        password_hash = user.password_hash if user is not None else DUMMY_PASSWORD_HASH
        valid_password = await asyncio.to_thread(
            PASSWORD_HASHER.verify, password, password_hash
        )
        if user is None or not valid_password:
            raise BackendError(401, "invalid-credentials", "邮箱或密码不正确。")


        if user.status != "active" or user.deleted_at is not None:
            raise BackendError(
                403, "account-inactive", "该账号当前不可登录。"
            )
        issued = self._issue_session(user.id)
        db.add(issued.session)
        await db.commit()
        return user, issued

    async def authenticate(self, db: AsyncSession, token: str) -> AuthContext:
        if not token or len(token) > 256:
            raise unauthorized()
        auth_session = await db.scalar(
            select(AuthSession).where(AuthSession.token_hash == digest_token(token))
        )
        now = datetime.now(timezone.utc)
        if (
            auth_session is None
            or auth_session.revoked_at is not None
            or ensure_utc(auth_session.expires_at) <= now
        ):
            raise unauthorized()

        user = await db.get(User, auth_session.user_id)
        if (
            user is None
            or user.status != "active"
            or user.deleted_at is not None
        ):
            raise unauthorized()
        return AuthContext(user=user, session=auth_session)

    async def logout(self, db: AsyncSession, auth: AuthContext) -> None:
        auth.session.revoked_at = datetime.now(timezone.utc)
        await db.commit()

    async def request_email_verification(
        self, db: AsyncSession, user: User
    ) -> None:
        if user.email_verified_at is not None:
            return
        if not self.account_email_service.enabled:
            raise not_configured("账号邮件服务")

        issued = await self._issue_account_token(
            db,
            user.id,
            "verify_email",
            self.email_verification_token_ttl,
        )
        try:
            await self.account_email_service.send_email_verification(
                user.email,
                issued.token,
                ensure_utc(issued.record.expires_at).isoformat(),
            )
        except EmailDeliveryDisabled as exc:
            raise not_configured("账号邮件服务") from exc
        except EmailDeliveryFailed as exc:
            raise provider_error("验证邮件发送失败，请稍后重试。") from exc

    async def confirm_email_verification(
        self, db: AsyncSession, token: str
    ) -> User:
        account_token, user, consumed_at = await self._consume_account_token(
            db, token, "verify_email"
        )
        if user.email_verified_at is None:
            user.email_verified_at = consumed_at
            user.updated_at = consumed_at
        account_token.consumed_at = consumed_at
        await db.commit()
        return user

    async def request_password_reset(self, db: AsyncSession, email: str) -> None:
        """始终静默完成；调用方固定返回 204，避免邮箱枚举。"""
        if not self.account_email_service.enabled:
            return
        try:
            user = await db.scalar(
                select(User).where(User.email == normalize_email(email))
            )
            if user is None:
                return
            issued = await self._issue_account_token(
                db,
                user.id,
                "reset_password",
                self.password_reset_token_ttl,
            )
            await self.account_email_service.send_password_reset(
                user.email,
                issued.token,
                ensure_utc(issued.record.expires_at).isoformat(),
            )
        except (EmailDeliveryDisabled, EmailDeliveryFailed, SQLAlchemyError) as exc:
            # 公开接口不暴露账号存在性或邮件基础设施状态。
            await db.rollback()
            logger.warning(
                "Password reset request could not be completed (%s)",
                type(exc).__name__,
            )
            return

    async def confirm_password_reset(
        self, db: AsyncSession, token: str, new_password: str
    ) -> None:
        account_token, user, consumed_at = await self._consume_account_token(
            db, token, "reset_password"
        )
        # 先验证 token，再执行昂贵的 Argon2，避免公开接口被无效 token 放大 CPU。
        new_password_hash = await asyncio.to_thread(
            PASSWORD_HASHER.hash, new_password
        )
        user.password_hash = new_password_hash
        user.updated_at = consumed_at
        account_token.consumed_at = consumed_at
        await db.execute(
            update(AuthSession)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
            )
            .values(revoked_at=consumed_at)
        )
        await db.commit()

    def _issue_session(self, user_id: str) -> IssuedSession:
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        auth_session = AuthSession(
            user_id=user_id,
            token_hash=digest_token(token),
            created_at=now,
            expires_at=now + self.session_ttl,
        )
        return IssuedSession(token=token, session=auth_session)

    async def _issue_account_token(
        self,
        db: AsyncSession,
        user_id: str,
        purpose: AccountTokenPurpose,
        ttl: timedelta,
    ) -> IssuedAccountToken:
        now = datetime.now(timezone.utc)
        # PostgreSQL 上锁定账号行，串行化同一用户并发申请同用途 token。
        await db.scalar(
            select(User.id).where(User.id == user_id).with_for_update()
        )
        # 只保留同用途最新一封邮件中的 token 可用。
        await db.execute(
            update(AccountToken)
            .where(
                AccountToken.user_id == user_id,
                AccountToken.purpose == purpose,
                AccountToken.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        raw_token = secrets.token_urlsafe(ACCOUNT_TOKEN_BYTES)
        record = AccountToken(
            user_id=user_id,
            purpose=purpose,
            token_hash=digest_token(raw_token),
            created_at=now,
            expires_at=now + ttl,
        )
        db.add(record)
        await db.commit()
        return IssuedAccountToken(token=raw_token, record=record)

    async def _consume_account_token(
        self,
        db: AsyncSession,
        raw_token: str,
        purpose: AccountTokenPurpose,
    ) -> tuple[AccountToken, User, datetime]:
        if len(raw_token) < 32 or len(raw_token) > 512:
            raise BackendError(400, "invalid-account-token", "验证凭证无效或已过期。")

        now = datetime.now(timezone.utc)
        account_token = await db.scalar(
            select(AccountToken).where(
                AccountToken.token_hash == digest_token(raw_token),
                AccountToken.purpose == purpose,
            )
        )
        if (
            account_token is None
            or account_token.consumed_at is not None
            or ensure_utc(account_token.expires_at) <= now
        ):
            raise BackendError(400, "invalid-account-token", "验证凭证无效或已过期。")

        claimed = await db.execute(
            update(AccountToken)
            .where(
                AccountToken.id == account_token.id,
                AccountToken.consumed_at.is_(None),
                AccountToken.expires_at > now,
            )
            .values(consumed_at=now)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            await db.rollback()
            raise BackendError(400, "invalid-account-token", "验证凭证无效或已过期。")

        user = await db.get(User, account_token.user_id)
        if user is None:
            await db.rollback()
            raise BackendError(400, "invalid-account-token", "验证凭证无效或已过期。")
        account_token.consumed_at = now
        return account_token, user, now
