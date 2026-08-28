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
from pydantic import BaseModel, Field

from ..config import Settings
from ..errors import not_configured, provider_error
from .http_client import raise_for_upstream, timeout_guard
from .feedback_policy import validate_feedback_policy
from .ielts_speaking_skill import IELTS_SPEAKING_SKILL
from .verification import LastCallRecord

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

MAX_MATERIAL_DIGEST_CHARACTERS = 4_000

MAX_AI_IMPORT_CHARACTERS = 60_000


class ReferenceAnswer(BaseModel):
    """一个自然口语化的参考回答版本。"""

    label: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=1_500)


class TextFeedback(BaseModel):
    """客户端与服务端共同约定的结构化反馈,不包含任何评分字段。"""

    summary: str = Field(min_length=1, max_length=500)
    strengths: list[str] = Field(default_factory=list, max_length=2)
    problems: list[str] = Field(min_length=2, max_length=2)
    grammarSuggestions: list[str] = Field(default_factory=list, max_length=2)
    vocabularySuggestions: list[str] = Field(default_factory=list, max_length=2)
    improvedAnswer: str = Field(min_length=1, max_length=1_500)
    referenceAnswers: list[ReferenceAnswer] = Field(min_length=3, max_length=3)


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


class MaterialSuggestionList(BaseModel):
    suggestions: list[MaterialSuggestionItem] = Field(min_length=1, max_length=6)


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
                    "improvedAnswer": (
                        "保持用户原本想法、水平和表达习惯的优化版英文回答,"
                        "不要突然变成明显难以模仿的高级英语"
                    ),
                    "referenceAnswers": [
                        {
                            "label": (
                                "固定使用:简单自然版 / 自然提升版 / 另一种表达版"
                            ),
                            "text": "自然口语化的英文参考回答,不是作文或背诵范文",
                        }
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
                    "referenceAnswers 必须恰好 3 个,label 固定依次为:"
                    "简单自然版、自然提升版、另一种表达版",
                    "简单自然版:最接近用户原回答,用户最容易直接模仿",
                    "自然提升版:词汇和句型稍有提升,作为主要推荐版本",
                    "另一种表达版:换一种思路或口语风格,但难度不要明显高于用户当前水平",
                    "三个版本都必须像真实口语,不要写成作文或背诵范文",
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
                    "learnerContext 是学习者的长期记忆聚合(练过次数、"
                    "近期重点、其本人可复用素材);如果其中素材适合本题,"
                    "改进版和参考回答可主动、自然地沿用一到两处素材原句或短语,"
                    "但不要生硬粘贴,也不要把素材当作范文整段背诵",
                    "当前题目和用户原回答始终优先;不得用上下文替用户虚构事实",
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
                ],
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
            validated = schema.model_validate(parsed)
            result = validated.model_dump(mode="json")
            if schema is TextFeedback:
                validate_feedback_policy(result)
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
