"""DeepSeekService:雅思口语答案的纯文本分析。

V1.7 起 DeepSeek 只接收 Part、题目、用户答案文本与可选作答时间,
只分析语法、词汇、连贯性、表达自然度、是否切题与内容展开。
绝不评价发音、语速、停顿、语调,也绝不给出 IELTS Band 分数或水平评分。
"""
import json
import logging
import time
from typing import Literal

import httpx
from pydantic import BaseModel, Field, ValidationError

from ..config import Settings
from ..errors import BackendError, not_configured, provider_error
from .http_client import raise_for_upstream, timeout_guard
from .feedback_policy import (
    validate_feedback_policy,
    validate_second_attempt_policy,
)
from .ielts_speaking_skill import IELTS_SPEAKING_SKILL
from .verification import LastCallRecord, ProviderCallRecords

logger = logging.getLogger(__name__)

FEEDBACK_SYSTEM = IELTS_SPEAKING_SKILL

ORGANIZE_SYSTEM = (
    "Extract IELTS Speaking questions from the supplied private material. "
    "Return JSON only. Do not generate answers. "
    "Keep original questions when present; when the material is prose, "
    "create only concise speaking questions grounded in it. "
    "Part 2 needs 2 to 5 cue points. Return at most 50 questions."
)

MATERIAL_SUGGEST_SYSTEM = (
    "You are an IELTS Speaking coach helping a learner build a personal "
    "story bank (what to talk about). Based only on the learner's own "
    "practice digest and saved expressions, suggest personal material "
    "drafts they could confirm and reuse later. Return JSON only, write "
    "content in Chinese, first person. "
    "Ground every suggestion in topics/facts that already appear in the "
    "digest; generalize themes, but never invent specific people, places "
    "or events the learner did not mention. Never repeat suggestions whose "
    "topic is already covered by existingTitles. Each content is at most "
    "300 Chinese characters and reads like warm coaching notes, not an "
    "essay."
)

SECOND_ATTEMPT_SYSTEM = (
    "You are an IELTS Speaking tutor reviewing a learner's second text answer. "
    "Return JSON only. Apply simple optimization only: report complete corrected "
    "sentences with real grammar, collocation or clear naturalness errors, and "
    "extract explicit personal facts for the learner to confirm as Memory. Do not "
    "use RAG, previous answers, existing Memory or personal materials. Never invent "
    "facts, scores or speech-performance claims."
)

MAX_MATERIAL_DIGEST_CHARACTERS = 4_000

MAX_AI_IMPORT_CHARACTERS = 60_000

DEEPSEEK_MAX_TOKENS = 4_096

FAILED_FINISH_REASONS = {
    "length",
    "content_filter",
    "insufficient_system_resource",
}

DeepSeekFailureStage = Literal[
    "upstream-http",
    "response-envelope",
    "json-parse",
    "pydantic-fields",
    "content-policy",
]


class DeepSeekFailure(Exception):
    """内部安全失败摘要,不携带上游正文或异常 repr。"""

    def __init__(
        self,
        stage: DeepSeekFailureStage,
        message: str,
        *,
        finish_reason: str | None = None,
        content_length: int = 0,
        usage: dict[str, int] | None = None,
        field_path: str | None = None,
        http_status: int | None = None,
        backend_error: BackendError | None = None,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.public_message = message
        self.finish_reason = finish_reason
        self.content_length = content_length
        self.usage = usage
        self.field_path = field_path
        self.http_status = http_status
        self.backend_error = backend_error


class ReferenceAnswer(BaseModel):
    """一个自然口语化的参考回答版本。"""

    label: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=1_500)


class NaturalUpgradeSuggestion(BaseModel):
    content: str = Field(min_length=1, max_length=500)
    source: Literal["memory", "personal_material", "rag", "ai_example"]
    sourcePart: Literal[1, 2, 3, "unclassified"] | None
    replaceable: bool


class NaturalUpgradeSuggestions(BaseModel):
    addableContent: list[NaturalUpgradeSuggestion] = Field(max_length=4)
    advancedChanges: list[str] = Field(max_length=3)


class AnswerFrameworkItem(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    template: str = Field(min_length=1, max_length=320)


class TextFeedback(BaseModel):
    """客户端与服务端共同约定的结构化反馈,不包含任何评分字段。"""

    summary: str = Field(min_length=1, max_length=500)
    strengths: list[str] = Field(default_factory=list, max_length=2)
    problems: list[str] = Field(min_length=2, max_length=2)
    grammarSuggestions: list[str] = Field(default_factory=list, max_length=2)
    vocabularySuggestions: list[str] = Field(default_factory=list, max_length=2)
    referenceAnswers: list[ReferenceAnswer] = Field(min_length=2, max_length=2)
    naturalUpgradeSuggestions: NaturalUpgradeSuggestions
    answerFramework: list[AnswerFrameworkItem] = Field(max_length=6)


class CorrectedSentence(BaseModel):
    original: str = Field(min_length=1, max_length=1_000)
    corrected: str = Field(min_length=1, max_length=1_000)
    reason: str = Field(min_length=1, max_length=320)


class MemoryCandidate(BaseModel):
    content: str = Field(min_length=1, max_length=320)
    kind: Literal["person", "place", "experience", "preference", "opinion", "other"]
    topicTags: list[str] = Field(max_length=12)
    sourceSentence: str = Field(min_length=1, max_length=500)
    sourcePart: Literal[1, 2, 3]


class SecondAttemptFeedback(BaseModel):
    correctedSentences: list[CorrectedSentence] = Field(max_length=10)
    memoryCandidates: list[MemoryCandidate] = Field(max_length=10)


class ImportQuestion(BaseModel):
    part: Literal[1, 2, 3]
    topic: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=500)
    cuePoints: list[str] = Field(default_factory=list, max_length=5)
    sourcePage: int | None = None


class ImportQuestionList(BaseModel):
    questions: list[ImportQuestion] = Field(min_length=1, max_length=50)


class MaterialSuggestionItem(BaseModel):
    """一条候选个人素材;客户端确认后才写入素材库。"""

    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=800)
    kind: Literal["person", "place", "experience", "object", "opinion"]
    topicTags: list[str] = Field(default_factory=list, max_length=6)
    sourcePart: Literal[1, 2, 3] | None = None


class MaterialSuggestionList(BaseModel):
    suggestions: list[MaterialSuggestionItem] = Field(min_length=1, max_length=6)


class DeepSeekService:
    def __init__(self, client: httpx.AsyncClient, settings: Settings) -> None:
        self._client = client
        self._settings = settings
        self.calls = ProviderCallRecords()

    @property
    def is_configured(self) -> bool:
        return bool(self._settings.deepseek_api_key)

    async def get_feedback(self, payload: dict) -> dict:
        user = json.dumps(
            {
                "task": "analyze-ielts-speaking-answer-text",
                "requiredShape": {
                    "summary": "用中文写的最多两句话的整体小结,先肯定再指出最值得改的重点",
                    "strengths": [
                        "用中文写 0-2 条做得好的地方,不要硬凑"
                    ],
                    "problems": [
                        "用中文写恰好 2 条最优先的问题,按重要性排序,"
                        "每条先给动作再给例子,一句话讲完"
                    ],
                    "grammarSuggestions": [
                        "用中文写 0-2 条具体、可执行的语法建议,一条一个动作"
                    ],
                    "vocabularySuggestions": [
                        "用中文写 0-2 条贴合用户水平的词汇建议,一条一个替换"
                    ],
                    "referenceAnswers": [
                        {
                            "label": "简单优化版",
                            "text": "只修正用户原回答,不增加新事实",
                        },
                        {
                            "label": "自然提升版",
                            "text": "结合适用的 Memory、个人素材、RAG 和可替换示例",
                        }
                    ],
                    "naturalUpgradeSuggestions": {
                        "addableContent": [
                            {
                                "content": "可添加的理由、例子或细节",
                                "source": "memory | personal_material | rag | ai_example",
                                "sourcePart": "来源 Part 或 unclassified/null",
                                "replaceable": True,
                            }
                        ],
                        "advancedChanges": ["结构或自然表达建议"],
                    },
                    "answerFramework": [
                        {"label": "中文提示", "template": "从两个参考版本提炼的英文句子开头和可替换槽位,例如 My hometown is [city]."}
                    ],
                },
                "analysisDimensions": [
                    "grammar",
                    "vocabulary",
                    "coherence",
                    "naturalness of expression",
                    "task relevance",
                    "content development",
                ],
                "rules": [
                    "referenceAnswers 必须恰好 2 个,label 固定依次为:"
                    "简单优化版、自然提升版",
                    "简单优化版:只修正用户原回答,不增加新事实",
                    "自然提升版:优先使用适用的 Memory,其次使用匹配个人素材和 RAG,"
                    "必要时可补充少量明确标记为可替换的 AI 示例",
                    "两个版本都必须像真实口语,不要写成作文或背诵范文",
                    "优先指出最重要的问题,不要一次纠完所有小错",
                    "修改表达时保持用户原本水平和表达习惯",
                    "Part 1 重点是直接回答加一个理由或细节",
                    "Part 2 按 cue points 和简单故事时间线展开,不要输出固定全文",
                    "Part 3 使用观点、原因、例子,需要时补结果或比较",
                    "summary 不超过 2 句,problems 必须恰好 2 条",
                    "grammarSuggestions 和 vocabularySuggestions 各最多 2 条",
                    "不要评价发音、语速、停顿、语调或任何语音表现",
                    "不要给出 IELTS Band 分数、分数段或任何水平评分",
                ],
                "part": payload.get("part"),
                "question": payload.get("question"),
                "answer": payload.get("answer"),
                "answerDurationSeconds": payload.get("answerDurationSeconds"),
                "tutorContext": payload.get("tutorContext") or "",
                "learnerContext": payload.get("learnerContext") or "",
                "contextRules": [
                    "tutorContext 是 IELTS 教学原则,优先按其重点给建议,"
                    "并按当前 Part 和题型主动应用,但不要长篇复述这些原则",
                    "learnerContext 是统一的个性化 Memory 大脑,其中包含带来源 Part 的"
                    "候选记忆、个人语料和个人素材;当前 Part 和当前主题优先,"
                    "其他 Part 只有在明确相关、不冲突且不偏题时才可使用",
                    "匹配到的个人素材如果确实适合自然提升版,应自然加入;不适合则忽略",
                    "当前题目和用户原回答始终优先;简单优化版不得用上下文新增事实",
                    "自然提升版可以添加少量 AI 示例,但必须在 addableContent 中标记为可替换",
                    "answerFramework 必须基于两个参考版本的共同结构提炼,只写可练习的句子开头和槽位,不要复制完整答案",
                    "若没有上下文,就按题目和答案正常分析",
                    "answerDurationSeconds 仅是可选计时上下文,不得据此评价语速",
                    "永远不要评价 pronunciation、speech rate、pauses、"
                    "intonation 或任何语音表现",
                    "永远不要给 IELTS Band 分数、分数段或水平评分",
                ],
            },
            ensure_ascii=False,
        )
        return await self._complete_validated(FEEDBACK_SYSTEM, user, TextFeedback)

    async def get_second_attempt_feedback(self, payload: dict) -> dict:
        user = json.dumps(
            {
                "task": "review-ielts-speaking-second-attempt",
                "requiredShape": {
                    "correctedSentences": [
                        {
                            "original": "用户确实出错的完整原句",
                            "corrected": "按简单优化标准修正后的完整句子",
                            "reason": "简短中文说明",
                        }
                    ],
                    "memoryCandidates": [
                        {
                            "content": "用户明确说出的个人事实或观点",
                            "kind": "person | place | experience | preference | opinion | other",
                            "topicTags": ["简短标签"],
                            "sourceSentence": "对应英文原句",
                            "sourcePart": "当前 Part",
                        }
                    ],
                },
                "rules": [
                    "只返回确实有语法、搭配、用词或明显不自然问题的完整句子",
                    "正确但可以更高级的句子不要返回",
                    "如果没有明确错误,correctedSentences 返回空数组",
                    "不得使用 RAG、第一次回答、参考答案、已有 Memory 或个人素材",
                    "memoryCandidates 只能提取答案中明确出现的真实个人信息",
                    "不得推测或虚构事实,不得把模板内容当作 Memory",
                    "所有 Memory 候选必须由用户确认后才能保存",
                    "不得评价发音、语速、停顿、语调或给出任何分数",
                ],
                "part": payload.get("part"),
                "question": payload.get("question"),
                "answer": payload.get("answer"),
            },
            ensure_ascii=False,
        )
        return await self._complete_validated(
            SECOND_ATTEMPT_SYSTEM, user, SecondAttemptFeedback
        )

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

    async def suggest_materials(
        self,
        memoryDigest: str,
        existingTitles: list[str],
        maxCount: int = 4,
        targetPart: int | None = None,
    ) -> list[dict]:
        max_count = max(1, min(6, maxCount))
        user = json.dumps(
            {
                "task": "suggest-personal-material-drafts",
                "requiredShape": {
                    "suggestions": [
                        {
                            "title": "简短中文标题,≤40字",
                            "content": (
                                "中文第一人称的素材草稿或写作提示,"
                                "只基于 digest 中已有的事实与主题"
                            ),
                            "kind": "person | place | experience | object | opinion",
                            "topicTags": ["1-4 个简短标签"],
                        }
                    ]
                },
                "rules": [
                    f"返回 1 到 {max_count} 条建议,按与常练话题的相关度排序",
                    "只能归纳/泛化 digest 中已有的主题,不得虚构具体人物、地点或事件细节",
                    "不要重复 existingTitles 已覆盖的话题",
                    "content 像教练写的便签,引导用户补全自己的真实细节",
                    "优先整理 targetPart 的信息;其他 Part 只有明确相关时才可使用",
                ],
                "targetPart": targetPart,
                "memoryDigest": memoryDigest[:MAX_MATERIAL_DIGEST_CHARACTERS],
                "existingTitles": existingTitles[:50],
            },
            ensure_ascii=False,
        )
        result = await self._complete_validated(
            MATERIAL_SUGGEST_SYSTEM, user, MaterialSuggestionList
        )
        return result["suggestions"]

    async def verify(self) -> dict:
        """用与结构化反馈相同的 JSON 模式和额度验证 DeepSeek。"""
        if not self.is_configured:
            return self.calls.verification.snapshot()
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
                        "thinking": {"type": "disabled"},
                        "response_format": {"type": "json_object"},
                        "max_tokens": DEEPSEEK_MAX_TOKENS,
                        "messages": [
                            {
                                "role": "system",
                                "content": "Return JSON only.",
                            },
                            {
                                "role": "user",
                                "content": '{"task":"health-check","requiredShape":{"ok":true}}',
                            },
                        ],
                    },
                )
            )
            try:
                await raise_for_upstream(response, "DeepSeek")
            except BackendError as exc:
                raise DeepSeekFailure(
                    "upstream-http",
                    exc.message,
                    http_status=response.status_code,
                    backend_error=exc,
                ) from exc
            content, finish_reason, usage = self._read_completion(response)
            self.calls.verification.record(
                ok=True,
                latency_ms=round((time.perf_counter() - started) * 1000),
                result="content received",
                finish_reason=finish_reason,
                content_length=len(content),
                usage=usage,
            )
        except DeepSeekFailure as exc:
            self._record_failure(self.calls.verification, started, exc)
        except BackendError as exc:
            failure = DeepSeekFailure("upstream-http", exc.message, backend_error=exc)
            self._record_failure(self.calls.verification, started, failure)
        except Exception as exc:  # noqa: BLE001 - 验证结果必须落盘
            failure = DeepSeekFailure(
                "response-envelope",
                "DeepSeek 验证响应无法识别。",
                field_path=type(exc).__name__,
            )
            self._record_failure(self.calls.verification, started, failure)
        return self.calls.verification.snapshot()

    async def _complete_validated(
        self,
        system: str,
        user: str,
        schema: type[BaseModel],
    ) -> dict:
        if not self.is_configured:
            raise not_configured("DeepSeek(Text AI)")
        started = time.perf_counter()
        try:
            return await self._complete_checked(system, user, schema)
        except DeepSeekFailure as exc:
            self._record_failure(self.calls.request, started, exc)
            if exc.backend_error is not None:
                raise exc.backend_error from exc
            raise provider_error(exc.public_message) from exc
        except BackendError as exc:
            failure = DeepSeekFailure("upstream-http", exc.message, backend_error=exc)
            self._record_failure(self.calls.request, started, failure)
            raise
        except Exception as exc:  # noqa: BLE001 - 记录最近失败后按安全摘要抛出
            failure = DeepSeekFailure(
                "response-envelope",
                "DeepSeek 请求处理失败,已保留本地结果。",
                field_path=type(exc).__name__,
            )
            self._record_failure(self.calls.request, started, failure)
            raise provider_error(failure.public_message) from exc

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
                    "thinking": {"type": "disabled"},
                    "response_format": {"type": "json_object"},
                    "max_tokens": DEEPSEEK_MAX_TOKENS,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                },
            )
        )
        try:
            await raise_for_upstream(response, "DeepSeek")
        except BackendError as exc:
            raise DeepSeekFailure(
                "upstream-http",
                exc.message,
                http_status=response.status_code,
                backend_error=exc,
            ) from exc

        content, finish_reason, usage = self._read_completion(response)
        try:
            parsed = self._parse_json_content(content)
        except (TypeError, ValueError) as exc:
            raise DeepSeekFailure(
                "json-parse",
                "Text AI 返回的 JSON 无效,已保留本地结果。",
                finish_reason=finish_reason,
                content_length=len(content),
                usage=usage,
                field_path="message.content",
            ) from exc
        try:
            validated = schema.model_validate(parsed)
            result = validated.model_dump(mode="json")
        except ValidationError as exc:
            raise DeepSeekFailure(
                "pydantic-fields",
                "Text AI 返回字段校验失败,已保留本地结果。",
                finish_reason=finish_reason,
                content_length=len(content),
                usage=usage,
                field_path=_validation_field_path(exc),
            ) from exc
        try:
            if schema is TextFeedback:
                validate_feedback_policy(result)
            elif schema is SecondAttemptFeedback:
                validate_second_attempt_policy(result)
        except ValueError as exc:
            raise DeepSeekFailure(
                "content-policy",
                "Text AI 返回内容不符合应用约束,已保留本地结果。",
                finish_reason=finish_reason,
                content_length=len(content),
                usage=usage,
                field_path="policy",
            ) from exc
        self.calls.request.record(
            ok=True,
            latency_ms=round((time.perf_counter() - started) * 1000),
            result="validated content",
            finish_reason=finish_reason,
            content_length=len(content),
            usage=usage,
        )
        return result

    @staticmethod
    def _read_completion(
        response: httpx.Response,
    ) -> tuple[str, str, dict[str, int] | None]:
        try:
            data = response.json()
        except (TypeError, ValueError) as exc:
            raise DeepSeekFailure(
                "response-envelope",
                "DeepSeek 返回的响应 envelope 不是有效 JSON。",
                field_path="$",
            ) from exc
        if not isinstance(data, dict):
            raise DeepSeekFailure(
                "response-envelope",
                "DeepSeek 返回的响应 envelope 无法识别。",
                field_path="$",
            )
        usage = _summarize_usage(data.get("usage"))
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise DeepSeekFailure(
                "response-envelope",
                "DeepSeek 返回的响应 envelope 缺少 choices[0]。",
                usage=usage,
                field_path="choices[0]",
            )
        choice = choices[0]
        if not isinstance(choice, dict):
            raise DeepSeekFailure(
                "response-envelope",
                "DeepSeek 返回的响应 envelope 缺少 choices[0]。",
                usage=usage,
                field_path="choices[0]",
            )
        finish_reason = choice.get("finish_reason")
        safe_finish_reason = (
            finish_reason[:64]
            if isinstance(finish_reason, str) and finish_reason
            else "missing"
        )
        if finish_reason != "stop":
            reason_message = (
                "DeepSeek 返回结果未完整结束"
                if safe_finish_reason in FAILED_FINISH_REASONS
                else "DeepSeek 返回结果未以成功状态结束"
            )
            raise DeepSeekFailure(
                "response-envelope",
                f"{reason_message}（finish_reason={safe_finish_reason}）,已保留本地结果。",
                finish_reason=safe_finish_reason,
                usage=usage,
                field_path="choices[0].finish_reason",
            )
        message = choice.get("message")
        if not isinstance(message, dict):
            raise DeepSeekFailure(
                "response-envelope",
                "DeepSeek 返回的响应 envelope 缺少 choices[0].message。",
                finish_reason=safe_finish_reason,
                usage=usage,
                field_path="choices[0].message",
            )
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise DeepSeekFailure(
                "response-envelope",
                "DeepSeek 返回内容为空。",
                finish_reason=safe_finish_reason,
                content_length=len(content) if isinstance(content, str) else 0,
                usage=usage,
                field_path="choices[0].message.content",
            )
        return content.strip(), safe_finish_reason, usage

    def _record_failure(
        self,
        record: LastCallRecord,
        started: float,
        failure: DeepSeekFailure,
    ) -> None:
        logger.warning(
            "DeepSeek request failed stage=%s model=%s http_status=%s "
            "finish_reason=%s content_length=%s usage=%s field_path=%s",
            failure.stage,
            self._settings.deepseek_model,
            failure.http_status if failure.http_status is not None else "-",
            failure.finish_reason or "-",
            failure.content_length,
            failure.usage or "-",
            failure.field_path or "-",
        )
        record.record(
            ok=False,
            latency_ms=round((time.perf_counter() - started) * 1000),
            message=failure.public_message,
            failure_stage=failure.stage,
            finish_reason=failure.finish_reason,
            content_length=failure.content_length,
            usage=failure.usage,
            field_path=failure.field_path,
        )

    @staticmethod
    def _parse_json_content(content: str) -> object:
        text = content.strip()
        if text.startswith("```"):
            text = text.removeprefix("```json").removeprefix("```")
            text = text.removesuffix("```").strip()
        try:
            return json.loads(text)
        except ValueError:
            raise ValueError("invalid JSON content")


def _summarize_usage(value: object) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    keys = (
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "prompt_cache_hit_tokens",
        "prompt_cache_miss_tokens",
    )
    summary = {
        key: item
        for key in keys
        if isinstance(item := value.get(key), int) and not isinstance(item, bool)
    }
    return summary or None


def _validation_field_path(error: ValidationError) -> str:
    errors = error.errors(include_url=False)
    if not errors:
        return "$"
    location = errors[0].get("loc", ())
    return ".".join(str(part) for part in location) or "$"
