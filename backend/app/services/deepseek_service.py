"""DeepSeekService:雅思口语反馈的 Text AI。

提示词与客户端 V1.1 的 OpenAICompatibleTextProvider 保持一致,迁移后客户端
不再接触 DeepSeek;模型名与密钥全部来自环境变量。
"""
import json
import logging
import time
from typing import Literal

import httpx
from pydantic import BaseModel, Field

from ..config import Settings
from ..errors import not_configured, provider_error
from .http_client import raise_for_upstream, timeout_guard
from .verification import LastCallRecord

logger = logging.getLogger(__name__)

FEEDBACK_SYSTEM = (
    "You are a concise IELTS speaking coach. Return JSON only. "
    "Never give an IELTS band score or pronunciation score. "
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


class FeedbackSummary(BaseModel):
    """一行问题 + 一行建议,必须使用中文。"""

    problem: str = Field(min_length=1, max_length=200)
    suggestion: str = Field(min_length=1, max_length=200)


class AnswerVersion(BaseModel):
    """一个可试听的回答版本。text 正常语速朗读约 15-20 秒。"""

    style: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=1_500)
    hint: str = Field(min_length=1, max_length=500)


class FirstAttemptFeedback(BaseModel):
    summary: FeedbackSummary
    versions: list[AnswerVersion] = Field(min_length=3, max_length=3)


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
        self.last_call = LastCallRecord()

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.deepseek_api_key)

    async def get_feedback(self, payload: dict) -> dict:
        user = json.dumps(
            {
                "task": "feedback-after-first-attempt",
                "requiredShape": {
                    "summary": {
                        "problem": "用中文写一行，只指出这次回答最值得改的一个问题",
                        "suggestion": "用中文写一行，给出针对这个问题的可执行建议",
                    },
                    "versions": [
                        {
                            "style": "简短的中文风格标签(如:基础稳妥/自然均衡/略加挑战)",
                            "text": "英文回答文本,严格控制在40-55个单词(正常语速朗读约15-20秒)",
                            "hint": "该版本的关键内容或关键句式提示(英文短语即可)",
                        }
                    ],
                },
                "rules": [
                    "给出恰好3个版本,风格和难度略有差异,但都要贴近用户当前水平,不要明显超出",
                    "每个版本的text必须严格控制在40-55个单词,正常语速朗读约15-20秒,不要更长",
                    "每个版本的text必须保持用户原有想法,只修正语言表达",
                    "如果用户原录音内容过短,在40-55个单词内适当补充;如果过长,简化为40-55个单词",
                    "hint只写关键内容或关键句式,方便用户第二次回答时参考",
                    "不要给IELTS分数或发音分数",
                ],
                "question": payload.get("question"),
                "transcript": payload.get("transcript"),
                "localMetrics": payload.get("metrics"),
            },
            ensure_ascii=False,
        )
        return await self._complete_validated(
            FEEDBACK_SYSTEM, user, FirstAttemptFeedback
        )

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

    async def verify(self) -> dict:
        """最小成本的显式验证:一次小规模补全,结果写入 last_call。

        deepseek-v4-flash 是推理模型,思考过程会先消耗 token,因此这里
        不能给 max_tokens=4(否则 content 为空);只要上游返回 200 且能解析
        出 choices[0].message 即视为验证通过。
        """
        if not self.is_configured:
            return self.last_call.snapshot()
        started = time.perf_counter()
        try:
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
                        "max_tokens": 32,
                        "messages": [
                            {
                                "role": "user",
                                "content": "Reply with the single word: OK",
                            }
                        ],
                    },
                )
            )
            await raise_for_upstream(response, "DeepSeek")
            data = response.json()
            message = data["choices"][0]["message"]
            content = str(message.get("content") or "").strip()
            reasoning = str(message.get("reasoning_content") or "").strip()
            self.last_call.record(
                ok=True,
                latency_ms=round((time.perf_counter() - started) * 1000),
                result=(content or reasoning or "(empty response, upstream 200)")[:120],
            )
        except Exception as exc:  # noqa: BLE001 - 验证结果必须落盘
            self.last_call.record(ok=False, message=str(exc))
        return self.last_call.snapshot()

    async def _complete_validated(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
    ) -> dict:
        if not self.is_configured:
            raise not_configured("DeepSeek(Text AI)")
        try:
            return await self._complete_checked(system, user, schema)
        except Exception as exc:  # noqa: BLE001 - 记录最近失败后按原样抛出
            self.last_call.record(ok=False, message=str(exc))
            raise

    async def _complete_checked(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
    ) -> dict:
        base = self._settings.deepseek_base_url.rstrip("/")
        started = time.perf_counter()
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
            result = schema.model_validate(parsed).model_dump(mode="json")
        except Exception:
            logger.warning("DeepSeek output failed schema validation")
            raise provider_error("Text AI 返回结构不完整,已保留本地结果。")
        self.last_call.record(
            ok=True,
            latency_ms=round((time.perf_counter() - started) * 1000),
        )
        return result

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
