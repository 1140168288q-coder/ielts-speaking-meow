"""测试基础设施:DeepSeek/TTS 用 MockTransport,不访问真实上游。"""
import json
from collections.abc import Callable

import httpx
import pytest

from app.config import Settings
from app.main import create_app


def configured_settings(**overrides) -> Settings:
    # _env_file=None 禁用 .env 读取:测试必须与开发机真实密钥/配置隔离
    base = {
        "deepseek_api_key": "sk-test-deepseek",
        "volc_api_key": "volc-test-key",
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)


def make_volc_response(status_code: int = 200, json_body=None, headers=None):
    return httpx.Response(status_code, json=json_body, headers=headers or {})


@pytest.fixture
def settings_factory():
    return configured_settings


def build_app(handler: Callable[[httpx.Request], httpx.Response], settings: Settings | None = None):
    """handler 模拟所有 HTTP 上游请求(DeepSeek/TTS)。"""
    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport, timeout=30.0)
    app = create_app(settings or configured_settings(), client)
    return app, client


@pytest.fixture
def make_app():
    """返回 (app, upstream_client);测试内用 ASGITransport 发请求。"""

    def factory(handler, settings=None):
        return build_app(handler, settings)

    return factory


def deepseek_ok_handler(body: dict) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer sk-test-deepseek"
        content = json.dumps(body)
        return httpx.Response(200, json={
            "choices": [{"message": {"content": content}}],
        })

    return handler
