"""雅思口语喵 Backend 入口。

启动:uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings, get_settings
from .errors import BackendError
from .logging_setup import configure_logging
from .routers import feedback, health, tts
from .security import RequestIdMiddleware, SlidingWindowRateLimiter
from .services.deepseek_service import DeepSeekService
from .services.http_client import build_http_client
from .services.volcengine_tts_service import VolcengineTTSService


def create_app(
    settings: Settings | None = None,
    client: httpx.AsyncClient | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(
        [
            settings.deepseek_api_key,
            settings.volc_api_key,
            settings.volc_access_token,
        ]
    )

    client = client or build_http_client(120.0)
    services = {
        "deepseek": DeepSeekService(client, settings),
        "volc_tts": VolcengineTTSService(client, settings),
    }

    app = FastAPI(title="雅思口语喵 Backend", version="1.7.0")
    app.state.settings = settings
    app.state.client = client
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
    # 最外层关联 ID 覆盖正常与限流响应，便于排查且不记录请求正文。
    app.add_middleware(RequestIdMiddleware)

    app.include_router(health.router)
    app.include_router(feedback.router, tags=["feedback"])
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
