"""需要已验证 opaque session 的云端增量同步接口。"""
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_db_session
from ..schemas.sync import SyncPullResponse, SyncPushRequest, SyncPushResponse
from ..services.auth_service import AuthContext
from ..services.feature_authorization import FeatureKey
from ..services.sync_service import SyncService
from .auth import require_verified_user

router = APIRouter(prefix="/v1/sync", tags=["sync"])


@router.post("/push", response_model=SyncPushResponse)
async def push(
    request: Request,
    payload: SyncPushRequest,
    auth: Annotated[AuthContext, Depends(require_verified_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> SyncPushResponse:
    await request.app.state.feature_authorization_service.require_feature(
        db, auth.user, FeatureKey.SYNC
    )
    settings = request.app.state.settings
    service: SyncService = request.app.state.sync_service
    service.validate_push_request(
        payload,
        max_item_bytes=settings.sync_max_item_bytes,
        max_batch_bytes=settings.sync_max_batch_bytes,
    )
    await service.lock_user(db, auth.user.id)
    results = []
    for item in payload.items:
        results.append(await service.push_item(db, auth.user.id, item))
    await db.commit()
    return SyncPushResponse(results=results)


@router.get("/pull", response_model=SyncPullResponse)
async def pull(
    request: Request,
    auth: Annotated[AuthContext, Depends(require_verified_user)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
    cursor: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> SyncPullResponse:
    await request.app.state.feature_authorization_service.require_feature(
        db, auth.user, FeatureKey.SYNC
    )
    service: SyncService = request.app.state.sync_service
    return await service.pull(db, auth.user.id, cursor, limit)
