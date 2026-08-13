import base64
import json

import httpx

from tests.conftest import configured_settings


def tts_ok_handler() -> callable:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/api/v3/tts/unidirectional")
        assert request.headers["X-Api-Resource-Id"] == "seed-tts-2.0"
        body = json.loads(request.content)
        assert body["req_params"]["text"] == "Hello there."
        assert body["req_params"]["audio_params"]["format"] == "mp3"
        chunks = [
            {"code": 0, "message": "OK", "data": base64.b64encode(b"chunk1").decode()},
            {"code": 0, "message": "OK", "data": base64.b64encode(b"chunk2").decode()},
            {"code": 20000000, "message": "OK", "data": ""},
        ]
        stream = "\n".join(json.dumps(c) for c in chunks)
        return httpx.Response(200, content=stream, headers={
            "Content-Type": "application/json; charset=utf-8",
        })

    return handler


async def test_tts_happy_path(make_app):
    app, _ = make_app(tts_ok_handler())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/tts", json={"text": "Hello there."})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == b"chunk1chunk2"


async def test_tts_not_configured(make_app):
    settings = configured_settings(volc_api_key="", volc_app_id="", volc_access_token="")
    app, _ = make_app(tts_ok_handler(), settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/tts", json={"text": "Hello"})
    assert response.status_code == 503


async def test_tts_empty_text(make_app):
    app, _ = make_app(tts_ok_handler())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/tts", json={"text": ""})
    assert response.status_code == 400


async def test_tts_upstream_error_code(make_app):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps({
            "code": 3000,
            "message": "text length error",
            "data": "",
        }))

    app, _ = make_app(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/tts", json={"text": "Hello"})
    assert response.status_code == 502


async def test_tts_old_console_auth_headers(make_app):
    settings = configured_settings(volc_api_key="", volc_app_id="123456", volc_access_token="tok")
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return httpx.Response(200, content=json.dumps({
            "code": 20000000, "message": "OK", "data": "",
        }))

    app, _ = make_app(handler, settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/v1/tts", json={"text": "Hello"})
    headers = captured["headers"]
    assert headers["X-Api-App-Id"] == "123456"
    assert headers["X-Api-Access-Key"] == "tok"
    assert "X-Api-Key" not in headers
