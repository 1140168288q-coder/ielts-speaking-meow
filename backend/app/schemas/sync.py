"""增量同步 API 的请求与响应结构。"""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SYNC_SCHEMA_VERSION = 1
EntityType = Literal["session", "expression", "personal_material", "user_setting"]
PushStatus = Literal["applied", "conflict", "rejected"]


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        extra="forbid",
    )


class SyncPushItem(ApiModel):
    operation_id: str = Field(min_length=1, max_length=128)
    entity_type: EntityType
    entity_id: str = Field(min_length=1, max_length=128)
    base_version: int = Field(ge=0)
    payload: dict[str, Any]
    # V1 客户端以 deletedAt 非空表达删除；服务端只把它当布尔意图，
    # 不信任其时间值，响应中的 deletedAt 始终由服务端生成。
    deleted_at: datetime | None = None


class SyncPushRequest(ApiModel):
    # 缺省 1 是旧客户端迁移窗口；显式未知版本会被拒绝。
    schema_version: Literal[1] = SYNC_SCHEMA_VERSION
    items: list[SyncPushItem] = Field(min_length=1, max_length=100)


class SyncChangeResponse(ApiModel):
    cursor: int = Field(ge=1)
    entity_type: EntityType
    entity_id: str
    version: int = Field(ge=1)
    payload: dict[str, Any]
    deleted_at: datetime | None = None
    updated_at: datetime


class SyncPushResult(ApiModel):
    operation_id: str
    entity_type: EntityType
    entity_id: str
    status: PushStatus
    version: int | None = None
    cursor: int | None = None
    replayed: bool = False
    code: str | None = None
    message: str | None = None
    current: SyncChangeResponse | None = None


class SyncPushResponse(ApiModel):
    schema_version: Literal[1] = SYNC_SCHEMA_VERSION
    results: list[SyncPushResult]


class SyncPullResponse(ApiModel):
    schema_version: Literal[1] = SYNC_SCHEMA_VERSION
    changes: list[SyncChangeResponse]
    next_cursor: int = Field(ge=0)
    has_more: bool
