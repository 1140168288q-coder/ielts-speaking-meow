import base64
import json

import httpx

from tests.conftest import authenticated_headers, configured_settings


async def post_tts(client: httpx.AsyncClient, payload: dict) -> httpx.Response:
    return await client.post(
        "/v1/tts",
        json=payload,
        headers=await authenticated_headers(client),
    )


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
        response = await post_tts(client, {"text": "Hello there."})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == b"chunk1chunk2"


async def test_tts_forwards_rate_and_pitch(make_app):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        captured["req_params"] = body["req_params"]
        return httpx.Response(200, content="\n".join(json.dumps(c) for c in [
            {"code": 0, "message": "OK", "data": base64.b64encode(b"chunk1").decode()},
            {"code": 20000000, "message": "OK", "data": ""},
        ]))

    app, _ = make_app(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await post_tts(client, {
            "text": "Hello there.",
            "language": "en-US",
            "rate": 0.92,
            "pitch": 1,
        })
    assert response.status_code == 200
    assert captured["req_params"]["text"] == "Hello there."
    assert captured["req_params"]["speed_ratio"] == 0.92
    assert captured["req_params"]["pitch_ratio"] == 1.0


async def test_tts_forwards_allowed_voice_and_matching_resource(make_app):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        captured["req_params"] = json.loads(request.content)["req_params"]
        return httpx.Response(200, content="\n".join(json.dumps(c) for c in [
            {"code": 0, "message": "OK", "data": base64.b64encode(b"chunk1").decode()},
            {"code": 20000000, "message": "OK", "data": ""},
        ]))

    app, _ = make_app(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await post_tts(client, {
            "text": "Hello there.",
            "voice": "en_male_dave_moon_bigtts",
        })
    assert response.status_code == 200
    assert captured["headers"]["X-Api-Resource-Id"] == "seed-tts-1.0"
    assert captured["req_params"]["speaker"] == "en_male_dave_moon_bigtts"


async def test_tts_rejects_unknown_voice(make_app):
    app, _ = make_app(tts_ok_handler())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await post_tts(client, {
            "text": "Hello",
            "voice": "not-a-supported-voice",
        })
    assert response.status_code == 400


async def test_tts_rejects_out_of_range_rate(make_app):
    app, _ = make_app(tts_ok_handler())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await post_tts(client, {"text": "Hello", "rate": 3})
    assert response.status_code == 400


async def test_tts_not_configured(make_app):
    settings = configured_settings(volc_api_key="", volc_app_id="", volc_access_token="")
    app, _ = make_app(tts_ok_handler(), settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await post_tts(client, {"text": "Hello"})
    assert response.status_code == 503


async def test_tts_empty_text(make_app):
    app, _ = make_app(tts_ok_handler())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await post_tts(client, {"text": ""})
    assert response.status_code == 400


async def test_tts_upstream_error_code(make_app):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps({
            "code": 3000,
            "message": "text length error",
            "data": "",
        }))

    app, _ = make_app(handler, configured_settings(free_tts_characters_monthly_quota=5))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        headers = await authenticated_headers(client, "tts-failure@example.com")
        response = await client.post("/v1/tts", headers=headers, json={"text": "Hello"})
        me = await client.get("/v1/me", headers=headers)
    assert response.status_code == 502
    assert me.json()["capabilities"]["tts"]["quotaUsed"] == 0


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
        await post_tts(client, {"text": "Hello"})
    headers = captured["headers"]
    assert headers["X-Api-App-Id"] == "123456"
    assert headers["X-Api-Access-Key"] == "tok"
    assert "X-Api-Key" not in headers
