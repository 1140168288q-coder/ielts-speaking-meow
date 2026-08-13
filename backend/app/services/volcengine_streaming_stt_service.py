"""火山引擎 流式语音识别(SAUC bigmodel)服务。

与「录音文件识别」(URL submit/query)不同,流式识别把音频分帧直接通过
WebSocket 发给火山,不需要公网可拉取的音频 URL,因此后端跑在局域网内也
可以完成完整转写。

协议依据(2026-08 核实):
- 官方文档:流式语音识别--豆包语音(docs.volcengine.com/docs/6561/1354869)
- 官方 SDK 实现:GizClaw/doubao-speech-go 的 asr_v2.go 与 internal/protocol/binary.go
  (帧头字节、final 帧标志、响应帧解析均与 SDK 逐字节一致)
"""
import asyncio
import gzip
import json
import struct
import uuid

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

from ..config import Settings
from ..errors import (
    BackendError,
    invalid_request,
    not_configured,
    provider_error,
    upstream_timeout,
)

# ---- SAUC 二进制协议常量(与官方 SDK internal/protocol/binary.go 一致)----
MSG_FULL_CLIENT = 0x1
MSG_AUDIO_ONLY = 0x2
MSG_FULL_SERVER = 0x9
MSG_ERROR = 0xF

FLAG_NO_SEQUENCE = 0x0
FLAG_POSITIVE = 0x1
FLAG_NEGATIVE = 0x2  # 最后一帧音频 / 最终响应
FLAG_NEGATIVE_WITH_SEQ = 0x3
FLAG_WITH_EVENT = 0x4

SER_NONE = 0x0
SER_JSON = 0x1
COMP_NONE = 0x0
COMP_GZIP = 0x1

EVENT_FINISH_CONNECTION = 2

# 官方示例的音频分块大小(16kHz/16bit/单声道 ≈ 100ms),发送不间隔
CHUNK_BYTES = 3200
# 成功状态码(0/1000/3000 均视为成功,与官方 SDK 判定一致)
_SUCCESS_CODES = {0, 1000, 3000}
_HANDSHAKE_TIMEOUT_SECONDS = 15.0


def build_full_client_frame(payload: bytes) -> bytes:
    """Full Client(JSON,无压缩)帧:4 字节头 + payload 长度 + payload。"""
    header = bytes(
        [
            0x11,
            (MSG_FULL_CLIENT << 4) | FLAG_NO_SEQUENCE,
            (SER_JSON << 4) | COMP_NONE,
            0x00,
        ]
    )
    return header + struct.pack(">I", len(payload)) + payload


def build_full_client_event_frame(event: int, payload: bytes) -> bytes:
    """带事件信封的 Full Client 帧(如结束连接事件 event=2)。"""
    header = bytes(
        [
            0x11,
            (MSG_FULL_CLIENT << 4) | FLAG_WITH_EVENT,
            (SER_JSON << 4) | COMP_NONE,
            0x00,
        ]
    )
    return header + struct.pack(">i", event) + struct.pack(">I", len(payload)) + payload


def build_audio_frame(payload: bytes, *, is_last: bool) -> bytes:
    """Audio-Only 帧(raw PCM,无压缩)。is_last=True 时 flags=2(SAUC 最终帧)。"""
    flags = FLAG_NEGATIVE if is_last else FLAG_NO_SEQUENCE
    header = bytes(
        [
            0x11,
            (MSG_AUDIO_ONLY << 4) | flags,
            (SER_NONE << 4) | COMP_NONE,
            0x00,
        ]
    )
    return header + struct.pack(">I", len(payload)) + payload


def parse_server_frame(data: bytes) -> dict:
    """解析服务端二进制帧,返回
    {message_type, flags, sequence | None, error_code | None, payload}。
    与官方 SDK ParseServerFrame 对齐(仅覆盖本服务用到的消息类型)。"""
    if len(data) < 8:
        raise ValueError("frame too short")
    header_size = (data[0] & 0x0F) * 4
    if header_size <= 0 or len(data) < header_size:
        raise ValueError("invalid header")

    message_type = (data[1] >> 4) & 0x0F
    flags = data[1] & 0x0F
    serialization = (data[2] >> 4) & 0x0F
    compression = data[2] & 0x0F
    offset = header_size

    # AudioOnlyClient 的 flags=2 只表示最终帧、不带序号字段;其余消息按 flags 判断
    has_sequence = (
        message_type != MSG_AUDIO_ONLY
        and flags in (FLAG_POSITIVE, FLAG_NEGATIVE, FLAG_NEGATIVE_WITH_SEQ)
    )
    sequence = None
    if has_sequence:
        sequence = struct.unpack(">i", data[offset : offset + 4])[0]
        offset += 4

    error_code = None
    if message_type == MSG_ERROR:
        error_code = struct.unpack(">I", data[offset : offset + 4])[0]
        offset += 4

    payload_size = struct.unpack(">I", data[offset : offset + 4])[0]
    offset += 4
    payload = data[offset : offset + payload_size]
    if compression == COMP_GZIP:
        payload = gzip.decompress(payload)
    return {
        "message_type": message_type,
        "flags": flags,
        "serialization": serialization,
        "sequence": sequence,
        "error_code": error_code,
        "payload": payload,
    }


def _wav_to_pcm16(data: bytes) -> bytes:
    """校验 WAV 并剥离为 PCM16 数据(16kHz/16bit/单声道)。"""
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise invalid_request("转写需要有效的 WAV 音频(App 会自动转换格式)。")
    channels = struct.unpack_from("<H", data, 22)[0]
    sample_rate = struct.unpack_from("<I", data, 24)[0]
    bits = struct.unpack_from("<H", data, 34)[0]
    if channels != 1 or sample_rate != 16000 or bits != 16:
        raise invalid_request("转写需要 16kHz/16bit 单声道 WAV(App 会自动转换格式)。")
    offset = 12  # 从第一个 RIFF 块开始扫描,兼容 fmt/fact 等任意前置块
    while offset + 8 <= len(data):
        chunk_id = data[offset : offset + 4]
        chunk_size = struct.unpack_from("<I", data, offset + 4)[0]
        if chunk_id == b"data":
            end = offset + 8 + chunk_size
            if end > len(data):
                break
            return data[offset + 8 : end]
        offset += 8 + chunk_size + (chunk_size % 2)
    raise invalid_request("WAV 音频缺少 data 块。")


class VolcengineStreamingSTTService:
    """把整段 WAV 按官方示例的节奏分帧直传火山流式识别,返回转写全文。

    只支持新版控制台鉴权(X-Api-Key)。旧版控制台(APP ID + Access Token)
    的流式鉴权需要签名,不在支持范围。
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.volc_api_key)

    async def transcribe(self, wav_bytes: bytes) -> str:
        if not self.is_configured:
            raise not_configured("火山引擎 STT")
        pcm = _wav_to_pcm16(wav_bytes)
        if not pcm:
            raise provider_error("转写未识别到语音内容,请重试或手动输入。")

        endpoint = self._ws_endpoint()
        headers = self._auth_headers()
        request_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._settings.stt_stream_timeout_seconds

        try:
            async with connect(
                endpoint,
                additional_headers=headers,
                open_timeout=_HANDSHAKE_TIMEOUT_SECONDS,
                max_size=2**24,
            ) as ws:
                await ws.send(
                    build_full_client_frame(self._start_payload(request_id))
                )
                for offset in range(0, len(pcm), CHUNK_BYTES):
                    chunk = pcm[offset : offset + CHUNK_BYTES]
                    is_last = offset + CHUNK_BYTES >= len(pcm)
                    await ws.send(build_audio_frame(chunk, is_last=is_last))

                text = await self._collect_result(ws, deadline)
                if text is None:
                    raise provider_error("转写未识别到语音内容,请重试或手动输入。")

                # 礼貌性结束事件(官方 SDK Close 流程),失败不影响结果
                try:
                    await ws.send(
                        build_full_client_event_frame(
                            EVENT_FINISH_CONNECTION,
                            json.dumps(
                                {"event": EVENT_FINISH_CONNECTION, "reqid": request_id}
                            ).encode("utf-8"),
                        )
                    )
                except (ConnectionClosed, OSError):
                    pass
                return text
        except BackendError:
            raise
        except asyncio.TimeoutError:
            raise upstream_timeout("火山转写超时,请稍后重试。")
        except InvalidStatus as exc:
            status = exc.response.status_code if exc.response is not None else 0
            if status in (401, 403):
                raise provider_error("火山转写鉴权失败,请检查 API Key 与资源 ID。")
            raise provider_error("无法连接火山转写服务,请稍后重试。")
        except ConnectionClosed:
            raise provider_error("火山转写连接中断,请重试。")
        except OSError:
            raise provider_error("无法连接火山转写服务,请稍后重试。")

    def _ws_endpoint(self) -> str:
        base = self._settings.volc_endpoint.rstrip("/")
        if base.startswith("https://"):
            base = "wss://" + base[len("https://") :]
        elif base.startswith("http://"):
            base = "ws://" + base[len("http://") :]
        return f"{base}/api/v3/sauc/bigmodel"

    def _auth_headers(self) -> dict[str, str]:
        return {
            "X-Api-Key": self._settings.volc_api_key,
            "X-Api-Resource-Id": self._settings.volc_stt_stream_resource_id,
            "X-Api-Connect-Id": str(uuid.uuid4()),
        }

    def _start_payload(self, request_id: str) -> bytes:
        # enable_ddc(语义顺滑)保持 false:产品要求忠实保留 filler/重复/自我修正
        return json.dumps(
            {
                "user": {"uid": "ielts-speaking-meow"},
                "audio": {
                    "format": "pcm",
                    "rate": 16000,
                    "sample_rate": 16000,
                    "bits": 16,
                    "channel": 1,
                },
                "request": {
                    "reqid": request_id,
                    "sequence": 1,
                    "model_name": "bigmodel",
                    "show_utterances": True,
                    "result_type": "full",
                    "enable_itn": True,
                    "enable_punc": True,
                    "enable_ddc": False,
                },
            }
        ).encode("utf-8")

    async def _collect_result(self, ws, deadline: float) -> str | None:
        """读帧直到最终结果。返回最终文本;无有效文本返回 None。"""
        loop = asyncio.get_running_loop()
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise upstream_timeout("火山转写超时,请稍后重试。")
            async with asyncio.timeout(remaining):
                message = await ws.recv()

            if isinstance(message, str):
                # 文本帧 = 服务端 JSON 错误
                try:
                    info = json.loads(message)
                except ValueError:
                    info = {}
                detail = str(info.get("message") or "未知错误")[:200]
                raise provider_error(f"火山转写失败:{detail}")

            frame = parse_server_frame(message)
            if frame["message_type"] == MSG_ERROR:
                raise provider_error("火山转写失败:服务端返回错误帧。")
            if frame["message_type"] != MSG_FULL_SERVER:
                continue

            payload = json.loads(frame["payload"])
            code = payload.get("code", 0)
            if code not in _SUCCESS_CODES:
                detail = str(payload.get("message") or "未知错误")[:200]
                raise provider_error(f"火山转写失败:{detail}")

            result = payload.get("result") or {}
            text = str(result.get("text") or "").strip()
            is_final = frame["flags"] in (FLAG_NEGATIVE, FLAG_NEGATIVE_WITH_SEQ)
            if not is_final:
                utterances = result.get("utterances") or []
                is_final = any(bool(u.get("definite")) for u in utterances)
            if is_final:
                return text or None
