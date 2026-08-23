import json

import httpx
import pytest

from tests.conftest import authenticated_headers


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/v1/feedback",
            {
                "part": 1,
                "question": {"part": 1, "prompt": "What do you study?"},
                "answer": "I study computer science.",
            },
        ),
        (
            "/v1/organize",
            {"fileName": "notes.txt", "extractedText": "Part 1 questions"},
        ),
        ("/v1/tts", {"text": "Hello."}),
        ("/health/verify", None),
    ],
)
async def test_paid_and_private_routes_reject_unauthenticated_requests(
    make_app, path, payload
):
    upstream_calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal upstream_calls
        upstream_calls += 1
        return httpx.Response(500)

    app, _ = make_app(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(path, json=payload)

    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "code": "invalid-session",
            "message": "登录状态无效或已过期,请重新登录。",
        }
    }
    assert upstream_calls == 0


async def test_authentication_does_not_block_allowed_cors_preflight(make_app):
    app, _ = make_app(lambda request: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.options(
            "/v1/feedback",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


async def test_one_accounts_logout_does_not_revoke_another_accounts_access(make_app):
    def handler(request: httpx.Request) -> httpx.Response:
        questions = [
            {
                "part": 1,
                "topic": "Study",
                "prompt": "What do you study?",
                "cuePoints": [],
                "sourcePage": None,
            }
        ]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps({"questions": questions})}}
                ]
            },
        )

    app, _ = make_app(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first_headers = await authenticated_headers(client, "first-route@example.com")
        second_headers = await authenticated_headers(client, "second-route@example.com")
        logout = await client.post("/v1/auth/logout", headers=first_headers)
        first_response = await client.post(
            "/v1/organize",
            json={"fileName": "notes.txt", "extractedText": "Part 1 questions"},
            headers=first_headers,
        )
        second_response = await client.post(
            "/v1/organize",
            json={"fileName": "notes.txt", "extractedText": "Part 1 questions"},
            headers=second_headers,
        )

    assert logout.status_code == 204
    assert first_response.status_code == 401
    assert second_response.status_code == 200
    assert second_response.json()["questions"][0]["topic"] == "Study"
