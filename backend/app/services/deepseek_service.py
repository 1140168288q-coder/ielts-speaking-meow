"""DeepSeekService:雅思口语反馈的 Text AI。

提示词与客户端 V1.1 的 OpenAICompatibleTextProvider 保持一致,迁移后客户端
不再接触 DeepSeek;模型名与密钥全部来自环境变量。
"""
import json
import logging
from typing import Literal

import httpx
from pydantic import BaseModel, Field

from ..config import Settings
from ..errors import not_configured, provider_error
from .http_client import raise_for_upstream, timeout_guard

logger = logging.getLogger(__name__)

FEEDBACK_SYSTEM = (
    "You are a concise IELTS speaking coach. Return JSON only. "
    "Never give an IELTS band score or pronunciation score. "
    "Identify 1 to 3 high-impact, actionable issues. "
    "Prefer natural, speakable English and do not replace the learner "
    "with a full model answer."
)
COMPARISON_SYSTEM = (
    "You are a concise IELTS speaking coach comparing two attempts. "
    "Return JSON only. Use at most 3 evidence-based observations. "
    "If evidence is missing, say so. "
    "Never invent an IELTS band or pronunciation score."
)
ORGANIZE_SYSTEM = (
    "Extract IELTS Speaking questions from the supplied private material. "
    "Return JSON only. Do not generate answers. "
    "Keep original questions when present; when the material is prose, "
    "create only concise speaking questions grounded in it. "
    "Part 2 needs 2 to 5 cue points. Return at most 50 questions."
)

MAX_AI_IMPORT_CHARACTERS = 60_000


class KeyIssue(BaseModel):
    category: Literal["fluency", "grammar", "vocabulary", "coherence"]
    kind: Literal["focus", "improvement", "notice"]
    title: str
    observation: str
    action: str
    evidence: str | None = None


class Revisions(BaseModel):
    minimalFix: str | None = None
    naturalVersion: str | None = None
    stretchVersion: str | None = None


class AiFeedback(BaseModel):
    keyIssues: list[KeyIssue] = Field(min_length=1, max_length=3)
    secondAttemptTips: list[str] = Field(default_factory=list, max_length=3)
    revisions: Revisions = Revisions()


class ImportQuestion(BaseModel):
    part: Literal[1, 2, 3]
    topic: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=500)
    cuePoints: list[str] = Field(default_factory=list, max_length=5)
    sourcePage: int | None = None


class ImportQuestionList(BaseModel):
    questions: list[ImportQuestion] = Field(min_length=1, max_length=50)


class DeepSeekService:
    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.deepseek_api_key)

    async def get_feedback(self, payload: dict) -> dict:
        user = json.dumps(
            {
                "task": "feedback-after-first-attempt",
                "requiredShape": {
                    "keyIssues": [
                        {
                            "category": "fluency | grammar | vocabulary | coherence",
                            "kind": "focus | improvement | notice",
                            "title": "short title",
                            "observation": "what happened",
                            "action": "one concrete action",
                            "evidence": "short quote or null",
                        }
                    ],
                    "secondAttemptTips": ["maximum 3 short tips"],
                    "revisions": {
                        "minimalFix": "string or null",
                        "naturalVersion": "string or null",
                        "stretchVersion": "string or null",
                    },
                },
                "question": payload.get("question"),
                "transcript": payload.get("transcript"),
                "localMetrics": payload.get("metrics"),
            },
            ensure_ascii=False,
        )
        return await self._complete_validated(FEEDBACK_SYSTEM, user, AiFeedback)

    async def compare_attempts(self, payload: dict) -> dict:
        user = json.dumps(
            {
                "task": "compare-two-speaking-attempts",
                "requiredShape": {
                    "keyIssues": [
                        {
                            "category": "fluency | grammar | vocabulary | coherence",
                            "kind": "focus | improvement | notice",
                            "title": "short title",
                            "observation": "evidence-based comparison",
                            "action": "one next action",
                            "evidence": "short quote or null",
                        }
                    ],
                    "secondAttemptTips": [],
                    "revisions": {
                        "minimalFix": "string or null",
                        "naturalVersion": "string or null",
                        "stretchVersion": "string or null",
                    },
                },
                "question": payload.get("question"),
                "firstTranscript": payload.get("firstTranscript"),
                "secondTranscript": payload.get("secondTranscript"),
                "localComparison": payload.get("localComparison"),
            },
            ensure_ascii=False,
        )
        return await self._complete_validated(COMPARISON_SYSTEM, user, AiFeedback)

    async def organize_questions(self, fileName: str, extractedText: str) -> list[dict]:
        user = json.dumps(
            {
                "task": "organize-imported-speaking-questions",
                "requiredShape": {
                    "questions": [
                        {
                            "part": "1 | 2 | 3 as a number",
                            "topic": "short topic",
                            "prompt": "question text",
                            "cuePoints": ["Part 2 only; otherwise empty"],
                            "sourcePage": "page number or null",
                        }
                    ]
                },
                "fileName": fileName,
                "material": extractedText[:MAX_AI_IMPORT_CHARACTERS],
            },
            ensure_ascii=False,
        )
        result = await self._complete_validated(ORGANIZE_SYSTEM, user, ImportQuestionList)
        return result["questions"]

    async def _complete_validated(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
    ) -> dict:
        if not self.is_configured:
            raise not_configured("DeepSeek(Text AI)")
        base = self._settings.deepseek_base_url.rstrip("/")
        run = timeout_guard("DeepSeek")
        response = await run(
            lambda: self._client.post(
                f"{base}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._settings.deepseek_api_key}",
                },
                json={
                    "model": self._settings.deepseek_model,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
            )
        )
        await raise_for_upstream(response, "DeepSeek")
        try:
            data = response.json()
            content = data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise provider_error("DeepSeek 返回了无法识别的结果。")
        if not content or not content.strip():
            raise provider_error("DeepSeek 返回内容为空。")

        parsed = self._parse_json_content(content)
        try:
            return schema.model_validate(parsed).model_dump(mode="json")
        except Exception:
            logger.warning("DeepSeek output failed schema validation")
            raise provider_error("Text AI 返回结构不完整,已保留本地结果。")

    @staticmethod
    def _parse_json_content(content: str) -> object:
        text = content.strip()
        if text.startswith("```"):
            text = text.removeprefix("```json").removeprefix("```")
            text = text.removesuffix("```").strip()
        try:
            return json.loads(text)
        except ValueError:
            raise provider_error("Text AI 返回的 JSON 无效,已保留本地结果。")
