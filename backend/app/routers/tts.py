"""POST /v1/tts:文本 → 火山语音合成 2.0 → mp3 字节。"""
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from .auth import get_current_auth

router = APIRouter(dependencies=[Depends(get_current_auth)])


class TtsPayload(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    # 客户端会请求 en-US / rate 0.92 等参数;语言由 TTS 2.0 自动识别,
    # rate/pitch 会映射为火山的 speed_ratio/pitch_ratio(0.5–2.0)。
    language: str | None = Field(default=None, max_length=20)
    rate: float | None = Field(default=None, ge=0.5, le=2.0)
    pitch: float | None = Field(default=None, ge=0.5, le=2.0)


@router.post("/v1/tts")
async def tts(request: Request, payload: TtsPayload) -> Response:
    service = request.app.state.services["volc_tts"]
    audio = await service.synthesize(
        payload.text,
        language=payload.language,
        rate=payload.rate,
        pitch=payload.pitch,
    )
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )
