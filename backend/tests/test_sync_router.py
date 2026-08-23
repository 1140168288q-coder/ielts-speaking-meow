from datetime import datetime, timezone

import httpx
from sqlalchemy import func, select

from app.models import SyncChange, SyncEntity, SyncOperation


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register(client: httpx.AsyncClient, email: str) -> str:
    response = await client.post(
        "/v1/auth/register",
        json={"email": email, "password": "correct horse battery staple"},
    )
    assert response.status_code == 201
    return response.json()["accessToken"]


def item(
    operation_id: str,
    *,
    entity_type: str = "session",
    entity_id: str = "entity-1",
    base_version: int = 0,
    payload: dict | None = None,
    deleted_at: str | None = None,
) -> dict:
    return {
        "operationId": operation_id,
        "entityType": entity_type,
        "entityId": entity_id,
        "baseVersion": base_version,
        "payload": {"value": operation_id} if payload is None else payload,
        "deletedAt": deleted_at,
    }


async def test_sync_requires_opaque_session(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        push = await client.post("/v1/sync/push", json={"items": [item("op-1")]})
        pull = await client.get("/v1/sync/pull")

    assert push.status_code == 401
    assert pull.status_code == 401
    assert push.json()["error"]["code"] == "invalid-session"


async def test_push_is_idempotent_and_does_not_repeat_change(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        token = await register(client, "idempotent@example.com")
        body = {"items": [item("op-idempotent")]}
        first = await client.post("/v1/sync/push", json=body, headers=bearer(token))
        retry = await client.post("/v1/sync/push", json=body, headers=bearer(token))

    assert first.status_code == 200
    assert retry.status_code == 200
    first_result = first.json()["results"][0]
    retry_result = retry.json()["results"][0]
    assert first_result["status"] == "applied"
    assert first_result["version"] == 1
    assert first_result["replayed"] is False
    assert retry_result == {**first_result, "replayed": True}

    async with app.state.database.session_factory() as db:
        changes = await db.scalar(select(func.count()).select_from(SyncChange))
        operations = await db.scalar(select(func.count()).select_from(SyncOperation))
    assert changes == 1
    assert operations == 1


async def test_stale_base_version_returns_current_entity_conflict(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        token = await register(client, "conflict@example.com")
        created = await client.post(
            "/v1/sync/push",
            json={"items": [item("op-create", payload={"answer": "first"})]},
            headers=bearer(token),
        )
        conflict = await client.post(
            "/v1/sync/push",
            json={
                "items": [
                    item(
                        "op-stale",
                        base_version=0,
                        payload={"answer": "stale write"},
                    )
                ]
            },
            headers=bearer(token),
        )

    assert created.json()["results"][0]["status"] == "applied"
    result = conflict.json()["results"][0]
    assert result["status"] == "conflict"
    assert result["code"] == "version-conflict"
    assert result["version"] == 1
    assert result["current"]["payload"] == {"answer": "first"}
    assert result["current"]["version"] == 1


async def test_batch_returns_independent_applied_and_conflict_results(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        token = await register(client, "mixed-batch@example.com")
        await client.post(
            "/v1/sync/push",
            json={"items": [item("seed", entity_id="existing")]},
            headers=bearer(token),
        )
        response = await client.post(
            "/v1/sync/push",
            json={
                "items": [
                    item("stale", entity_id="existing", base_version=0),
                    item("fresh", entity_id="new"),
                ]
            },
            headers=bearer(token),
        )

    assert response.status_code == 200
    assert [result["status"] for result in response.json()["results"]] == [
        "conflict",
        "applied",
    ]


async def test_operation_id_reuse_with_different_content_is_rejected(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        token = await register(client, "reuse@example.com")
        await client.post(
            "/v1/sync/push",
            json={"items": [item("same-op", entity_id="first")]},
            headers=bearer(token),
        )
        reused = await client.post(
            "/v1/sync/push",
            json={"items": [item("same-op", entity_id="different")]},
            headers=bearer(token),
        )

    result = reused.json()["results"][0]
    assert result["status"] == "rejected"
    assert result["code"] == "operation-id-reused"
    async with app.state.database.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(SyncChange)) == 1


async def test_sync_isolated_by_authenticated_user_and_ignores_owner_id(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first_token = await register(client, "first@example.com")
        second_token = await register(client, "second@example.com")
        shared_key = {
            "operation_id": "same-operation-id",
            "entity_type": "personal_material",
            "entity_id": "same-entity-id",
        }
        first = item(
            **shared_key,
            payload={"title": "first user", "ownerId": "second-user-id"},
        )
        second = item(
            **shared_key,
            payload={"title": "second user", "ownerId": "first-user-id"},
        )
        await client.post(
            "/v1/sync/push", json={"items": [first]}, headers=bearer(first_token)
        )
        await client.post(
            "/v1/sync/push", json={"items": [second]}, headers=bearer(second_token)
        )
        first_pull = await client.get(
            "/v1/sync/pull", headers=bearer(first_token)
        )
        second_pull = await client.get(
            "/v1/sync/pull", headers=bearer(second_token)
        )

    assert [change["payload"] for change in first_pull.json()["changes"]] == [
        {"title": "first user"}
    ]
    assert [change["payload"] for change in second_pull.json()["changes"]] == [
        {"title": "second user"}
    ]
    async with app.state.database.session_factory() as db:
        entities = list((await db.scalars(select(SyncEntity))).all())
    assert len(entities) == 2
    assert entities[0].user_id != entities[1].user_id


async def test_delete_is_versioned_tombstone(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    deleted_at = datetime.now(timezone.utc).isoformat()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        token = await register(client, "delete@example.com")
        created = await client.post(
            "/v1/sync/push",
            json={"items": [item("create-expression", entity_type="expression")]},
            headers=bearer(token),
        )
        first_cursor = created.json()["results"][0]["cursor"]
        deleted = await client.post(
            "/v1/sync/push",
            json={
                "items": [
                    item(
                        "delete-expression",
                        entity_type="expression",
                        base_version=1,
                        payload={},
                        deleted_at=deleted_at,
                    )
                ]
            },
            headers=bearer(token),
        )
        pulled = await client.get(
            f"/v1/sync/pull?cursor={first_cursor}", headers=bearer(token)
        )

    result = deleted.json()["results"][0]
    assert result["status"] == "applied"
    assert result["version"] == 2
    changes = pulled.json()["changes"]
    assert len(changes) == 1
    assert changes[0]["version"] == 2
    assert changes[0]["deletedAt"] is not None
    assert changes[0]["payload"] == {}


async def test_pull_cursor_is_incremental_monotonic_and_paginated(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        token = await register(client, "cursor@example.com")
        pushed = await client.post(
            "/v1/sync/push",
            json={
                "items": [
                    item("op-session", entity_type="session", entity_id="s1"),
                    item("op-expression", entity_type="expression", entity_id="e1"),
                    item(
                        "op-material",
                        entity_type="personal_material",
                        entity_id="m1",
                    ),
                    item(
                        "op-setting", entity_type="user_setting", entity_id="theme"
                    ),
                ]
            },
            headers=bearer(token),
        )
        first_page = await client.get(
            "/v1/sync/pull?cursor=0&limit=2", headers=bearer(token)
        )
        first_body = first_page.json()
        second_page = await client.get(
            f"/v1/sync/pull?cursor={first_body['nextCursor']}&limit=2",
            headers=bearer(token),
        )
        second_body = second_page.json()
        empty_page = await client.get(
            f"/v1/sync/pull?cursor={second_body['nextCursor']}",
            headers=bearer(token),
        )

    result_cursors = [result["cursor"] for result in pushed.json()["results"]]
    assert result_cursors == sorted(result_cursors)
    assert len(set(result_cursors)) == 4
    assert first_body["hasMore"] is True
    assert len(first_body["changes"]) == 2
    assert second_body["hasMore"] is False
    assert len(second_body["changes"]) == 2
    assert first_body["nextCursor"] < second_body["nextCursor"]
    assert empty_page.json() == {
        "changes": [],
        "nextCursor": second_body["nextCursor"],
        "hasMore": False,
    }
