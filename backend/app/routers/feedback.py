"""Text AI：答案反馈与私有材料题目整理。"""
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_db_session
from ..errors import invalid_request, not_configured
from ..services.auth_service import AuthContext
from ..services.feature_authorization import (
    FeatureKey,
    request_fingerprint,
    usage_identifiers,
)
from .auth import require_verified_user

router = APIRouter()


class StrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FeedbackPayload(StrictPayload):
    part: int = Field(ge=1, le=3)
    question: dict
    answer: str = Field(min_length=1, max_length=10_000)
    answerDurationSeconds: int | float | None = Field(default=None, ge=0)
    tutorContext: str = Field(default="", max_length=3_000)
    learnerContext: str = Field(default="", max_length=2_000)
    userKnowledgeContext: str = Field(default="", max_length=2_400)
    naturalUpgradeLevel: Literal["simple", "medium", "challenging"] = "medium"
    spokenEnglishStyle: Literal["british", "american"] = "british"


class SecondAttemptFeedbackPayload(StrictPayload):
    part: int = Field(ge=1, le=3)
    question: dict
    answer: str = Field(min_length=1, max_length=10_000)


class OrganizePayload(StrictPayload):
    fileName: str = Field(default="material", max_length=255)
    extractedText: str = Field(max_length=60_000)


class KnowledgeChunk(StrictPayload):
    index: int = Field(ge=0, le=23)
    pageNumber: int | None = Field(default=None, ge=1, le=10_000)
    section: str | None = Field(default=None, max_length=240)
    text: str = Field(min_length=20, max_length=2_400)


class KnowledgeOrganizePayload(StrictPayload):
    fileName: str = Field(default="knowledge", max_length=255)
    sourceHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    chunks: list[KnowledgeChunk] = Field(min_length=1, max_length=24)


class MaterialSuggestPayload(StrictPayload):
    memoryDigest: str = Field(min_length=1, max_length=4_000)
    existingTitles: list[str] = Field(default_factory=list, max_length=50)
    maxCount: int = Field(default=4, ge=1, le=6)
    targetPart: int | None = Field(default=None, ge=1, le=3)


async def consume_feature(
    request: Request,
    db: AsyncSession,
    auth: AuthContext,
    feature: FeatureKey,
    *,
    units: int,
    request_hash: str | None = None,
) -> None:
    request_id, idempotency_key = usage_identifiers(request)
    await request.app.state.feature_authorization_service.consume(
        db,
        auth.user,
        feature,
        units=units,
        request_id=request_id,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )


async def authorize_feature(
    request: Request,
    db: AsyncSession,
    auth: AuthContext,
    feature: FeatureKey,
    *,
    units: int,
    request_hash: str | None = None,
) -> None:
    """只检查额度，避免上游失败也产生计量事件。"""
    _, idempotency_key = usage_identifiers(request)
    await request.app.state.feature_authorization_service.authorize(
        db,
        auth.user,
        feature,
        units=units,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )


async def settle_feature(
    request: Request,
    db: AsyncSession,
    auth: AuthContext,
    feature: FeatureKey,
    *,
    units: int,
    request_hash: str | None = None,
) -> None:
    request_id, idempotency_key = usage_identifiers(request)
    await request.app.state.feature_authorization_service.settle(
        db,
        auth.user,
        feature,
        units=units,
        request_id=request_id,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
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
    _, idempotency_key = usage_identifiers(request)
    request_hash = request_fingerprint(request.url.path, payload.model_dump(mode="json"))
    authorization = request.app.state.feature_authorization_service
    async with authorization.idempotency_lock(auth.user.id, FeatureKey.FEEDBACK, idempotency_key):
        await authorize_feature(
            request, db, auth, FeatureKey.FEEDBACK, units=1, request_hash=request_hash
        )
        cached = authorization.get_cached_result(
            auth.user.id, FeatureKey.FEEDBACK, idempotency_key, request_hash
        )
        if cached is not None:
            return cast(dict, cached)
        if idempotency_key is not None and await authorization.has_idempotency_event(
            db, auth.user, FeatureKey.FEEDBACK, idempotency_key, request_hash
        ):
            raise invalid_request("此请求结果已过期，请重新提交并生成新的请求标识。")
        result = await service.get_feedback(payload.model_dump())
        await settle_feature(
            request, db, auth, FeatureKey.FEEDBACK, units=1, request_hash=request_hash
        )
        authorization.cache_result(
            auth.user.id, FeatureKey.FEEDBACK, idempotency_key, request_hash, result
        )
        return result


@router.post("/v1/feedback/second-attempt")
async def second_attempt_feedback(
    request: Request,
    payload: SecondAttemptFeedbackPayload,
    auth: Annotated[AuthContext, Depends(require_verified_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    if not payload.answer.strip():
        raise invalid_request("二次回答分析需要作答文本。")
    service = request.app.state.services["deepseek"]
    if not service.is_configured:
        raise not_configured("DeepSeek(Text AI)")
    _, idempotency_key = usage_identifiers(request)
    request_hash = request_fingerprint(request.url.path, payload.model_dump(mode="json"))
    authorization = request.app.state.feature_authorization_service
    async with authorization.idempotency_lock(auth.user.id, FeatureKey.FEEDBACK, idempotency_key):
        await authorize_feature(
            request, db, auth, FeatureKey.FEEDBACK, units=1, request_hash=request_hash
        )
        cached = authorization.get_cached_result(
            auth.user.id, FeatureKey.FEEDBACK, idempotency_key, request_hash
        )
        if cached is not None:
            return cast(dict, cached)
        if idempotency_key is not None and await authorization.has_idempotency_event(
            db, auth.user, FeatureKey.FEEDBACK, idempotency_key, request_hash
        ):
            raise invalid_request("此请求结果已过期，请重新提交并生成新的请求标识。")
        result = await service.get_second_attempt_feedback(payload.model_dump())
        await settle_feature(
            request, db, auth, FeatureKey.FEEDBACK, units=1, request_hash=request_hash
        )
        authorization.cache_result(
            auth.user.id, FeatureKey.FEEDBACK, idempotency_key, request_hash, result
        )
        return result


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
    _, idempotency_key = usage_identifiers(request)
    request_hash = request_fingerprint(request.url.path, payload.model_dump(mode="json"))
    authorization = request.app.state.feature_authorization_service
    async with authorization.idempotency_lock(auth.user.id, FeatureKey.ORGANIZE, idempotency_key):
        await authorize_feature(
            request, db, auth, FeatureKey.ORGANIZE, units=1, request_hash=request_hash
        )
        cached = authorization.get_cached_result(
            auth.user.id, FeatureKey.ORGANIZE, idempotency_key, request_hash
        )
        if cached is not None:
            return cast(dict, cached)
        if idempotency_key is not None and await authorization.has_idempotency_event(
            db, auth.user, FeatureKey.ORGANIZE, idempotency_key, request_hash
        ):
            raise invalid_request("此请求结果已过期，请重新提交并生成新的请求标识。")
        questions = await service.organize_questions(
            payload.fileName, payload.extractedText
        )
        result = {"questions": questions}
        await settle_feature(
            request, db, auth, FeatureKey.ORGANIZE, units=1, request_hash=request_hash
        )
        authorization.cache_result(
            auth.user.id, FeatureKey.ORGANIZE, idempotency_key, request_hash, result
        )
        return result


@router.post("/v1/knowledge/organize")
async def organize_knowledge(
    request: Request,
    payload: KnowledgeOrganizePayload,
    auth: Annotated[AuthContext, Depends(require_verified_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    if not any(chunk.text.strip() for chunk in payload.chunks):
        raise invalid_request("知识库整理需要可用的文本分块。")
    total_characters = sum(len(chunk.text) for chunk in payload.chunks)
    if total_characters > 48_000:
        raise invalid_request("知识库整理文本超过 48,000 字符，请拆分文件或缩小范围。")
    service = request.app.state.services["deepseek"]
    if not service.is_configured:
        raise not_configured("DeepSeek(Text AI)")
    _, idempotency_key = usage_identifiers(request)
    request_hash = request_fingerprint(request.url.path, payload.model_dump(mode="json"))
    authorization = request.app.state.feature_authorization_service
    async with authorization.idempotency_lock(auth.user.id, FeatureKey.ORGANIZE, idempotency_key):
        await authorize_feature(
            request, db, auth, FeatureKey.ORGANIZE, units=1, request_hash=request_hash
        )
        cached = authorization.get_cached_result(
            auth.user.id, FeatureKey.ORGANIZE, idempotency_key, request_hash
        )
        if cached is not None:
            return cast(dict, cached)
        if idempotency_key is not None and await authorization.has_idempotency_event(
            db, auth.user, FeatureKey.ORGANIZE, idempotency_key, request_hash
        ):
            raise invalid_request("此请求结果已过期，请重新提交并生成新的请求标识。")
        entries = await service.organize_knowledge(
            payload.fileName,
            payload.sourceHash,
            [chunk.model_dump(mode="json") for chunk in payload.chunks],
        )
        result = {"entries": entries}
        await settle_feature(
            request, db, auth, FeatureKey.ORGANIZE, units=1, request_hash=request_hash
        )
        authorization.cache_result(
            auth.user.id, FeatureKey.ORGANIZE, idempotency_key, request_hash, result
        )
        return result


@router.post("/v1/materials/suggest")
async def suggest_materials(
    request: Request,
    payload: MaterialSuggestPayload,
    auth: Annotated[AuthContext, Depends(require_verified_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    if not payload.memoryDigest.strip():
        raise invalid_request("素材提炼需要本地记忆摘要。")
    service = request.app.state.services["deepseek"]
    if not service.is_configured:
        raise not_configured("DeepSeek(Text AI)")
    _, idempotency_key = usage_identifiers(request)
    request_hash = request_fingerprint(request.url.path, payload.model_dump(mode="json"))
    authorization = request.app.state.feature_authorization_service
    async with authorization.idempotency_lock(auth.user.id, FeatureKey.MATERIAL_SUGGEST, idempotency_key):
        await authorize_feature(
            request, db, auth, FeatureKey.MATERIAL_SUGGEST, units=1, request_hash=request_hash
        )
        cached = authorization.get_cached_result(
            auth.user.id, FeatureKey.MATERIAL_SUGGEST, idempotency_key, request_hash
        )
        if cached is not None:
            return cast(dict, cached)
        if idempotency_key is not None and await authorization.has_idempotency_event(
            db, auth.user, FeatureKey.MATERIAL_SUGGEST, idempotency_key, request_hash
        ):
            raise invalid_request("此请求结果已过期，请重新提交并生成新的请求标识。")
        suggestions = await service.suggest_materials(
            payload.memoryDigest,
            [title for title in payload.existingTitles if title.strip()],
            payload.maxCount,
            payload.targetPart,
        )
        result = {"suggestions": suggestions}
        await settle_feature(
            request, db, auth, FeatureKey.MATERIAL_SUGGEST, units=1, request_hash=request_hash
        )
        authorization.cache_result(
            auth.user.id, FeatureKey.MATERIAL_SUGGEST, idempotency_key, request_hash, result
        )
        return result
