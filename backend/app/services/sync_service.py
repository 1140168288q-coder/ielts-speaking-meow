"""登录用户的批量幂等 push 与 cursor 增量 pull。"""
import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..errors import payload_too_large
from ..models import SyncChange, SyncEntity, SyncOperation, User
from ..schemas.sync import (
    SyncChangeResponse,
    SyncPullResponse,
    SyncPushItem,
    SyncPushRequest,
    SyncPushResult,
)
from .auth_service import ensure_utc


def _normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return ensure_utc(value)


def _sanitize_payload(payload: dict) -> dict:
    sanitized = dict(payload)
    sanitized.pop("ownerId", None)
    return sanitized


def _json_bytes(value: object) -> int:
    return len(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    )


def _request_hash(item: SyncPushItem, payload: dict, is_delete: bool) -> str:
    canonical = json.dumps(
        {
            "entityType": item.entity_type,
            "entityId": item.entity_id,
            "baseVersion": item.base_version,
            "payload": payload,
            "deleted": is_delete,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _change_response(change: SyncChange) -> SyncChangeResponse:
    return SyncChangeResponse(
        cursor=change.cursor,
        entity_type=change.entity_type,
        entity_id=change.entity_id,
        version=change.version,
        payload=change.payload,
        deleted_at=_normalize_datetime(change.deleted_at),
        updated_at=ensure_utc(change.changed_at),
    )


def _entity_response(entity: SyncEntity) -> SyncChangeResponse:
    return SyncChangeResponse(
        cursor=entity.last_cursor,
        entity_type=entity.entity_type,
        entity_id=entity.entity_id,
        version=entity.version,
        payload=entity.payload,
        deleted_at=_normalize_datetime(entity.deleted_at),
        updated_at=ensure_utc(entity.updated_at),
    )


class SyncService:
    @staticmethod
    def validate_push_request(
        payload: SyncPushRequest,
        *,
        max_item_bytes: int,
        max_batch_bytes: int,
    ) -> None:
        for item in payload.items:
            size = _json_bytes(item.model_dump(mode="json", by_alias=True))
            if size > max_item_bytes:
                raise payload_too_large(
                    f"同步项 {item.entity_id} 超过服务端允许的大小。"
                )
        batch_size = _json_bytes(payload.model_dump(mode="json", by_alias=True))
        if batch_size > max_batch_bytes:
            raise payload_too_large("同步批次超过服务端允许的大小。")

    async def lock_user(self, db: AsyncSession, user_id: str) -> None:
        """串行化同一用户的 push，保证其 change cursor 不会乱序提交。"""
        await db.scalar(select(User.id).where(User.id == user_id).with_for_update())

    async def push_item(
        self, db: AsyncSession, user_id: str, item: SyncPushItem
    ) -> SyncPushResult:
        is_delete = item.deleted_at is not None
        payload = {} if is_delete else _sanitize_payload(item.payload)
        request_hash = _request_hash(item, payload, is_delete)
        previous = await db.scalar(
            select(SyncOperation).where(
                SyncOperation.user_id == user_id,
                SyncOperation.operation_id == item.operation_id,
            )
        )
        if previous is not None:
            if previous.request_hash != request_hash:
                return SyncPushResult(
                    operation_id=item.operation_id,
                    entity_type=item.entity_type,
                    entity_id=item.entity_id,
                    status="rejected",
                    code="operation-id-reused",
                    message="该 operationId 已用于另一项操作。",
                )
            replayed = SyncPushResult.model_validate(previous.result)
            return replayed.model_copy(update={"replayed": True})

        entity = await db.scalar(
            select(SyncEntity)
            .where(
                SyncEntity.user_id == user_id,
                SyncEntity.entity_type == item.entity_type,
                SyncEntity.entity_id == item.entity_id,
            )
            .with_for_update()
        )
        current_version = entity.version if entity is not None else 0
        if item.base_version != current_version:
            result = SyncPushResult(
                operation_id=item.operation_id,
                entity_type=item.entity_type,
                entity_id=item.entity_id,
                status="conflict",
                version=current_version,
                code="version-conflict",
                message="服务端实体版本已变化，请先拉取最新数据后重试。",
                current=_entity_response(entity) if entity is not None else None,
            )
            db.add(
                SyncOperation(
                    user_id=user_id,
                    operation_id=item.operation_id,
                    request_hash=request_hash,
                    result=result.model_dump(mode="json", by_alias=True),
                )
            )
            await db.flush()
            return result

        now = datetime.now(timezone.utc)
        next_version = current_version + 1
        deleted_at = now if is_delete else None
        change = SyncChange(
            user_id=user_id,
            entity_type=item.entity_type,
            entity_id=item.entity_id,
            version=next_version,
            payload=payload,
            deleted_at=deleted_at,
            changed_at=now,
        )
        db.add(change)
        await db.flush()

        if entity is None:
            entity = SyncEntity(
                user_id=user_id,
                entity_type=item.entity_type,
                entity_id=item.entity_id,
                version=next_version,
                payload=payload,
                deleted_at=deleted_at,
                updated_at=now,
                last_cursor=change.cursor,
            )
            db.add(entity)
        else:
            entity.version = next_version
            entity.payload = payload
            entity.deleted_at = deleted_at
            entity.updated_at = now
            entity.last_cursor = change.cursor

        result = SyncPushResult(
            operation_id=item.operation_id,
            entity_type=item.entity_type,
            entity_id=item.entity_id,
            status="applied",
            version=next_version,
            cursor=change.cursor,
        )
        db.add(
            SyncOperation(
                user_id=user_id,
                operation_id=item.operation_id,
                request_hash=request_hash,
                result=result.model_dump(mode="json", by_alias=True),
            )
        )
        await db.flush()
        return result

    async def pull(
        self, db: AsyncSession, user_id: str, cursor: int, limit: int
    ) -> SyncPullResponse:
        rows = list(
            (
                await db.scalars(
                    select(SyncChange)
                    .where(
                        SyncChange.user_id == user_id,
                        SyncChange.cursor > cursor,
                    )
                    .order_by(SyncChange.cursor)
                    .limit(limit + 1)
                )
            ).all()
        )
        has_more = len(rows) > limit
        visible_rows = rows[:limit]
        changes = [_change_response(row) for row in visible_rows]
        next_cursor = changes[-1].cursor if changes else cursor
        return SyncPullResponse(
            changes=changes,
            next_cursor=next_cursor,
            has_more=has_more,
        )
