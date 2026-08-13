"""POST /v1/tts:文本 → 火山语音合成 2.0 → mp3 字节。"""
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

router = APIRouter()


class TtsPayload(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/v1/tts")
async def tts(request: Request, payload: TtsPayload) -> Response:
    service = request.app.state.services["volc_tts"]
    audio = await service.synthesize(payload.text)
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )
