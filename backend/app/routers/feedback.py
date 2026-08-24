"""Text AI：答案反馈与私有材料题目整理。"""
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_db_session
from ..errors import invalid_request, not_configured
from ..services.auth_service import AuthContext
from ..services.feature_authorization import (
    FeatureKey,
    usage_identifiers,
)
from .auth import require_verified_user

router = APIRouter()


class FeedbackPayload(BaseModel):
    part: int = Field(ge=1, le=3)
    question: dict
    answer: str = Field(min_length=1, max_length=10_000)
    answerDurationSeconds: int | float | None = Field(default=None, ge=0)
    tutorContext: str = Field(default="", max_length=3_000)
    learnerContext: str = Field(default="", max_length=2_000)


class OrganizePayload(BaseModel):
    fileName: str = Field(default="material", max_length=255)
    extractedText: str = Field(max_length=60_000)


async def consume_feature(
    request: Request,
    db: AsyncSession,
    auth: AuthContext,
    feature: FeatureKey,
    *,
    units: int,
) -> None:
    request_id, idempotency_key = usage_identifiers(request)
    await request.app.state.feature_authorization_service.consume(
        db,
        auth.user,
        feature,
        units=units,
        request_id=request_id,
        idempotency_key=idempotency_key,
    )


@router.post("/v1/feedback")
async def feedback(
    request: Request,
    payload: FeedbackPayload,
    auth: Annotated[AuthContext, Depends(require_verified_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    if not payload.answer.strip():
        raise invalid_request("反馈需要作答文本。")
    service = request.app.state.services["deepseek"]
    if not service.is_configured:
        raise not_configured("DeepSeek(Text AI)")
    await consume_feature(request, db, auth, FeatureKey.FEEDBACK, units=1)
    return await service.get_feedback(payload.model_dump())


@router.post("/v1/organize")
async def organize(
    request: Request,
    payload: OrganizePayload,
    auth: Annotated[AuthContext, Depends(require_verified_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    if not payload.extractedText.strip():
        raise invalid_request("导入材料内容为空。")
    service = request.app.state.services["deepseek"]
    if not service.is_configured:
        raise not_configured("DeepSeek(Text AI)")
    await consume_feature(request, db, auth, FeatureKey.ORGANIZE, units=1)
    questions = await service.organize_questions(
        payload.fileName, payload.extractedText
    )
    return {"questions": questions}
