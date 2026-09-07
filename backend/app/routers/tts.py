"""POST /v1/tts：文本 → 火山语音合成 2.0 → mp3 字节。"""
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_db_session
from ..errors import conflict, not_configured
from ..services.auth_service import AuthContext
from ..services.feature_authorization import (
    FeatureKey,
    request_fingerprint,
    usage_identifiers,
)
from .auth import require_verified_user

router = APIRouter()


class TtsPayload(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    # 客户端会请求 en-US / rate 0.92 等参数；语言由 TTS 2.0 自动识别，
    # rate/pitch 会映射为火山的 speed_ratio/pitch_ratio（0.5–2.0）。
    language: str | None = Field(default=None, max_length=20)
    voice: str | None = Field(default=None, max_length=120)
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
    request_hash = request_fingerprint(request.url.path, payload.model_dump(mode="json"))
    authorization = request.app.state.feature_authorization_service
    async with authorization.idempotency_lock(auth.user.id, FeatureKey.TTS, idempotency_key):
        await authorization.authorize(
            db,
            auth.user,
            FeatureKey.TTS,
            units=len(payload.text),
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        cached = authorization.get_cached_result(
            auth.user.id, FeatureKey.TTS, idempotency_key, request_hash
        )
        if cached is not None:
            return Response(
                content=cast(bytes, cached),
                media_type="audio/mpeg",
                headers={"Cache-Control": "private, max-age=86400"},
            )
        if idempotency_key is not None and await authorization.has_idempotency_event(
            db, auth.user, FeatureKey.TTS, idempotency_key, request_hash
        ):
            raise conflict(
                "idempotency-result-unavailable",
                "此请求结果已过期，请重新提交并生成新的请求标识。",
            )
        audio = await service.synthesize(
            payload.text,
            language=payload.language,
            voice=payload.voice,
            rate=payload.rate,
            pitch=payload.pitch,
        )
        await authorization.settle(
            db,
            auth.user,
            FeatureKey.TTS,
            units=len(payload.text),
            request_id=request_id,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        authorization.cache_result(
            auth.user.id, FeatureKey.TTS, idempotency_key, request_hash, audio
        )
        return Response(
            content=audio,
            media_type="audio/mpeg",
            headers={"Cache-Control": "private, max-age=86400"},
        )
