import json

import httpx

from tests.conftest import configured_settings, deepseek_ok_handler

TEXT_FEEDBACK = {
    "summary": "回答切题，先肯定；重点是时态需要再稳一点。",
    "strengths": ["回答了题目，想法自然。", "举了一个具体例子。"],
    "problems": ["过去时有两处混用。", "结尾展开还可以再具体一点。"],
    "grammarSuggestions": ["下次说过去经历时，先想好动词的过去式。"],
    "vocabularySuggestions": ["可以把 good 换成具体一点的词，例如 relaxing。"],
    "improvedAnswer": "I like reading books in my free time because they help me relax after a busy day.",
    "referenceAnswers": [
        {
            "label": "简单自然版",
            "text": "I like reading books in my free time because they help me relax.",
        },
        {
            "label": "自然提升版",
            "text": "In my free time, I enjoy reading books because they help me unwind and learn something new.",
        },
        {
            "label": "另一种表达版",
            "text": "Reading is my favourite way to relax. A good book lets me escape and learn new things.",
        },
    ],
}

FEEDBACK_PAYLOAD = {
    "part": 1,
    "question": {"part": 1, "topic": "Hobbies", "prompt": "What do you like to do in your free time?"},
    "answer": "I like reading books in my free time.",
    "answerDurationSeconds": 14,
}


async def test_feedback_happy_path(make_app):
    app, _ = make_app(deepseek_ok_handler(TEXT_FEEDBACK))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/feedback", json=FEEDBACK_PAYLOAD)
    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == "回答切题，先肯定；重点是时态需要再稳一点。"
    assert len(body["referenceAnswers"]) == 3
    assert body["referenceAnswers"][1]["label"] == "自然提升版"
    assert body["problems"]


async def test_feedback_sends_text_only_payload(make_app):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "choices": [{"message": {"content": json.dumps(TEXT_FEEDBACK)}}],
        })

    app, _ = make_app(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/feedback",
            json={
                **FEEDBACK_PAYLOAD,
                "answerDurationSeconds": None,
                "tutorContext": "【Part 1 先直接回答】先用一句话直接回答。",
                "learnerContext": "本机历史:该学习者共完成 2 次单题练习。",
            },
        )
    assert response.status_code == 200
    request_body = captured["body"]
    assert request_body["model"] == "deepseek-v4-flash"
    assert request_body["response_format"] == {"type": "json_object"}
    messages = request_body["messages"]
    assert "friendly IELTS Speaking Tutor" in messages[0]["content"]
    user_prompt = messages[1]["content"]
    assert "发音" in user_prompt
    assert "IELTS Band" in user_prompt
    assert "口语" in user_prompt
    parsed_user = json.loads(user_prompt)
    assert parsed_user["part"] == 1
    assert parsed_user["answer"] == "I like reading books in my free time."
    assert parsed_user["answerDurationSeconds"] is None
    assert parsed_user["tutorContext"].startswith("【Part 1")
    assert parsed_user["learnerContext"].startswith("本机历史")
    assert "contextRules" in parsed_user


async def test_feedback_rejects_empty_answer(make_app):
    app, _ = make_app(deepseek_ok_handler(TEXT_FEEDBACK))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/v1/feedback", json={**FEEDBACK_PAYLOAD, "answer": "   "}
        )
    assert response.status_code == 400


async def test_feedback_not_configured(make_app):
    settings = configured_settings(deepseek_api_key="")
    app, _ = make_app(deepseek_ok_handler(TEXT_FEEDBACK), settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/v1/feedback", json=FEEDBACK_PAYLOAD)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "not-configured"


async def test_feedback_invalid_shape_returns_502(make_app):
    app, _ = make_app(deepseek_ok_handler({"summary": "missing everything"}))
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
