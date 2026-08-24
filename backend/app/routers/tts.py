"""POST /v1/tts：文本 → 火山语音合成 2.0 → mp3 字节。"""
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_db_session
from ..errors import not_configured
from ..services.auth_service import AuthContext
from ..services.feature_authorization import FeatureKey, usage_identifiers
from .auth import require_verified_user

router = APIRouter()


class TtsPayload(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    # 客户端会请求 en-US / rate 0.92 等参数；语言由 TTS 2.0 自动识别，
    # rate/pitch 会映射为火山的 speed_ratio/pitch_ratio（0.5–2.0）。
    language: str | None = Field(default=None, max_length=20)
    rate: float | None = Field(default=None, ge=0.5, le=2.0)
    pitch: float | None = Field(default=None, ge=0.5, le=2.0)


@router.post("/v1/tts")
async def tts(
    request: Request,
    payload: TtsPayload,
    auth: Annotated[AuthContext, Depends(require_verified_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> Response:
    service = request.app.state.services["volc_tts"]
    if not service.is_configured:
        raise not_configured("火山引擎 TTS")
    request_id, idempotency_key = usage_identifiers(request)
    await request.app.state.feature_authorization_service.consume(
        db,
        auth.user,
        FeatureKey.TTS,
        units=len(payload.text),
        request_id=request_id,
        idempotency_key=idempotency_key,
    )
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
