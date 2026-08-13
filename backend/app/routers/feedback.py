"""POST /v1/feedback 与 POST /v1/organize:Text AI(DeepSeek)。"""
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ..errors import invalid_request

router = APIRouter()


class FeedbackPayload(BaseModel):
    kind: Literal["first-attempt", "comparison"]
    question: dict
    transcript: str = ""
    metrics: dict | None = None
    firstTranscript: str | None = None
    secondTranscript: str | None = None
    localComparison: dict | None = None


class OrganizePayload(BaseModel):
    fileName: str = "material"
    extractedText: str


@router.post("/v1/feedback")
async def feedback(request: Request, payload: FeedbackPayload) -> dict:
    service = request.app.state.services["deepseek"]
    data = payload.model_dump()
    if payload.kind == "comparison":
        if not data.get("firstTranscript") or not data.get("secondTranscript"):
            raise invalid_request("对比反馈需要两次作答的转写文本。")
        return await service.compare_attempts(data)
    if not payload.transcript.strip():
        raise invalid_request("反馈需要作答转写文本。")
    return await service.get_feedback(data)


@router.post("/v1/organize")
async def organize(request: Request, payload: OrganizePayload) -> dict:
    if not payload.extractedText.strip():
        raise invalid_request("导入材料内容为空。")
    service = request.app.state.services["deepseek"]
    questions = await service.organize_questions(
        payload.fileName, payload.extractedText
    )
    return {"questions": questions}
