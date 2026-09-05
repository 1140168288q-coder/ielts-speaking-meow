"""共享 httpx 客户端。测试时注入 MockTransport 即可,不需要 mock 网络。"""
import httpx

from ..errors import provider_error, upstream_auth_error, upstream_not_found, upstream_timeout


def build_http_client(timeout_seconds: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=httpx.Timeout(timeout_seconds),
        follow_redirects=False,
    )


async def raise_for_upstream(response: httpx.Response, context: str) -> None:
    """把第三方非 2xx 响应转成统一错误;响应体不进日志,避免泄露凭证回声。"""
    if 200 <= response.status_code < 300:
        return
    if response.status_code == 401:
        raise upstream_auth_error(f"{context}:凭证无效(401)。")
    if response.status_code == 403:
        raise upstream_auth_error(f"{context}:无权限访问(403)。")
    if response.status_code == 404:
        raise upstream_not_found(f"{context}:接口或资源不存在(404)。")
    if response.status_code == 429:
        raise provider_error(f"{context}:第三方限流(429),请稍后重试。")
    if response.status_code >= 500:
        raise provider_error(f"{context}:第三方服务故障({response.status_code})。")
    raise provider_error(f"{context}:请求被拒绝({response.status_code})。")


def timeout_guard(context: str):
    """包一层,把 httpx 超时统一为 upstream-timeout。"""

    async def run(operation):
        try:
            return await operation()
        except httpx.TimeoutException as exc:
            raise upstream_timeout(f"{context}:第三方服务超时。") from exc

    return run
