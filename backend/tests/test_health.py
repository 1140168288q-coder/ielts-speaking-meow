import httpx

from tests.conftest import configured_settings


async def test_root_explains_success_and_base_address(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/")
    assert response.status_code == 200
    assert "Backend 连接正常" in response.text
    assert "不要添加" in response.text
    assert "/health" in response.text


async def test_health_configured(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == "1.7.0"
    assert body["providers"]["deepseek"]["configured"] is True
    assert body["providers"]["deepseek"]["model"] == "deepseek-v4-flash"
    assert body["providers"]["volc_tts"]["configured"] is True
    assert body["providers"]["volc_tts"]["speaker"]["id"] == "zh_female_vv_uranus_bigtts"
    assert "volc_stt" not in body["providers"]
    # 只配置了密钥、还没真实调用过:必须显示 unverified,而不是"已验证"
    assert body["providers"]["deepseek"]["verification"]["status"] == "unverified"
    assert body["providers"]["volc_tts"]["verification"]["status"] == "unverified"


async def test_health_unconfigured(make_app):
    settings = configured_settings(
        deepseek_api_key="", volc_api_key="", volc_app_id="", volc_access_token=""
    )
    app, _ = make_app(lambda request: httpx.Response(500), settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
    providers = response.json()["providers"]
    assert providers["deepseek"]["configured"] is False
    assert providers["volc_tts"]["configured"] is False


async def test_health_hides_secrets(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
    text = response.text
    assert "sk-test-deepseek" not in text
    assert "volc-test-key" not in text


async def test_health_echoes_safe_request_id(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health", headers={"X-Request-ID": "mobile-check-1"})
        generated = await client.get("/health", headers={"X-Request-ID": "unsafe id!"})
    assert response.headers["X-Request-ID"] == "mobile-check-1"
    assert generated.headers["X-Request-ID"] != "unsafe id!"
    assert len(generated.headers["X-Request-ID"]) >= 16


async def test_health_verify_marks_deepseek_and_tts_verified(make_app):
    """显式验证会发起真实小规模调用并写入 verification 状态。"""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/chat/completions"):
            assert request.headers["Authorization"] == "Bearer sk-test-deepseek"
            return httpx.Response(200, json={
                "choices": [{"message": {"content": "OK"}}],
            })
        # 火山 TTS:返回一段音频块 + 流结束码
        import base64 as b64
        import json as jsonlib
        return httpx.Response(200, content="\n".join(jsonlib.dumps(c) for c in [
            {"code": 0, "message": "OK", "data": b64.b64encode(b"hi").decode()},
            {"code": 20000000, "message": "OK", "data": ""},
        ]))

    app, _ = make_app(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/health/verify")
    assert response.status_code == 200
    providers = response.json()["providers"]
    assert providers["deepseek"]["status"] == "verified"
    assert providers["deepseek"]["checkedAt"] is not None
    assert providers["volc_tts"]["status"] == "verified"
    assert "volc_stt" not in providers

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        health = (await client.get("/health")).json()
    assert health["providers"]["deepseek"]["verification"]["status"] == "verified"
    assert health["providers"]["volc_tts"]["verification"]["status"] == "verified"


async def test_health_verify_failed_credentials_record_error(make_app):
    app, _ = make_app(lambda request: httpx.Response(401))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/health/verify")
    providers = response.json()["providers"]
    assert providers["deepseek"]["status"] == "failed"
    assert "401" in providers["deepseek"]["lastError"]
    assert providers["volc_tts"]["status"] == "failed"
