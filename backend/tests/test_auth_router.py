from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import inspect, select

from app.config import Settings
from app.models import AuthSession, User
from app.services.auth_service import digest_token

REGISTER_PAYLOAD = {
    "email": "Learner@Example.com",
    "password": "correct horse battery staple",
}


def test_common_postgresql_url_is_normalized_to_async_driver():
    settings = Settings(
        _env_file=None,
        database_url="postgresql://user:pass@db.example.com/ielts_cat",
    )
    assert settings.database_url.startswith("postgresql+asyncpg://")


async def test_app_lifespan_initializes_auth_schema(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with app.router.lifespan_context(app):
        async with app.state.database.engine.connect() as connection:
            table_names = await connection.run_sync(
                lambda sync_connection: inspect(sync_connection).get_table_names()
            )
    assert {
        "users",
        "auth_sessions",
        "account_tokens",
        "sync_entities",
        "sync_changes",
        "sync_operations",
    }.issubset(table_names)


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_register_creates_argon2_user_and_stores_only_token_digest(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/auth/register", json=REGISTER_PAYLOAD)

    assert response.status_code == 201
    body = response.json()
    token = body["accessToken"]
    assert body["tokenType"] == "Bearer"
    assert body["user"]["email"] == "learner@example.com"
    assert body["user"]["emailVerified"] is False
    assert "password" not in response.text.casefold()

    async with app.state.database.session_factory() as db:
        user = await db.scalar(select(User))
        auth_session = await db.scalar(select(AuthSession))
    assert user is not None
    assert user.password_hash.startswith("$argon2")
    assert auth_session is not None
    assert auth_session.token_hash == digest_token(token)
    assert auth_session.token_hash != token
    assert ensure_aware(auth_session.expires_at) > datetime.now(timezone.utc)


async def test_duplicate_registration_is_case_insensitive(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.post("/v1/auth/register", json=REGISTER_PAYLOAD)
        duplicate = await client.post(
            "/v1/auth/register",
            json={**REGISTER_PAYLOAD, "email": "learner@example.COM"},
        )
    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "email-already-registered"


async def test_login_and_restore_session(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/v1/auth/register", json=REGISTER_PAYLOAD)
        login = await client.post(
            "/v1/auth/login",
            json={**REGISTER_PAYLOAD, "email": "LEARNER@example.com"},
        )
        token = login.json()["accessToken"]
        restored = await client.get("/v1/auth/session", headers=bearer(token))

    assert login.status_code == 200
    assert restored.status_code == 200
    assert restored.json()["user"]["email"] == "learner@example.com"
    assert restored.json()["expiresAt"] == login.json()["expiresAt"]


async def test_login_uses_same_error_for_unknown_email_and_wrong_password(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/v1/auth/register", json=REGISTER_PAYLOAD)
        wrong_password = await client.post(
            "/v1/auth/login", json={**REGISTER_PAYLOAD, "password": "wrong password"}
        )
        unknown_email = await client.post(
            "/v1/auth/login",
            json={**REGISTER_PAYLOAD, "email": "unknown@example.com"},
        )

    assert wrong_password.status_code == 401
    assert unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()
    assert wrong_password.json()["error"]["code"] == "invalid-credentials"


async def test_logout_revokes_only_presented_session(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        registered = await client.post("/v1/auth/register", json=REGISTER_PAYLOAD)
        second_login = await client.post("/v1/auth/login", json=REGISTER_PAYLOAD)
        first_token = registered.json()["accessToken"]
        second_token = second_login.json()["accessToken"]

        logout = await client.post("/v1/auth/logout", headers=bearer(first_token))
        first_restore = await client.get(
            "/v1/auth/session", headers=bearer(first_token)
        )
        second_restore = await client.get(
            "/v1/auth/session", headers=bearer(second_token)
        )

    assert logout.status_code == 204
    assert not logout.content
    assert first_restore.status_code == 401
    assert second_restore.status_code == 200


async def test_expired_session_cannot_be_restored(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        registered = await client.post("/v1/auth/register", json=REGISTER_PAYLOAD)
        token = registered.json()["accessToken"]

        async with app.state.database.session_factory() as db:
            auth_session = await db.scalar(
                select(AuthSession).where(AuthSession.token_hash == digest_token(token))
            )
            assert auth_session is not None
            auth_session.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            await db.commit()

        restored = await client.get("/v1/auth/session", headers=bearer(token))

    assert restored.status_code == 401
    assert restored.json()["error"]["code"] == "invalid-session"


async def test_auth_validation_and_missing_token(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        bad_email = await client.post(
            "/v1/auth/register",
            json={"email": "not-an-email", "password": "long enough password"},
        )
        short_password = await client.post(
            "/v1/auth/register",
            json={"email": "valid@example.com", "password": "short"},
        )
        no_token = await client.get("/v1/auth/session")

    assert bad_email.status_code == 400
    assert short_password.status_code == 400
    assert no_token.status_code == 401


def ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
