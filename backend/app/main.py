"""雅思口语喵 Backend 入口。

启动:uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings, get_settings
from .database import Database
from .errors import BackendError
from .logging_setup import configure_logging
from .routers import auth, feedback, health, me, sync, tts
from .security import (
    RequestIdMiddleware,
    SensitiveResponseHeadersMiddleware,
    SlidingWindowRateLimiter,
)
from .services.account_lifecycle import AccountLifecycleService
from .services.auth_service import AuthService
from .services.deepseek_service import DeepSeekService
from .services.email_sender import AccountEmailService, EmailSender, build_email_sender
from .services.feature_authorization import FeatureAuthorizationService
from .services.http_client import build_http_client
from .services.sync_service import SyncService
from .services.volcengine_tts_service import VolcengineTTSService


def create_app(
    settings: Settings | None = None,
    client: httpx.AsyncClient | None = None,
    email_sender: EmailSender | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(
        [
            settings.deepseek_api_key,
            settings.volc_api_key,
            settings.volc_access_token,
            settings.smtp_password.get_secret_value(),
        ]
    )

    owns_client = client is None
    client = client or build_http_client(120.0)
    if email_sender is None:
        email_sender = build_email_sender(settings)
    account_email_service = AccountEmailService(
        email_sender, settings.app_account_url
    )
    database = Database(settings.database_url)
    services = {
        "deepseek": DeepSeekService(client, settings),
        "volc_tts": VolcengineTTSService(client, settings),
    }

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await database.initialize()
        try:
            yield
        finally:
            await database.close()
            if owns_client:
                await client.aclose()

    app = FastAPI(
        title="雅思口语喵 Backend", version="2.2.2", lifespan=lifespan
    )
    app.state.settings = settings
    app.state.client = client
    app.state.database = database
    app.state.email_sender = email_sender
    app.state.auth_service = AuthService(
        settings.auth_session_ttl_seconds,
        settings.email_verification_token_ttl_seconds,
        settings.password_reset_token_ttl_seconds,
        account_email_service,
    )
    app.state.sync_service = SyncService()
    app.state.account_lifecycle_service = AccountLifecycleService()
    app.state.feature_authorization_service = FeatureAuthorizationService(settings)
    app.state.services = services

    # CORS:App 在 Capacitor WebView 里的来源是 https://localhost;浏览器开发预览
    # 是 http://localhost:5173 等本机端口。只放行本机来源,不放行任意站点。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["https://localhost", "http://localhost", "http://127.0.0.1"],
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_middleware(SlidingWindowRateLimiter, settings=settings)
    app.add_middleware(SensitiveResponseHeadersMiddleware, settings=settings)
    # 最外层关联 ID 覆盖正常与限流响应，便于排查且不记录请求正文。
    app.add_middleware(RequestIdMiddleware)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(sync.router)
    app.include_router(feedback.router, tags=["feedback"])
    app.include_router(me.router)
    app.include_router(tts.router, tags=["tts"])

    @app.exception_handler(BackendError)
    async def backend_error_handler(request: Request, exc: BackendError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "invalid-request", "message": "请求参数不合法。"}},
        )

    return app


app = create_app()
