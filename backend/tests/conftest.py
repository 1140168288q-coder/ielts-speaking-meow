"""测试基础设施：DeepSeek/TTS 用 MockTransport，不访问真实上游。"""
import json
from collections.abc import Callable
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import select

from app.config import Settings
from app.main import create_app
from app.models import User
from app.services.auth_service import normalize_email

TEST_PASSWORD = "correct horse battery staple"


def configured_settings(**overrides) -> Settings:
    # _env_file=None 禁用 .env 读取：测试必须与开发机真实密钥/配置隔离。
    base = {
        "deepseek_api_key": "sk-test-deepseek",
        "volc_api_key": "volc-test-key",
        "database_url": "sqlite+aiosqlite:///:memory:",
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)


def make_volc_response(status_code: int = 200, json_body=None, headers=None):
    return httpx.Response(status_code, json=json_body, headers=headers or {})


@pytest.fixture
def settings_factory():
    return configured_settings


def build_app(
    handler: Callable[[httpx.Request], httpx.Response],
    settings: Settings | None = None,
    email_sender=None,
):
    """handler 模拟所有 HTTP 上游请求（DeepSeek/TTS）。"""
    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, timeout=30.0)
    app = create_app(settings or configured_settings(), client, email_sender)
    return app, client


@pytest.fixture
async def make_app():
    """返回 (app, upstream_client)；测试内用 ASGITransport 发请求。"""
    resources = []

    def factory(handler, settings=None, email_sender=None):
        app, client = build_app(handler, settings, email_sender)
        resources.append((app, client))
        return app, client

    yield factory

    for app, client in resources:
        await app.state.database.close()
        await client.aclose()


def deepseek_ok_handler(body: dict) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer sk-test-deepseek"
        content = json.dumps(body)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"finish_reason": "stop", "message": {"content": content}}
                ]
            },
        )

    return handler


async def mark_email_verified(client: httpx.AsyncClient, email: str) -> None:
    """测试辅助：直接标记邮箱已验证，不绕过生产 dependency。"""
    transport = client._transport
    app = transport.app
    await app.state.database.initialize()
    async with app.state.database.session_factory() as db:
        user = await db.scalar(
            select(User).where(User.email == normalize_email(email))
        )
        assert user is not None
        now = datetime.now(timezone.utc)
        user.email_verified_at = now
        user.updated_at = now
        await db.commit()


async def authenticated_headers(
    client: httpx.AsyncClient, email: str = "protected-route@example.com"
) -> dict[str, str]:
    """注册测试账号；若已存在则登录，并返回真实 verified session header。"""
    credentials = {"email": email, "password": TEST_PASSWORD}
    response = await client.post("/v1/auth/register", json=credentials)
    if response.status_code == 409:
        response = await client.post("/v1/auth/login", json=credentials)
    assert response.status_code in {200, 201}
    await mark_email_verified(client, email)
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}
