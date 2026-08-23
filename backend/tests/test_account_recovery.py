from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select

from app.models import AccountToken, AuthSession, User
from app.services.auth_service import digest_token, ensure_utc
from app.services.email_sender import EmailDeliveryFailed, OutboundEmail
from tests.conftest import configured_settings

PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "new correct horse battery staple"
EMAIL = "learner@example.com"
ACCOUNT_URL = "https://accounts.example.test/account"


class RecordingEmailSender:
    enabled = True

    def __init__(self) -> None:
        self.messages: list[OutboundEmail] = []

    async def send(self, message: OutboundEmail) -> None:
        self.messages.append(message)


class FailingEmailSender:
    enabled = True

    async def send(self, message: OutboundEmail) -> None:
        raise EmailDeliveryFailed("test failure")


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def extract_raw_token(message: OutboundEmail) -> str:
    marker = "原始 token 到 App：\n"
    return message.text_body.split(marker, 1)[1].splitlines()[0]


async def register(client: httpx.AsyncClient) -> str:
    response = await client.post(
        "/v1/auth/register",
        json={"email": EMAIL, "password": PASSWORD},
    )
    assert response.status_code == 201
    return response.json()["accessToken"]


async def test_email_verification_token_is_high_entropy_hashed_timed_and_single_use(
    make_app,
):
    sender = RecordingEmailSender()
    settings = configured_settings(
        app_account_url=ACCOUNT_URL,
        email_verification_token_ttl_seconds=600,
    )
    app, _ = make_app(lambda request: httpx.Response(500), settings, sender)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://untrusted-host.test"
    ) as client:
        session_token = await register(client)
        requested = await client.post(
            "/v1/auth/request-email-verification",
            headers=bearer(session_token),
        )

        assert requested.status_code == 204
        assert not requested.content
        assert len(sender.messages) == 1
        message = sender.messages[0]
        raw_token = extract_raw_token(message)
        assert len(raw_token) >= 32
        assert f"{ACCOUNT_URL}?action=verify-email&token={raw_token}" in message.text_body
        assert "untrusted-host.test" not in message.text_body

        async with app.state.database.session_factory() as db:
            stored = await db.scalar(select(AccountToken))
        assert stored is not None
        assert stored.purpose == "verify_email"
        assert stored.token_hash == digest_token(raw_token)
        assert stored.token_hash != raw_token
        assert ensure_utc(stored.expires_at) == ensure_utc(stored.created_at) + timedelta(
            seconds=600
        )

        confirmed = await client.post(
            "/v1/auth/confirm-email-verification", json={"token": raw_token}
        )
        restored = await client.get(
            "/v1/auth/session", headers=bearer(session_token)
        )
        reused = await client.post(
            "/v1/auth/confirm-email-verification", json={"token": raw_token}
        )

    assert confirmed.status_code == 204
    assert restored.status_code == 200
    assert restored.json()["user"]["emailVerified"] is True
    assert reused.status_code == 400
    assert reused.json()["error"]["code"] == "invalid-account-token"

    async with app.state.database.session_factory() as db:
        user = await db.scalar(select(User))
        stored = await db.scalar(select(AccountToken))
    assert user is not None and user.email_verified_at is not None
    assert stored is not None and stored.consumed_at is not None


async def test_expired_email_verification_token_is_rejected(make_app):
    sender = RecordingEmailSender()
    settings = configured_settings(app_account_url=ACCOUNT_URL)
    app, _ = make_app(lambda request: httpx.Response(500), settings, sender)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        session_token = await register(client)
        await client.post(
            "/v1/auth/request-email-verification",
            headers=bearer(session_token),
        )
        raw_token = extract_raw_token(sender.messages[0])
        async with app.state.database.session_factory() as db:
            stored = await db.scalar(select(AccountToken))
            assert stored is not None
            stored.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            await db.commit()

        response = await client.post(
            "/v1/auth/confirm-email-verification", json={"token": raw_token}
        )
        restored = await client.get(
            "/v1/auth/session", headers=bearer(session_token)
        )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid-account-token"
    assert restored.json()["user"]["emailVerified"] is False


async def test_email_verification_request_requires_auth_and_is_idempotent_once_verified(
    make_app,
):
    sender = RecordingEmailSender()
    settings = configured_settings(app_account_url=ACCOUNT_URL)
    app, _ = make_app(lambda request: httpx.Response(500), settings, sender)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        unauthenticated = await client.post(
            "/v1/auth/request-email-verification"
        )
        session_token = await register(client)
        await client.post(
            "/v1/auth/request-email-verification",
            headers=bearer(session_token),
        )
        raw_token = extract_raw_token(sender.messages[0])
        await client.post(
            "/v1/auth/confirm-email-verification", json={"token": raw_token}
        )
        repeated = await client.post(
            "/v1/auth/request-email-verification",
            headers=bearer(session_token),
        )

    assert unauthenticated.status_code == 401
    assert repeated.status_code == 204
    assert len(sender.messages) == 1


async def test_requesting_new_verification_token_invalidates_previous_token(make_app):
    sender = RecordingEmailSender()
    settings = configured_settings(app_account_url=ACCOUNT_URL)
    app, _ = make_app(lambda request: httpx.Response(500), settings, sender)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        session_token = await register(client)
        await client.post(
            "/v1/auth/request-email-verification",
            headers=bearer(session_token),
        )
        first_token = extract_raw_token(sender.messages[0])
        await client.post(
            "/v1/auth/request-email-verification",
            headers=bearer(session_token),
        )
        second_token = extract_raw_token(sender.messages[1])

        old_confirmation = await client.post(
            "/v1/auth/confirm-email-verification", json={"token": first_token}
        )
        new_confirmation = await client.post(
            "/v1/auth/confirm-email-verification", json={"token": second_token}
        )

    assert first_token != second_token
    assert old_confirmation.status_code == 400
    assert new_confirmation.status_code == 204


async def test_password_reset_request_does_not_reveal_email_existence(make_app):
    sender = RecordingEmailSender()
    settings = configured_settings(
        app_account_url=ACCOUNT_URL,
        password_reset_token_ttl_seconds=900,
    )
    app, _ = make_app(lambda request: httpx.Response(500), settings, sender)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await register(client)
        known = await client.post(
            "/v1/auth/password-reset/request", json={"email": EMAIL}
        )
        unknown = await client.post(
            "/v1/auth/password-reset/request",
            json={"email": "missing@example.com"},
        )

    assert known.status_code == unknown.status_code == 204
    assert known.content == unknown.content == b""
    assert len(sender.messages) == 1
    raw_token = extract_raw_token(sender.messages[0])
    assert len(raw_token) >= 32
    assert f"{ACCOUNT_URL}?action=reset-password&token={raw_token}" in sender.messages[
        0
    ].text_body

    async with app.state.database.session_factory() as db:
        stored = await db.scalar(select(AccountToken))
    assert stored is not None
    assert stored.purpose == "reset_password"
    assert stored.token_hash == digest_token(raw_token)
    assert ensure_utc(stored.expires_at) == ensure_utc(stored.created_at) + timedelta(
        seconds=900
    )


async def test_password_reset_revokes_every_session_and_does_not_auto_login(make_app):
    sender = RecordingEmailSender()
    settings = configured_settings(app_account_url=ACCOUNT_URL)
    app, _ = make_app(lambda request: httpx.Response(500), settings, sender)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first_session = await register(client)
        login = await client.post(
            "/v1/auth/login", json={"email": EMAIL, "password": PASSWORD}
        )
        second_session = login.json()["accessToken"]
        await client.post(
            "/v1/auth/password-reset/request", json={"email": EMAIL}
        )
        raw_token = extract_raw_token(sender.messages[0])

        confirmed = await client.post(
            "/v1/auth/password-reset/confirm",
            json={"token": raw_token, "newPassword": NEW_PASSWORD},
        )
        first_restore = await client.get(
            "/v1/auth/session", headers=bearer(first_session)
        )
        second_restore = await client.get(
            "/v1/auth/session", headers=bearer(second_session)
        )
        old_login = await client.post(
            "/v1/auth/login", json={"email": EMAIL, "password": PASSWORD}
        )
        new_login = await client.post(
            "/v1/auth/login", json={"email": EMAIL, "password": NEW_PASSWORD}
        )
        reused = await client.post(
            "/v1/auth/password-reset/confirm",
            json={"token": raw_token, "newPassword": "another secure password"},
        )

    assert confirmed.status_code == 204
    assert confirmed.content == b""
    assert first_restore.status_code == second_restore.status_code == 401
    assert old_login.status_code == 401
    assert new_login.status_code == 200
    assert reused.status_code == 400

    async with app.state.database.session_factory() as db:
        sessions = list((await db.scalars(select(AuthSession))).all())
    # 两条重置前会话均已撤销；最后一条来自显式新密码登录。
    assert len(sessions) == 3
    assert sum(session.revoked_at is not None for session in sessions) == 2
    assert sum(session.revoked_at is None for session in sessions) == 1


async def test_account_token_purpose_cannot_be_interchanged(make_app):
    sender = RecordingEmailSender()
    settings = configured_settings(app_account_url=ACCOUNT_URL)
    app, _ = make_app(lambda request: httpx.Response(500), settings, sender)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        session_token = await register(client)
        await client.post(
            "/v1/auth/request-email-verification",
            headers=bearer(session_token),
        )
        verify_token = extract_raw_token(sender.messages[0])
        wrong_endpoint = await client.post(
            "/v1/auth/password-reset/confirm",
            json={"token": verify_token, "newPassword": NEW_PASSWORD},
        )
        correct_endpoint = await client.post(
            "/v1/auth/confirm-email-verification", json={"token": verify_token}
        )

    assert wrong_endpoint.status_code == 400
    assert correct_endpoint.status_code == 204


async def test_unconfigured_email_has_explicit_authenticated_error_but_generic_reset(
    make_app,
):
    app, _ = make_app(
        lambda request: httpx.Response(500),
        configured_settings(),
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        session_token = await register(client)
        verification = await client.post(
            "/v1/auth/request-email-verification",
            headers=bearer(session_token),
        )
        known_reset = await client.post(
            "/v1/auth/password-reset/request", json={"email": EMAIL}
        )
        unknown_reset = await client.post(
            "/v1/auth/password-reset/request",
            json={"email": "missing@example.com"},
        )

    assert verification.status_code == 503
    assert verification.json()["error"]["code"] == "not-configured"
    assert known_reset.status_code == unknown_reset.status_code == 204
    assert known_reset.content == unknown_reset.content == b""
    async with app.state.database.session_factory() as db:
        tokens = list((await db.scalars(select(AccountToken))).all())
    assert tokens == []


async def test_password_reset_mail_failure_keeps_generic_204(make_app):
    settings = configured_settings(app_account_url=ACCOUNT_URL)
    app, _ = make_app(
        lambda request: httpx.Response(500), settings, FailingEmailSender()
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await register(client)
        response = await client.post(
            "/v1/auth/password-reset/request", json={"email": EMAIL}
        )

    assert response.status_code == 204
    assert response.content == b""
