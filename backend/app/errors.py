"""统一错误类型:路由与 FastAPI 异常处理器之间只靠 BackendError 传递。"""


class BackendError(Exception):
    """业务错误。code 面向客户端,message 面向用户。"""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def not_configured(what: str) -> BackendError:
    return BackendError(503, "not-configured", f"服务端未配置{what},请联系管理员。")


def provider_error(message: str = "第三方服务返回异常,请稍后重试。") -> BackendError:
    return BackendError(502, "provider-error", message)


def upstream_timeout(message: str = "第三方服务响应超时,请稍后重试。") -> BackendError:
    return BackendError(504, "upstream-timeout", message)


def invalid_request(message: str) -> BackendError:
    return BackendError(400, "invalid-request", message)


def unauthorized(
    message: str = "登录状态无效或已过期,请重新登录。",
) -> BackendError:
    return BackendError(401, "invalid-session", message)


def forbidden(code: str, message: str) -> BackendError:
    return BackendError(403, code, message)


def quota_exceeded(message: str = "本周期可用额度已用完。") -> BackendError:
    return BackendError(429, "quota-exceeded", message)


def conflict(code: str, message: str) -> BackendError:
    return BackendError(409, code, message)


def payload_too_large(message: str) -> BackendError:
    return BackendError(413, "payload-too-large", message)


def unsupported_media(message: str) -> BackendError:
    return BackendError(415, "unsupported-media", message)
