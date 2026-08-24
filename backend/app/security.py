"""基础安全：请求关联 ID、响应边界与单实例限流。"""
import re
import time
import uuid
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .config import Settings

_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Adds a safe correlation id without logging request bodies or secrets."""

    async def dispatch(self, request: Request, call_next):
        incoming = request.headers.get("X-Request-ID", "")
        request_id = incoming if _REQUEST_ID.fullmatch(incoming) else uuid.uuid4().hex
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class SensitiveResponseHeadersMiddleware(BaseHTTPMiddleware):
    """保护私有响应，并在 JSON 解析前拒绝明显过大的同步请求。"""

    def __init__(self, app, settings: Settings) -> None:
        super().__init__(app)
        self._sync_max_request_bytes = settings.sync_max_request_bytes

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/v1/sync/push":
            content_length = request.headers.get("Content-Length")
            if content_length is not None:
                try:
                    too_large = int(content_length) > self._sync_max_request_bytes
                except ValueError:
                    too_large = True
                if too_large:
                    return JSONResponse(
                        {
                            "error": {
                                "code": "payload-too-large",
                                "message": "同步请求超过服务端允许的大小。",
                            }
                        },
                        status_code=413,
                    )

        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/v1/") or request.url.path == "/health/verify":
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
        return response


class SlidingWindowRateLimiter(BaseHTTPMiddleware):
    """按客户端 IP 限流。单实例内存实现，重启后计数清零。"""

    def __init__(self, app, settings: Settings) -> None:
        super().__init__(app)
        self._enabled = settings.rate_limit_enabled
        self._per_minute = max(1, settings.rate_limit_per_minute)
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        if not self._enabled:
            return await call_next(request)
        now = time.monotonic()
        window = 60.0
        ip = request.client.host if request.client else "unknown"
        recent = self._hits[ip]
        while recent and now - recent[0] > window:
            recent.popleft()
        if len(recent) >= self._per_minute:
            return JSONResponse(
                {
                    "error": {
                        "code": "rate-limited",
                        "message": "请求过于频繁,请稍后再试。",
                    }
                },
                status_code=429,
            )
        recent.append(now)
        return await call_next(request)
