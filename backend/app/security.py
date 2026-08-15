"""基础安全:请求关联 ID + 内存滑动窗口限流(默认关闭)。

预留接口:将来需要更强限流(多实例/持久化)时替换此类即可,路由不用改。
"""
import time
import re
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


class SlidingWindowRateLimiter(BaseHTTPMiddleware):
    """按客户端 IP 限流。单实例内存实现,重启后计数清零。"""

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
                {"error": {"code": "rate-limited", "message": "请求过于频繁,请稍后再试。"}},
                status_code=429,
            )
        recent.append(now)
        return await call_next(request)
