"""测试基础设施:DeepSeek/TTS 用 MockTransport;流式 STT 用本地假 WebSocket 服务器。"""
import asyncio
import json
import struct
from collections.abc import Callable

import httpx
import pytest
from websockets.asyncio.server import serve

from app.config import Settings
from app.main import create_app
from app.services.volcengine_streaming_stt_service import parse_server_frame


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


def make_wav_router_dummy_handler() -> Callable[[httpx.Request], httpx.Response]:
    """STT 路由测试中 HTTP 上游不应被调用;万一调用立即失败。"""

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"unexpected upstream request: {request.url}")

    return handler


# ---- 流式 STT:假 SAUC WebSocket 服务器 ----

def make_server_frame(payload: dict, *, flags: int = 0x2, message_type: int = 0x9) -> bytes:
    """构造服务端二进制帧。默认 FullServer + 负序号最终帧(flags=2)。"""
    body = json.dumps(payload).encode("utf-8")
    header = bytes([0x11, (message_type << 4) | flags, 0x10, 0x00])
    out = header
    if message_type != 0x2 and flags in (0x1, 0x2, 0x3):
        out += struct.pack(">i", -1)
    out += struct.pack(">I", len(body)) + body
    return out


def make_error_frame(code: int, message: str) -> bytes:
    """构造错误帧(message_type=0xF):error_code + payload。"""
    body = json.dumps({"message": message}).encode("utf-8")
    header = bytes([0x11, 0xF0, 0x10, 0x00])
    return header + struct.pack(">I", code) + struct.pack(">I", len(body)) + body


class FakeSaucServer:
    """本地假火山流式识别服务器,记录握手头/首帧参数/收到的音频字节数。"""

    def __init__(self, text: str = "I like reading books.", behavior: str = "ok") -> None:
        self.text = text
        self.behavior = behavior  # ok / error-frame / silent / close-early / hang
        self.captured_headers: dict[str, str] = {}
        self.start_payload: dict = {}
        self.audio_total = 0
        self.saw_last_audio_frame = False

    async def handler(self, ws) -> None:
        # websockets 服务端会把头名转小写,统一按小写记录
        self.captured_headers = {k.lower(): v for k, v in ws.request.headers.items()}
        if self.behavior == "close-early":
            await ws.close(code=4401)
            return
        first = True
        while True:
            try:
                message = await ws.recv()
            except Exception:
                return
            if isinstance(message, str):
                continue
            frame = parse_server_frame(message)
            if first:
                first = False
                self.start_payload = json.loads(frame["payload"])
                continue
            if frame["message_type"] == 0x2:  # audio-only
                self.audio_total += len(frame["payload"])
                if frame["flags"] in (0x2, 0x3):
                    self.saw_last_audio_frame = True
                    if self.behavior == "hang":
                        # 不回任何帧,但保持连接打开,直到服务端超时主动断开
                        try:
                            await ws.recv()
                        except Exception:
                            pass
                        return
                    if self.behavior == "error-frame":
                        await ws.send(make_error_frame(45000151, "invalid audio"))
                        return
                    text = "" if self.behavior == "silent" else self.text
                    await ws.send(make_server_frame({
                        "code": 1000,
                        "result": {"text": text},
                        "audio_info": {"duration": 1000},
                    }))
                    # 等结束事件帧后退出(服务端会礼貌性发送 event=2 帧)
                    try:
                        await ws.recv()
                    except Exception:
                        pass
                    return
            elif frame["message_type"] == 0x1 and frame["flags"] == 0x4:
                return  # 结束事件帧


class _SaucServerSession:
    """测试内用 `async with` 管理假服务器生命周期,保证关闭发生在事件循环存活期。"""

    def __init__(self, fake: "FakeSaucServer") -> None:
        self.fake = fake

    async def __aenter__(self) -> tuple[Settings, "FakeSaucServer"]:
        self.server = await serve(self.fake.handler, "127.0.0.1", 0)
        port = self.server.sockets[0].getsockname()[1]
        self.settings = configured_settings(volc_endpoint=f"http://127.0.0.1:{port}")
        return self.settings, self.fake

    async def __aexit__(self, *exc) -> None:
        self.server.close()
        await asyncio.sleep(0)  # 让关闭任务在 loop 存活期间完成


@pytest.fixture
def sauc_server_factory():
    """返回 async 上下文管理器工厂:

        async with await sauc_server_factory() as (settings, fake):
            ...
    """

    def factory(text="I like reading books.", behavior="ok"):
        return _SaucServerSession(FakeSaucServer(text, behavior))

    return factory
