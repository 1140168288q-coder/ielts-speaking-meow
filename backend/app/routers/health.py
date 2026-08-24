"""Backend 首页与健康检查（不返回任何密钥）。

/health 展示每个供应商的配置、模型和最近一次真实调用/验证状态。
"""
import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_db_session
from ..services.auth_service import AuthContext
from ..services.feature_authorization import FeatureKey, usage_identifiers
from .auth import require_verified_user

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def home(request: Request) -> str:
    """让手机浏览器打开基地址时能明确看到连接结果，而不是 404。"""
    return f"""<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>雅思口语喵 Backend</title></head>
<body style="font-family:sans-serif;max-width:680px;margin:48px auto;padding:0 20px">
<h1>雅思口语喵 Backend 连接正常</h1>
<p>版本：{request.app.version}</p>
<p>手机 App 的 Backend 地址只填写到端口，不要添加 <code>/health</code>。</p>
<p><a href="/health">查看健康状态</a></p>
</body></html>"""


@router.get("/health")
async def health(request: Request) -> dict:
    settings = request.app.state.settings
    services = request.app.state.services
    return {
        "status": "ok",
        "version": request.app.version,
        "providers": {
            "deepseek": {
                "kind": "text",
                "configured": services["deepseek"].is_configured,
                "model": settings.deepseek_model,
                "verification": services["deepseek"].last_call.snapshot(),
            },
            "volc_tts": {
                "kind": "tts",
                "configured": services["volc_tts"].is_configured,
                "model": settings.volc_tts_resource_id,
                "resourceId": settings.volc_tts_resource_id,
                "speaker": {
                    "id": settings.volc_tts_speaker,
                    "name": settings.volc_tts_speaker_name or None,
                },
                "verification": services["volc_tts"].last_call.snapshot(),
            },
        },
    }


@router.post("/health/verify")
async def verify_providers(
    request: Request,
    auth: Annotated[AuthContext, Depends(require_verified_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """显式验证上游：DeepSeek 小规模补全 + TTS 合成一句 Hello。"""
    request_id, idempotency_key = usage_identifiers(request)
    await request.app.state.feature_authorization_service.consume(
        db,
        auth.user,
        FeatureKey.PROVIDER_VERIFY,
        units=1,
        request_id=request_id,
        idempotency_key=idempotency_key,
    )
    services = request.app.state.services
    deepseek_task = services["deepseek"].verify()
    tts_task = services["volc_tts"].verify()
    deepseek_snapshot, tts_snapshot = await asyncio.gather(
        deepseek_task, tts_task
    )
    return {
        "providers": {
            "deepseek": deepseek_snapshot,
            "volc_tts": tts_snapshot,
        }
    }
