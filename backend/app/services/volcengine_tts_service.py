"""VolcengineTTSService:豆包语音「语音合成 2.0」(单向流式 HTTP)。

按火山官方文档(2026-08 当前版)实现:
- POST /api/v3/tts/unidirectional
- 鉴权:X-Api-Key(新版)或 X-Api-App-Id + X-Api-Access-Key(旧版)
- X-Api-Resource-Id: seed-tts-2.0
- 响应:逐行 JSON,每行 {"code", "message", "data": base64 音频块};
  code == 20000000 表示流结束
"""
import base64
import json
import logging
import time
import uuid

import httpx

from ..config import Settings
from ..errors import BackendError, invalid_request, not_configured, provider_error
from .http_client import raise_for_upstream
from .verification import ProviderCallRecords

logger = logging.getLogger(__name__)

STREAM_END_CODE = 20000000
MAX_TEXT_CHARACTERS = 2000
# 火山 TTS 2.0 的 speed_ratio / pitch_ratio 允许范围
_RATIO_MIN = 0.5
_RATIO_MAX = 2.0
VERIFY_TEXT = "Hello."

# 英语考官预设使用官方音色列表中的 speaker。部分音色属于 TTS 1.0，
# 因此要随 speaker 切换对应资源；未传 voice 时继续使用现有 .env 配置。
VOICE_RESOURCE_IDS = {
    "en_male_dave_moon_bigtts": "seed-tts-1.0",
    "en_male_corey_emo_v2_mars_bigtts": "seed-tts-1.0",
    "en_female_daisy_moon_bigtts": "seed-tts-1.0",
    "en_female_onez_moon_bigtts": "seed-tts-1.0",
    "en_female_emily_mars_bigtts": "seed-tts-1.0",
}


def _clamp_ratio(value: float) -> float:
    return max(_RATIO_MIN, min(_RATIO_MAX, value))


class VolcengineTTSService:
    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings
        self.calls = ProviderCallRecords()

    @property
    def is_configured(self) -> bool:
        return bool(
            self._settings.volc_api_key
            or (self._settings.volc_app_id and self._settings.volc_access_token)
        )

    async def synthesize(
        self,
        text: str,
        language: str | None = None,
        voice: str | None = None,
        rate: float | None = None,
        pitch: float | None = None,
    ) -> bytes:
        """合成一段语音。language 保留兼容(2.0 自动识别中英);
        rate/pitch 映射为火山 speed_ratio/pitch_ratio。"""
        if not self.is_configured:
            raise not_configured("火山引擎 TTS")
        text = text.strip()
        if not text:
            raise invalid_request("合成文本不能为空。")
        if len(text) > MAX_TEXT_CHARACTERS:
            raise invalid_request(f"合成文本过长(最多 {MAX_TEXT_CHARACTERS} 字符)。")
        speaker, resource_id = self._resolve_voice(voice)
        started = time.perf_counter()
        try:
            audio = await self._synthesize_checked(
                text,
                speaker=speaker,
                resource_id=resource_id,
                rate=rate,
                pitch=pitch,
                language=language,
            )
        except Exception as exc:  # noqa: BLE001 - 记录最近失败后按原样抛出
            self.calls.request.record(ok=False, message=str(exc))
            raise
        self.calls.request.record(
            ok=True,
            latency_ms=round((time.perf_counter() - started) * 1000),
            result=f"synthesized {len(audio)} bytes",
        )
        return audio

    async def verify(self) -> dict:
        """最小成本的显式验证:合成一句 "Hello.",结果写入 verification。"""
        if not self.is_configured:
            return self.calls.verification.snapshot()
        try:
            await self.synthesize(VERIFY_TEXT)
        except BackendError:
            pass  # synthesize 已把失败写入 request
        request = self.calls.request.snapshot(kind="request")
        self.calls.verification.record(
            ok=request["status"] == "succeeded",
            message=request["lastError"],
            latency_ms=request["latencyMs"],
            result=request["lastResult"],
        )
        return self.calls.verification.snapshot()

    async def _synthesize_checked(
        self,
        text: str,
        *,
        speaker: str,
        resource_id: str,
        language: str | None,
        rate: float | None,
        pitch: float | None,
    ) -> bytes:
        del language  # TTS 2.0 自动识别中英文,不需要指定
        req_params: dict = {
            "text": text,
            "speaker": speaker,
            "audio_params": {
                "format": "mp3",
                "sample_rate": 24000,
            },
        }
        if rate is not None:
            req_params["speed_ratio"] = _clamp_ratio(rate)
        if pitch is not None:
            req_params["pitch_ratio"] = _clamp_ratio(pitch)

        async with self._client.stream(
            "POST",
            f"{self._settings.volc_endpoint}/api/v3/tts/unidirectional",
            headers={
                **self._settings.volc_tts_auth_headers,
                "X-Api-Resource-Id": resource_id,
                "X-Api-Request-Id": str(uuid.uuid4()),
                "Content-Type": "application/json",
                "Connection": "keep-alive",
            },
            json={"req_params": req_params},
        ) as response:
            await raise_for_upstream(response, "火山 TTS")
            audio = await self._collect_audio(response)

        if not audio:
            raise provider_error("火山 TTS 返回了空音频。")
        return audio

    async def _collect_audio(self, response: httpx.Response) -> bytes:
        chunks: list[bytes] = []
        try:
            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                code = event.get("code", 0)
                if code == STREAM_END_CODE:
                    break
                if isinstance(code, int) and code > 0:
                    message = event.get("message")
                    detail = f"：{message.strip()}" if isinstance(message, str) and message.strip() else ""
                    raise provider_error(f"火山 TTS 合成失败(code {code}){detail}。")
                data = event.get("data")
                if isinstance(data, str) and data:
                    try:
                        chunks.append(base64.b64decode(data))
                    except ValueError:
                        logger.warning("volc tts: invalid base64 chunk ignored")
        except BackendError:
            raise
        except httpx.HTTPError:
            from ..errors import upstream_timeout
            raise upstream_timeout("火山 TTS 流中断,请稍后重试。")
        return b"".join(chunks)

    def _resolve_voice(self, voice: str | None) -> tuple[str, str]:
        if voice is None or not voice.strip():
            return (
                self._settings.volc_tts_speaker,
                self._settings.volc_tts_resource_id,
            )
        speaker = voice.strip()
        resource_id = VOICE_RESOURCE_IDS.get(speaker)
        if resource_id is None:
            raise invalid_request("所选云端音色不受支持。")
        return speaker, resource_id
