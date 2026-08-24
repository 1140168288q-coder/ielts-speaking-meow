"""当前登录账号的资料、能力与隐私生命周期接口。"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies import get_db_session
from ..errors import invalid_request
from ..services.auth_service import AuthContext, ensure_utc
from ..services.feature_authorization import FeatureCapability
from .auth import UserResponse, get_current_auth, user_response

router = APIRouter(prefix="/v1/me", tags=["me"])


class CapabilityResponse(BaseModel):
    enabled: bool
    source: str
    reason: str | None
    quotaLimit: int | None
    quotaUsed: int
    quotaRemaining: int | None
    period: str
    unit: str
    resetsAt: datetime


class BillingResponse(BaseModel):
    plan: str
    subscriptionStatus: str
    currentPeriodEnd: datetime | None


class MeResponse(BaseModel):
    user: UserResponse
    billing: BillingResponse
    capabilities: dict[str, CapabilityResponse]


class ProfileUpdatePayload(BaseModel):
    displayName: str | None = Field(default=None, max_length=80)

    @field_validator("displayName")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class DeleteAccountPayload(BaseModel):
    password: str = Field(min_length=8, max_length=128)


def capability_response(capability: FeatureCapability) -> CapabilityResponse:
    return CapabilityResponse(
        enabled=capability.enabled,
        source=capability.source,
        reason=capability.reason,
        quotaLimit=capability.quota_limit,
        quotaUsed=capability.quota_used,
        quotaRemaining=capability.quota_remaining,
        period=capability.period,
        unit=capability.unit,
        resetsAt=ensure_utc(capability.resets_at),
    )


async def build_me_response(
    request: Request, db: AsyncSession, auth: AuthContext
) -> MeResponse:
    authorization = request.app.state.feature_authorization_service
    billing = await authorization.get_billing_state(
        db, auth.user.id, create=True
    )
    capabilities = await authorization.capabilities(db, auth.user)
    await db.commit()
    return MeResponse(
        user=user_response(auth.user),
        billing=BillingResponse(
            plan=billing.plan,
            subscriptionStatus=billing.subscription_status,
            currentPeriodEnd=(
                ensure_utc(billing.current_period_end)
                if billing.current_period_end is not None
                else None
            ),
        ),
        capabilities={
            feature.value: capability_response(capability)
            for feature, capability in capabilities.items()
        },
    )


@router.get("", response_model=MeResponse)
async def get_me(
    request: Request,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> MeResponse:
    return await build_me_response(request, db, auth)


@router.patch("", response_model=MeResponse)
async def update_me(
    request: Request,
    payload: ProfileUpdatePayload,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> MeResponse:
    if "displayName" not in payload.model_fields_set:
        raise invalid_request("没有需要更新的资料。")
    await request.app.state.account_lifecycle_service.update_profile(
        db, auth.user, display_name=payload.displayName
    )
    return await build_me_response(request, db, auth)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    request: Request,
    payload: DeleteAccountPayload,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> Response:
    await request.app.state.account_lifecycle_service.delete_account(
        db, auth.user, password=payload.password
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
