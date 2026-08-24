"""云端邮箱账号接口。"""
import logging
from datetime import datetime
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    FastAPI,
    Request,
    Response,
    status,
)
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_db_session
from ..errors import forbidden, unauthorized
from ..models import User
from ..services.auth_service import AuthContext, AuthService, IssuedSession, ensure_utc

router = APIRouter(prefix="/v1/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


class CredentialsPayload(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class RegisterPayload(CredentialsPayload):
    displayName: str | None = Field(default=None, max_length=80)


class UserResponse(BaseModel):
    id: str
    email: str
    displayName: str | None
    status: str
    emailVerified: bool
    createdAt: datetime
    updatedAt: datetime


class AuthResponse(BaseModel):
    accessToken: str
    tokenType: str = "Bearer"
    expiresAt: datetime
    user: UserResponse


class SessionResponse(BaseModel):
    expiresAt: datetime
    user: UserResponse


class AccountTokenPayload(BaseModel):
    token: str = Field(min_length=32, max_length=512)


class PasswordResetRequestPayload(BaseModel):
    email: EmailStr


class PasswordResetConfirmPayload(AccountTokenPayload):
    newPassword: str = Field(min_length=8, max_length=128)


def user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        displayName=user.display_name,
        status=user.status,
        emailVerified=user.email_verified_at is not None,
        createdAt=ensure_utc(user.created_at),
        updatedAt=ensure_utc(user.updated_at),
    )


def auth_response(user: User, issued: IssuedSession) -> AuthResponse:
    return AuthResponse(
        accessToken=issued.token,
        expiresAt=ensure_utc(issued.session.expires_at),
        user=user_response(user),
    )


async def get_current_auth(
    request: Request,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthContext:
    if credentials is None or credentials.scheme.casefold() != "bearer":
        raise unauthorized()
    service: AuthService = request.app.state.auth_service
    return await service.authenticate(db, credentials.credentials)


async def require_verified_user(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
) -> AuthContext:
    if auth.user.email_verified_at is None:
        raise forbidden(
            "email-not-verified", "请先完成邮箱验证后再使用云端能力。"
        )
    return auth


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    request: Request,
    payload: RegisterPayload,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthResponse:
    service: AuthService = request.app.state.auth_service
    display_name = payload.displayName.strip() if payload.displayName else None
    user, issued = await service.register(
        db, str(payload.email), payload.password, display_name
    )
    return auth_response(user, issued)


@router.post("/login", response_model=AuthResponse)
async def login(
    request: Request,
    payload: CredentialsPayload,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> AuthResponse:
    service: AuthService = request.app.state.auth_service
    user, issued = await service.login(db, str(payload.email), payload.password)
    return auth_response(user, issued)


@router.get("/session", response_model=SessionResponse)
async def restore_session(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
) -> SessionResponse:
    return SessionResponse(
        expiresAt=ensure_utc(auth.session.expires_at),
        user=user_response(auth.user),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> Response:
    service: AuthService = request.app.state.auth_service
    await service.logout(db, auth)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    request: Request,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> Response:
    await request.app.state.account_lifecycle_service.logout_all(
        db, auth.user.id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/request-email-verification", status_code=status.HTTP_204_NO_CONTENT)
async def request_email_verification(
    request: Request,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> Response:
    service: AuthService = request.app.state.auth_service
    await service.request_email_verification(db, auth.user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/confirm-email-verification", status_code=status.HTTP_204_NO_CONTENT)
async def confirm_email_verification(
    request: Request,
    payload: AccountTokenPayload,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> Response:
    service: AuthService = request.app.state.auth_service
    await service.confirm_email_verification(db, payload.token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password-reset/request", status_code=status.HTTP_204_NO_CONTENT)
async def request_password_reset(
    request: Request,
    payload: PasswordResetRequestPayload,
    background_tasks: BackgroundTasks,
) -> Response:
    # 数据库查找和 SMTP 都在响应发送后执行，降低邮箱存在性造成的时序差异。
    background_tasks.add_task(
        _process_password_reset_request, request.app, str(payload.email)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password-reset/confirm", status_code=status.HTTP_204_NO_CONTENT)
async def confirm_password_reset(
    request: Request,
    payload: PasswordResetConfirmPayload,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> Response:
    service: AuthService = request.app.state.auth_service
    await service.confirm_password_reset(db, payload.token, payload.newPassword)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _process_password_reset_request(app: FastAPI, email: str) -> None:
    try:
        await app.state.database.initialize()
        async with app.state.database.session_factory() as db:
            service: AuthService = app.state.auth_service
            await service.request_password_reset(db, email)
    except Exception as exc:
        # 响应已固定为 204；日志只保留异常类型，不记录邮箱或 token。
        logger.warning(
            "Password reset background task failed (%s)", type(exc).__name__
        )
