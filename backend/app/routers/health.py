"""GET /health:存活与供应商配置状态(只返回布尔,不返回任何密钥)。"""
from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict:
    return {
        "status": "ok",
        "version": "1.0.0",
        "providers": {
            "deepseek": request.app.state.services["deepseek"].is_configured,
            "volc_stt": request.app.state.services["volc_stt"].is_configured,
            "volc_tts": request.app.state.services["volc_tts"].is_configured,
        },
    }
