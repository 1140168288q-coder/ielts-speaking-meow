"""账号邮件发送端口与 SMTP 实现。"""
import asyncio
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol
from urllib.parse import urlencode

from ..config import Settings

logger = logging.getLogger(__name__)


class EmailDeliveryDisabled(RuntimeError):
    """邮件功能未完整配置。"""


class EmailDeliveryFailed(RuntimeError):
    """邮件服务器拒绝或无法完成发送；不携带上游敏感详情。"""


@dataclass(frozen=True)
class OutboundEmail:
    recipient: str
    subject: str
    text_body: str


class EmailSender(Protocol):
    @property
    def enabled(self) -> bool: ...

    async def send(self, message: OutboundEmail) -> None: ...


class DisabledEmailSender:
    enabled = False

    def __init__(self, reason: str = "SMTP 或 APP_ACCOUNT_URL 未配置") -> None:
        self.reason = reason

    async def send(self, message: OutboundEmail) -> None:
        raise EmailDeliveryDisabled(self.reason)


class SMTPEmailSender:
    enabled = True

    def __init__(self, settings: Settings) -> None:
        self._host = settings.smtp_host
        self._port = settings.smtp_port
        self._user = settings.smtp_user
        self._password = settings.smtp_password.get_secret_value()
        self._from = settings.smtp_from
        self._tls_mode = settings.smtp_tls_mode
        self._timeout = settings.smtp_timeout_seconds

    async def send(self, message: OutboundEmail) -> None:
        try:
            await asyncio.to_thread(self._send_blocking, message)
        except (OSError, ValueError, smtplib.SMTPException) as exc:
            # SMTP 异常文本可能包含收件人；日志只保留异常类型。
            logger.warning("Account email delivery failed (%s)", type(exc).__name__)
            raise EmailDeliveryFailed("账号邮件发送失败") from exc

    def _send_blocking(self, message: OutboundEmail) -> None:
        email = EmailMessage()
        email["From"] = self._from
        email["To"] = message.recipient
        email["Subject"] = message.subject
        email.set_content(message.text_body)

        context = ssl.create_default_context()
        if self._tls_mode == "ssl":
            with smtplib.SMTP_SSL(
                self._host,
                self._port,
                timeout=self._timeout,
                context=context,
            ) as smtp:
                self._login_and_send(smtp, email)
            return

        with smtplib.SMTP(self._host, self._port, timeout=self._timeout) as smtp:
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
            self._login_and_send(smtp, email)

    def _login_and_send(self, smtp: smtplib.SMTP, email: EmailMessage) -> None:
        if self._user:
            smtp.login(self._user, self._password)
        smtp.send_message(email)


class AccountEmailService:
    """只用部署配置生成账号链接和纯文本邮件，不读取请求 Host。"""

    def __init__(self, sender: EmailSender, app_account_url: str) -> None:
        self._sender = sender
        self._app_account_url = app_account_url

    @property
    def enabled(self) -> bool:
        return self._sender.enabled and bool(self._app_account_url)

    async def send_email_verification(
        self, recipient: str, token: str, expires_at_text: str
    ) -> None:
        self._ensure_enabled()
        link = self._account_link("verify-email", token)
        await self._sender.send(
            OutboundEmail(
                recipient=recipient,
                subject="验证你的雅思口语喵邮箱",
                text_body=(
                    "你正在验证雅思口语喵账号邮箱。\n\n"
                    f"安全链接：\n{link}\n\n"
                    "如果链接无法打开，请复制下面的原始 token 到 App：\n"
                    f"{token}\n\n"
                    f"token 过期时间：{expires_at_text}\n"
                    "该 token 只能使用一次。若非本人操作，请忽略此邮件。"
                ),
            )
        )

    async def send_password_reset(
        self, recipient: str, token: str, expires_at_text: str
    ) -> None:
        self._ensure_enabled()
        link = self._account_link("reset-password", token)
        await self._sender.send(
            OutboundEmail(
                recipient=recipient,
                subject="重置你的雅思口语喵密码",
                text_body=(
                    "你正在重置雅思口语喵账号密码。\n\n"
                    f"安全链接：\n{link}\n\n"
                    "如果链接无法打开，请复制下面的原始 token 到 App：\n"
                    f"{token}\n\n"
                    f"token 过期时间：{expires_at_text}\n"
                    "该 token 只能使用一次。若非本人操作，请忽略此邮件。"
                ),
            )
        )

    def _ensure_enabled(self) -> None:
        if not self.enabled:
            raise EmailDeliveryDisabled("SMTP 或 APP_ACCOUNT_URL 未配置")

    def _account_link(self, action: str, token: str) -> str:
        query = urlencode({"action": action, "token": token})
        return f"{self._app_account_url}?{query}"


def build_email_sender(settings: Settings) -> EmailSender:
    missing = []
    if not settings.smtp_host:
        missing.append("SMTP_HOST")
    if not settings.smtp_from:
        missing.append("SMTP_FROM")
    if not settings.app_account_url:
        missing.append("APP_ACCOUNT_URL")
    if settings.smtp_user and not settings.smtp_password.get_secret_value():
        missing.append("SMTP_PASSWORD")
    if missing:
        return DisabledEmailSender("缺少 " + ", ".join(missing))
    return SMTPEmailSender(settings)
