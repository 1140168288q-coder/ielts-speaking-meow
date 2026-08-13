"""POST /v1/stt:上传 WAV → 火山流式语音识别(WebSocket 直传)→ 转写文本。

流式识别不需要公网可拉取的音频地址,音频全程在内存中直传火山,
识别完成后不落盘、无残留。
"""
import io
import logging
import wave

from fastapi import APIRouter, Form, Request, UploadFile

from ..errors import (
    BackendError,
    invalid_request,
    payload_too_large,
    provider_error,
    unsupported_media,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _sniff_format(head: bytes) -> str | None:
    """按魔数识别音频容器。"""
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "wav"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0):
        return "mp3"
    if head[:4] == b"OggS":
        return "ogg"
    if len(head) > 12 and head[4:8] == b"ftyp":
        return "m4a"
    return None


def _wav_duration_seconds(data: bytes) -> float | None:
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            return frames / rate if rate > 0 else None
    except (wave.Error, EOFError, OSError):
        return None


@router.post("/v1/stt")
async def transcribe_audio(
    request: Request,
    file: UploadFile,
    language: str | None = Form(default=None),
) -> dict:
    """上传录音并转写。language 字段保留兼容,流式识别自动识别中英文。"""
    settings = request.app.state.settings
    max_bytes = settings.max_upload_mb * 1024 * 1024

    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise payload_too_large(f"音频超过 {settings.max_upload_mb}MB 限制。")
    if not data:
        raise invalid_request("上传的音频为空。")

    audio_format = _sniff_format(data)
    if audio_format != "wav":
        raise unsupported_media("转写仅支持 WAV 格式,App 会自动转换。")

    duration = _wav_duration_seconds(data)
    if duration is not None and duration > settings.max_stt_duration_seconds:
        raise invalid_request(f"录音时长超过 {settings.max_stt_duration_seconds} 秒限制。")

    try:
        text = await request.app.state.services["volc_stt"].transcribe(data)
        return {"text": text}
    except BackendError:
        raise
    except Exception:
        logger.exception("unexpected stt failure")
        raise provider_error("转写服务出现异常,请稍后重试。")
