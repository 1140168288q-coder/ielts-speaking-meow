import io
import wave

import httpx

from tests.conftest import configured_settings, make_wav_router_dummy_handler


def make_wav_bytes(duration_seconds: float = 1.0, rate: int = 16000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"\x00\x00" * int(rate * duration_seconds))
    return buffer.getvalue()


async def post_wav(client: httpx.AsyncClient, data: bytes, name="answer.wav"):
    return await client.post(
        "/v1/stt",
        files={"file": (name, data, "audio/wav")},
        data={"language": "en"},
    )


async def test_stt_happy_path(make_app, sauc_server_factory):
    async with sauc_server_factory() as (settings, fake):
        app, _ = make_app(make_wav_router_dummy_handler(), settings)
        wav = make_wav_bytes(duration_seconds=1.0)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await post_wav(client, wav)
        assert response.status_code == 200
        assert response.json() == {"text": "I like reading books."}
        # 握手头与首帧参数按官方协议发送(头名会被服务端转小写)
        assert fake.captured_headers["x-api-key"] == "volc-test-key"
        assert fake.captured_headers["x-api-resource-id"] == "volc.seedasr.sauc.duration"
        assert fake.start_payload["audio"]["format"] == "pcm"
        assert fake.start_payload["request"]["model_name"] == "bigmodel"
        assert fake.start_payload["request"]["enable_ddc"] is False  # 保留 filler
        # 音频按帧完整送达,且以最终帧结束
        assert fake.audio_total == 16000 * 2  # 1 秒 16kHz/16bit 单声道
        assert fake.saw_last_audio_frame is True


async def test_stt_not_configured(make_app, sauc_server_factory):
    async with sauc_server_factory() as (settings, _):
        settings = configured_settings(volc_api_key="")
        app, _ = make_app(make_wav_router_dummy_handler(), settings)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await post_wav(client, make_wav_bytes())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "not-configured"


async def test_stt_rejects_webm(make_app, sauc_server_factory):
    async with sauc_server_factory() as (settings, _):
        app, _ = make_app(make_wav_router_dummy_handler(), settings)
        webm_head = b"\x1aE\xdf\xa3" + b"\x00" * 100  # EBML magic
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/v1/stt",
                files={"file": ("answer.webm", webm_head, "audio/webm")},
            )
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported-media"


async def test_stt_rejects_oversized(make_app, sauc_server_factory):
    async with sauc_server_factory() as (settings, _):
        settings = configured_settings(volc_api_key="volc-test-key", max_upload_mb=1)
        app, _ = make_app(make_wav_router_dummy_handler(), settings)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await post_wav(client, make_wav_bytes(duration_seconds=40))
    assert response.status_code == 413


async def test_stt_rejects_too_long_wav(make_app, sauc_server_factory):
    async with sauc_server_factory() as (settings, _):
        settings = configured_settings(
            volc_api_key="volc-test-key", max_stt_duration_seconds=5, max_upload_mb=25
        )
        app, _ = make_app(make_wav_router_dummy_handler(), settings)
        # 10 秒的 8kHz wav 只有 160KB,不会触发大小限制,只触发时长限制
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await post_wav(
                client, make_wav_bytes(duration_seconds=10, rate=8000), name="long.wav"
            )
    assert response.status_code == 400
    assert "时长" in response.json()["error"]["message"]


async def test_stt_error_frame_returns_502(make_app, sauc_server_factory):
    async with sauc_server_factory(behavior="error-frame") as (settings, _):
        app, _ = make_app(make_wav_router_dummy_handler(), settings)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await post_wav(client, make_wav_bytes())
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "provider-error"
    assert "转写失败" in response.json()["error"]["message"]


async def test_stt_silent_audio_returns_error(make_app, sauc_server_factory):
    async with sauc_server_factory(behavior="silent") as (settings, _):
        app, _ = make_app(make_wav_router_dummy_handler(), settings)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await post_wav(client, make_wav_bytes())
    assert response.status_code == 502
    assert "语音" in response.json()["error"]["message"]


async def test_stt_connection_closed_returns_502(make_app, sauc_server_factory):
    async with sauc_server_factory(behavior="close-early") as (settings, _):
        app, _ = make_app(make_wav_router_dummy_handler(), settings)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await post_wav(client, make_wav_bytes())
    assert response.status_code == 502
    assert "连接中断" in response.json()["error"]["message"]


async def test_stt_timeout_returns_504(make_app, sauc_server_factory):
    async with sauc_server_factory(behavior="hang") as (settings, _):
        settings = configured_settings(
            volc_api_key="volc-test-key",
            volc_endpoint=settings.volc_endpoint,
            stt_stream_timeout_seconds=1.0,
        )
        app, _ = make_app(make_wav_router_dummy_handler(), settings)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await post_wav(client, make_wav_bytes())
    assert response.status_code == 504
    assert response.json()["error"]["code"] == "upstream-timeout"


async def test_stt_unreachable_returns_502(make_app):
    settings = configured_settings(volc_endpoint="http://127.0.0.1:1")
    app, _ = make_app(make_wav_router_dummy_handler(), settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await post_wav(client, make_wav_bytes())
    assert response.status_code == 502
    assert "无法连接" in response.json()["error"]["message"]
