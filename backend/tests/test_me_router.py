import asyncio
import json

import httpx
from sqlalchemy import func, select

from app.commercial_models import AccountBillingState, UsageEvent
from app.models import AuthSession, SyncEntity, User
from tests.conftest import TEST_PASSWORD, configured_settings, mark_email_verified


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def register(
    client: httpx.AsyncClient,
    email: str,
    *,
    display_name: str | None = None,
) -> dict:
    payload = {"email": email, "password": TEST_PASSWORD}
    if display_name is not None:
        payload["displayName"] = display_name
    response = await client.post("/v1/auth/register", json=payload)
    assert response.status_code == 201
    return response.json()


async def test_me_reports_identity_plan_and_verification_gated_capabilities(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    email = "me-overview@example.com"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        registered = await register(client, email, display_name="Mia")
        headers = bearer(registered["accessToken"])
        unverified = await client.get("/v1/me", headers=headers)
        await mark_email_verified(client, email)
        verified = await client.get("/v1/me", headers=headers)

    assert unverified.status_code == 200
    body = unverified.json()
    assert body["user"]["displayName"] == "Mia"
    assert body["user"]["status"] == "active"
    assert body["billing"] == {
        "plan": "free",
        "subscriptionStatus": "none",
        "currentPeriodEnd": None,
    }
    assert {
        "sync",
        "feedback",
        "organize",
        "material_suggest",
        "tts",
        "provider_verify",
    } == set(
        body["capabilities"]
    )
    assert all(
        not capability["enabled"]
        and capability["reason"] == "email-not-verified"
        for capability in body["capabilities"].values()
    )
    assert verified.status_code == 200
    assert verified.json()["user"]["emailVerified"] is True
    assert all(
        capability["enabled"]
        for capability in verified.json()["capabilities"].values()
    )


async def test_profile_update_and_logout_all_revoke_every_session(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    email = "profile@example.com"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        registered = await register(client, email)
        second = await client.post(
            "/v1/auth/login",
            json={"email": email, "password": TEST_PASSWORD},
        )
        first_token = registered["accessToken"]
        second_token = second.json()["accessToken"]

        updated = await client.patch(
            "/v1/me",
            json={"displayName": "  Mia Chen  "},
            headers=bearer(first_token),
        )
        logged_out = await client.post(
            "/v1/auth/logout-all", headers=bearer(first_token)
        )
        first_restore = await client.get(
            "/v1/auth/session", headers=bearer(first_token)
        )
        second_restore = await client.get(
            "/v1/auth/session", headers=bearer(second_token)
        )

    assert updated.status_code == 200
    assert updated.json()["user"]["displayName"] == "Mia Chen"
    assert logged_out.status_code == 204
    assert first_restore.status_code == 401
    assert second_restore.status_code == 401

    async with app.state.database.session_factory() as db:
        active_sessions = await db.scalar(
            select(func.count())
            .select_from(AuthSession)
            .where(AuthSession.revoked_at.is_(None))
        )
    assert active_sessions == 0


async def test_delete_account_requires_password_and_clears_cloud_personal_data(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    email = "delete-me@example.com"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        registered = await register(client, email)
        token = registered["accessToken"]
        user_id = registered["user"]["id"]
        await mark_email_verified(client, email)
        headers = bearer(token)

        pushed = await client.post(
            "/v1/sync/push",
            headers=headers,
            json={
                "items": [
                    {
                        "operationId": "material-create",
                        "entityType": "personal_material",
                        "entityId": "material-1",
                        "baseVersion": 0,
                        "payload": {"title": "private material"},
                        "deletedAt": None,
                    }
                ]
            },
        )
        assert pushed.status_code == 200
        await client.get("/v1/me", headers=headers)

        rejected = await client.request(
            "DELETE",
            "/v1/me",
            headers=headers,
            json={"password": "wrong password"},
        )
        still_valid = await client.get("/v1/auth/session", headers=headers)
        deleted = await client.request(
            "DELETE",
            "/v1/me",
            headers=headers,
            json={"password": TEST_PASSWORD},
        )
        restore = await client.get("/v1/auth/session", headers=headers)
        login = await client.post(
            "/v1/auth/login",
            json={"email": email, "password": TEST_PASSWORD},
        )

    assert rejected.status_code == 401
    assert rejected.json()["error"]["code"] == "invalid-password"
    assert still_valid.status_code == 200
    assert deleted.status_code == 204
    assert restore.status_code == 401
    assert login.status_code == 401

    async with app.state.database.session_factory() as db:
        user = await db.get(User, user_id)
        entity_count = await db.scalar(select(func.count()).select_from(SyncEntity))
        billing_count = await db.scalar(
            select(func.count()).select_from(AccountBillingState)
        )
    assert user is not None
    assert user.status == "deleted"
    assert user.display_name is None
    assert user.email.endswith("@deleted.invalid")
    assert entity_count == 0
    assert billing_count == 0


async def test_unverified_account_cannot_push_sync_data(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        registered = await register(client, "unverified-sync@example.com")
        response = await client.post(
            "/v1/sync/push",
            headers=bearer(registered["accessToken"]),
            json={
                "items": [
                    {
                        "operationId": "op-1",
                        "entityType": "session",
                        "entityId": "session-1",
                        "baseVersion": 0,
                        "payload": {"answer": "private"},
                        "deletedAt": None,
                    }
                ]
            },
        )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "email-not-verified"
    async with app.state.database.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(SyncEntity)) == 0


FEEDBACK_RESULT = {
    "summary": "Focus on one clearer example.",
    "strengths": ["The answer is relevant."],
    "problems": ["The example is too general.", "The ending needs one more detail."],
    "grammarSuggestions": ["Keep the present tense consistent."],
    "vocabularySuggestions": ["Use a more specific activity verb."],
    "referenceAnswers": [
        {"label": "简单优化版", "text": "I read after work because it helps me relax."},
        {"label": "自然提升版", "text": "I often unwind with a short novel after work."},
    ],
    "naturalUpgradeSuggestions": {"addableContent": [], "advancedChanges": []},
    "answerFramework": [],
}

FEEDBACK_REQUEST = {
    "part": 1,
    "question": {
        "part": 1,
        "topic": "Hobbies",
        "prompt": "What do you do after work?",
    },
    "answer": "I usually read books after work.",
}


async def test_feedback_quota_is_counted_and_idempotent_retry_is_not_recharged(make_app):
    upstream_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal upstream_calls
        upstream_calls += 1
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": json.dumps(FEEDBACK_RESULT)},
                    }
                ]
            },
        )

    settings = configured_settings(free_feedback_monthly_quota=1)
    app, _ = make_app(handler, settings)
    email = "quota@example.com"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        registered = await register(client, email)
        await mark_email_verified(client, email)
        headers = {
            **bearer(registered["accessToken"]),
            "X-Idempotency-Key": "feedback-attempt-1",
        }
        first = await client.post("/v1/feedback", headers=headers, json=FEEDBACK_REQUEST)
        replay = await client.post("/v1/feedback", headers=headers, json=FEEDBACK_REQUEST)
        exhausted = await client.post(
            "/v1/feedback",
            headers={
                **bearer(registered["accessToken"]),
                "X-Idempotency-Key": "feedback-attempt-2",
            },
            json=FEEDBACK_REQUEST,
        )
        me = await client.get(
            "/v1/me", headers=bearer(registered["accessToken"])
        )

    assert first.status_code == 200
    assert replay.status_code == 200
    assert exhausted.status_code == 429
    assert exhausted.json()["error"]["code"] == "quota-exceeded"
    # 同 key 重试直接返回短期缓存，不重复访问上游或计费。
    assert upstream_calls == 1
    capability = me.json()["capabilities"]["feedback"]
    assert capability["quotaUsed"] == 1
    assert capability["quotaRemaining"] == 0

    async with app.state.database.session_factory() as db:
        usage_events = await db.scalar(select(func.count()).select_from(UsageEvent))
    assert usage_events == 1


async def test_concurrent_same_idempotency_key_is_settled_once(make_app):
    upstream_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal upstream_calls
        upstream_calls += 1
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": json.dumps(FEEDBACK_RESULT)},
                    }
                ]
            },
        )

    app, _ = make_app(handler, configured_settings(free_feedback_monthly_quota=1))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        registered = await register(client, "concurrent-quota@example.com")
        await mark_email_verified(client, "concurrent-quota@example.com")
        headers = {
            **bearer(registered["accessToken"]),
            "X-Idempotency-Key": "concurrent-feedback-1",
        }
        responses = await asyncio.gather(
            client.post("/v1/feedback", headers=headers, json=FEEDBACK_REQUEST),
            client.post("/v1/feedback", headers=headers, json=FEEDBACK_REQUEST),
        )

    assert [response.status_code for response in responses] == [200, 200]
    # 同 key 并发请求合并为一次上游调用，并只结算一次。
    assert upstream_calls == 1
    async with app.state.database.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(UsageEvent)) == 1


async def test_idempotency_key_cannot_be_reused_for_different_payload(make_app):
    upstream_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal upstream_calls
        upstream_calls += 1
        return httpx.Response(
            200,
            json={
                "choices": [{
                    "finish_reason": "stop",
                    "message": {"content": json.dumps(FEEDBACK_RESULT)},
                }],
            },
        )

    app, _ = make_app(handler, configured_settings(free_feedback_monthly_quota=1))
    email = "idempotency-payload@example.com"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        registered = await register(client, email)
        await mark_email_verified(client, email)
        headers = {
            **bearer(registered["accessToken"]),
            "X-Idempotency-Key": "feedback-payload-1",
        }
        first = await client.post("/v1/feedback", headers=headers, json=FEEDBACK_REQUEST)
        changed = {**FEEDBACK_REQUEST, "answer": "I cook dinner after work."}
        replay = await client.post("/v1/feedback", headers=headers, json=changed)

    assert first.status_code == 200
    assert replay.status_code == 409
    assert replay.json()["error"]["code"] == "idempotency-key-reused"
    assert upstream_calls == 1
