import logging
import smtplib

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.services import email_sender as email_sender_module
from app.services.email_sender import (
    DisabledEmailSender,
    EmailDeliveryDisabled,
    EmailDeliveryFailed,
    OutboundEmail,
    SMTPEmailSender,
)

MESSAGE = OutboundEmail(
    recipient="learner@example.com",
    subject="Account action",
    text_body="copy-token-abcdefghijklmnopqrstuvwxyz0123456789",
)


class FakeSMTP:
    events: list[str] = []

    def __init__(self, host, port, **kwargs):
        self.events.extend([f"connect:{host}:{port}"])

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.events.append("close")

    def ehlo(self):
        self.events.append("ehlo")

    def starttls(self, **kwargs):
        self.events.append("starttls")

    def login(self, user, password):
        self.events.append(f"login:{user}:{password}")

    def send_message(self, message):
        self.events.append(f"send:{message['To']}")


def smtp_settings(tls_mode: str) -> Settings:
    return Settings(
        _env_file=None,
        smtp_host="smtp.example.test",
        smtp_port=465 if tls_mode == "ssl" else 587,
        smtp_user="mailer-user",
        smtp_password="mailer-secret",
        smtp_from="no-reply@example.com",
        smtp_tls_mode=tls_mode,
        app_account_url="https://accounts.example.test/account",
    )


async def test_smtp_sender_uses_starttls_before_auth_and_send(monkeypatch):
    FakeSMTP.events = []
    monkeypatch.setattr(email_sender_module.smtplib, "SMTP", FakeSMTP)

    await SMTPEmailSender(smtp_settings("starttls")).send(MESSAGE)

    assert FakeSMTP.events == [
        "connect:smtp.example.test:587",
        "ehlo",
        "starttls",
        "ehlo",
        "login:mailer-user:mailer-secret",
        "send:learner@example.com",
        "close",
    ]


async def test_smtp_sender_uses_implicit_ssl(monkeypatch):
    FakeSMTP.events = []
    monkeypatch.setattr(email_sender_module.smtplib, "SMTP_SSL", FakeSMTP)

    await SMTPEmailSender(smtp_settings("ssl")).send(MESSAGE)

    assert FakeSMTP.events == [
        "connect:smtp.example.test:465",
        "login:mailer-user:mailer-secret",
        "send:learner@example.com",
        "close",
    ]


async def test_disabled_sender_is_explicitly_testable():
    sender = DisabledEmailSender("missing SMTP_HOST")

    assert sender.enabled is False
    with pytest.raises(EmailDeliveryDisabled, match="missing SMTP_HOST"):
        await sender.send(MESSAGE)


async def test_smtp_failure_log_does_not_contain_email_or_token(monkeypatch):
    token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"

    class FailingSMTP:
        def __init__(self, *args, **kwargs):
            raise smtplib.SMTPException(f"learner@example.com {token}")

    monkeypatch.setattr(email_sender_module.smtplib, "SMTP", FailingSMTP)

    records: list[logging.LogRecord] = []

    class RecordingHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    handler = RecordingHandler()
    previous_disabled = email_sender_module.logger.disabled
    previous_level = email_sender_module.logger.level
    email_sender_module.logger.disabled = False
    email_sender_module.logger.setLevel(logging.WARNING)
    email_sender_module.logger.addHandler(handler)

    try:
        with pytest.raises(EmailDeliveryFailed):
            await SMTPEmailSender(smtp_settings("starttls")).send(MESSAGE)
    finally:
        email_sender_module.logger.removeHandler(handler)
        email_sender_module.logger.setLevel(previous_level)
        email_sender_module.logger.disabled = previous_disabled

    log_text = "\n".join(record.getMessage() for record in records)
    assert "learner@example.com" not in log_text
    assert token not in log_text
    assert "SMTPException" in log_text


def test_public_account_url_requires_https_except_local_development():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_account_url="http://accounts.example.test")
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            app_account_url="https://user:secret@accounts.example.test/account",
        )

    local = Settings(
        _env_file=None, app_account_url="http://localhost:5173/account/"
    )
    assert local.app_account_url == "http://localhost:5173/account"


def test_smtp_header_configuration_rejects_invalid_addresses_and_newlines():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, smtp_from="not-an-email")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, smtp_host="smtp.example.test\r\nBcc: victim@test")
