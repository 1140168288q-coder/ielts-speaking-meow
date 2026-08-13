"""日志配置:任何日志都不允许出现 API Key / Access Token。"""
import logging
import re

_MASKED_PATTERNS = [
    re.compile(r"(api[_-]?key|access[_-]?key|access[_-]?token|app[_-]?key)",
               re.IGNORECASE),
    re.compile(r"sk-[A-Za-z0-9]{8,}"),
]


class SecretMaskingFilter(logging.Filter):
    def __init__(self, secrets: list[str]) -> None:
        super().__init__()
        self._secrets = [s for s in secrets if s]

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:
            return True
        for secret in self._secrets:
            message = message.replace(secret, "***")
        for pattern in _MASKED_PATTERNS:
            message = pattern.sub("***", message)
        record.msg = message
        record.args = ()
        return True


def configure_logging(secrets: list[str]) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    masker = SecretMaskingFilter(secrets)
    for handler in logging.getLogger().handlers:
        handler.addFilter(masker)
