"""Text feedback 的服务端内容策略校验。"""
import re
from collections.abc import Iterable

EXPECTED_REFERENCE_LABELS = (
    "简单自然版",
    "自然提升版",
    "另一种表达版",
)

_RATING_PATTERN = re.compile(
    r"(?ix)"
    r"(?:\bIELTS\s+band\b)"
    r"|(?:\bband\s+score\b)"
    r"|(?:\bband\s*[:：]?\s*[0-9](?:\.[0-9])?\b)"
    r"|(?:\bIELTS\s+score\b)"
    r"|(?:雅思.{0,8}(?:分数|评分|得分|等级|分数段))"
    r"|(?:水平(?:评分|评级))"
)
_VOICE_PATTERN = re.compile(
    r"(?ix)"
    r"(?:\bpronunciation\b)"
    r"|(?:\bspeech\s+rate\b)"
    r"|(?:\bspeaking\s+rate\b)"
    r"|(?:\bintonation\b)"
    r"|(?:\bpauses?\b)"
    r"|(?:发音|语速|语调|停顿|重音|音准|语音表现|声音表现)"
)

_COACHING_FIELDS = (
    "summary",
    "strengths",
    "problems",
    "grammarSuggestions",
    "vocabularySuggestions",
)


def _strings(value: object) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)


def validate_feedback_policy(feedback: dict) -> None:
    references = feedback.get("referenceAnswers")
    if not isinstance(references, list) or len(references) != 3:
        raise ValueError("referenceAnswers 必须恰好有 3 个版本")
    labels = tuple(
        item.get("label") if isinstance(item, dict) else None
        for item in references
    )
    if labels != EXPECTED_REFERENCE_LABELS:
        raise ValueError("referenceAnswers label 或顺序不符合协议")

    # 评分禁令覆盖完整输出；语音表现词只检查导师评论，避免用户题材本身
    # 恰好谈到乐队、口音等内容时误伤参考答案。
    all_text = "\n".join(_strings(feedback))
    if _RATING_PATTERN.search(all_text):
        raise ValueError("反馈包含被禁止的 Band/评分内容")

    coaching_text = "\n".join(
        text
        for field in _COACHING_FIELDS
        for text in _strings(feedback.get(field))
    )
    if _VOICE_PATTERN.search(coaching_text):
        raise ValueError("反馈包含被禁止的语音表现评价")
