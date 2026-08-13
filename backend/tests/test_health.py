import httpx
import pytest

from tests.conftest import configured_settings


async def test_health_configured(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["providers"] == {
        "deepseek": True,
        "volc_stt": True,
        "volc_tts": True,
    }


async def test_health_unconfigured(make_app):
    settings = configured_settings(
        deepseek_api_key="", volc_api_key="", volc_app_id="", volc_access_token=""
    )
    app, _ = make_app(lambda request: httpx.Response(500), settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
    assert response.json()["providers"] == {
        "deepseek": False,
        "volc_stt": False,
        "volc_tts": False,
    }


async def test_health_hides_secrets(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
    text = response.text
    assert "sk-test-deepseek" not in text
    assert "volc-test-key" not in text
