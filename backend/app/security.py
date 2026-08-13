"""基础限流:内存滑动窗口,默认关闭。

预留接口:将来需要更强限流(多实例/持久化)时替换此类即可,路由不用改。
"""
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from .config import Settings


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
