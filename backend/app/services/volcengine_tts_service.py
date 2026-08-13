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

import httpx

from ..config import Settings
from ..errors import BackendError, invalid_request, not_configured, provider_error
from .http_client import raise_for_upstream

logger = logging.getLogger(__name__)

STREAM_END_CODE = 20000000
MAX_TEXT_CHARACTERS = 2000


class VolcengineTTSService:
    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings

    @property
    def is_configured(self) -> bool:
        return bool(
            self._settings.volc_api_key
            or (self._settings.volc_app_id and self._settings.volc_access_token)
        )

    async def synthesize(self, text: str) -> bytes:
        if not self.is_configured:
            raise not_configured("火山引擎 TTS")
        text = text.strip()
        if not text:
            raise invalid_request("合成文本不能为空。")
        if len(text) > MAX_TEXT_CHARACTERS:
            raise invalid_request(f"合成文本过长(最多 {MAX_TEXT_CHARACTERS} 字符)。")

        async with self._client.stream(
            "POST",
            f"{self._settings.volc_endpoint}/api/v3/tts/unidirectional",
            headers={
                **self._settings.volc_tts_auth_headers,
                "X-Api-Resource-Id": self._settings.volc_tts_resource_id,
                "Content-Type": "application/json",
                "Connection": "keep-alive",
            },
            json={
                "req_params": {
                    "text": text,
                    "speaker": self._settings.volc_tts_speaker,
                    "audio_params": {
                        "format": "mp3",
                        "sample_rate": 24000,
                    },
                }
            },
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
                    raise provider_error(f"火山 TTS 合成失败(code {code})。")
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
