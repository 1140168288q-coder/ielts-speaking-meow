import json

import httpx

from tests.conftest import configured_settings, deepseek_ok_handler

FIRST_ATTEMPT_FEEDBACK = {
    "summary": {
        "problem": "回答中填充词较多，流畅度受影响。",
        "suggestion": "试着用短暂停顿代替填充词。",
    },
    "versions": [
        {
            "style": "基础稳妥",
            "text": "I like reading books in my free time because they help me relax after a busy day.",
            "hint": "opening: I like ... because ...",
        },
        {
            "style": "自然均衡",
            "text": "In my free time, I enjoy reading books since they let me unwind and learn something new.",
            "hint": "opening: In my free time, I enjoy ...",
        },
        {
            "style": "略加挑战",
            "text": "Reading is my favourite way to relax because a good book lets me escape and broaden my view.",
            "hint": "opening: ... is my favourite way to ... because ...",
        },
    ],
}

COMPARISON_FEEDBACK = {
    "keyIssues": [
        {
            "category": "fluency",
            "kind": "improvement",
            "title": "Pauses",
            "observation": "Many long pauses.",
            "action": "Practice linking words.",
            "evidence": None,
        }
    ],
    "secondAttemptTips": ["Speak slower"],
    "revisions": {
        "minimalFix": None,
        "naturalVersion": "A better version.",
        "stretchVersion": None,
    },
}

FEEDBACK_PAYLOAD = {
    "kind": "first-attempt",
    "question": {"part": 1, "topic": "Hobbies", "prompt": "What do you like to do?", "cuePoints": []},
    "transcript": "I like reading books in my free time.",
    "metrics": {"durationSeconds": 12.5, "wordCount": 8},
}

COMPARISON_PAYLOAD = {
    "kind": "comparison",
    "question": {"part": 2, "topic": "Travel", "prompt": "Describe a trip.", "cuePoints": ["where", "when"]},
    "firstTranscript": "I went to Beijing.",
    "secondTranscript": "I went to Beijing with my family.",
    "localComparison": {"improved": True},
}


async def test_feedback_happy_path(make_app):
    app, _ = make_app(deepseek_ok_handler(FIRST_ATTEMPT_FEEDBACK))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/feedback", json=FEEDBACK_PAYLOAD)
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["problem"] == "回答中填充词较多，流畅度受影响。"
    assert len(body["versions"]) == 3


async def test_comparison_happy_path(make_app):
    app, _ = make_app(deepseek_ok_handler(COMPARISON_FEEDBACK))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/feedback", json=COMPARISON_PAYLOAD)
    assert response.status_code == 200


async def test_feedback_not_configured(make_app):
    settings = configured_settings(deepseek_api_key="")
    app, _ = make_app(deepseek_ok_handler(FIRST_ATTEMPT_FEEDBACK), settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/feedback", json=FEEDBACK_PAYLOAD)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "not-configured"


async def test_feedback_invalid_shape_returns_502(make_app):
    app, _ = make_app(deepseek_ok_handler({"summary": "not-an-object"}))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/feedback", json=FEEDBACK_PAYLOAD)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "provider-error"


async def test_feedback_upstream_401(make_app):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "bad key"}})

    app, _ = make_app(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/feedback", json=FEEDBACK_PAYLOAD)
    assert response.status_code == 502
    assert "401" in response.json()["error"]["message"]


async def test_feedback_missing_transcript(make_app):
    app, _ = make_app(deepseek_ok_handler(FIRST_ATTEMPT_FEEDBACK))
    payload = {**FEEDBACK_PAYLOAD, "transcript": "   "}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/feedback", json=payload)
    assert response.status_code == 400


async def test_organize_happy_path(make_app):
    questions = [
        {
            "part": 2,
            "topic": "Travel",
            "prompt": "Describe a memorable trip.",
            "cuePoints": ["where you went", "what you did"],
            "sourcePage": None,
        }
    ]
    app, _ = make_app(deepseek_ok_handler({"questions": questions}))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/organize",
            json={"fileName": "notes.txt", "extractedText": "I visited Beijing last year."},
        )
    assert response.status_code == 200
    assert response.json()["questions"][0]["part"] == 2


async def test_deepseek_request_uses_env_model(make_app):
    settings = configured_settings(deepseek_model="deepseek-v4-pro")
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps(FIRST_ATTEMPT_FEEDBACK)}}],
        })

    app, _ = make_app(handler, settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/v1/feedback", json=FEEDBACK_PAYLOAD)
    assert captured["body"]["model"] == "deepseek-v4-pro"
    assert captured["body"]["response_format"] == {"type": "json_object"}
