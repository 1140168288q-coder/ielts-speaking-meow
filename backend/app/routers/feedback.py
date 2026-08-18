"""POST /v1/feedback 与 POST /v1/organize:Text AI(DeepSeek)。

V1.7 反馈只分析答案文本:Part、题目、答案和可选作答时间。
"""
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..errors import invalid_request

router = APIRouter()


class FeedbackPayload(BaseModel):
    part: int = Field(ge=1, le=3)
    question: dict
    answer: str = Field(min_length=1, max_length=10_000)
    answerDurationSeconds: int | float | None = Field(default=None, ge=0)


class OrganizePayload(BaseModel):
    fileName: str = "material"
    extractedText: str


@router.post("/v1/feedback")
async def feedback(request: Request, payload: FeedbackPayload) -> dict:
    if not payload.answer.strip():
        raise invalid_request("反馈需要作答文本。")
    service = request.app.state.services["deepseek"]
    return await service.get_feedback(payload.model_dump())


@router.post("/v1/organize")
async def organize(request: Request, payload: OrganizePayload) -> dict:
    if not payload.extractedText.strip():
        raise invalid_request("导入材料内容为空。")
    service = request.app.state.services["deepseek"]
    questions = await service.organize_questions(
        payload.fileName, payload.extractedText
    )
    return {"questions": questions}
