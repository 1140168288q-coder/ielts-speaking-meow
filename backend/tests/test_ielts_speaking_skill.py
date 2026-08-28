from app.services.ielts_speaking_skill import (
    IELTS_SPEAKING_SKILL,
    IELTS_SPEAKING_SKILL_VERSION,
)


def test_ielts_speaking_skill_is_rules_only_and_part_aware():
    assert IELTS_SPEAKING_SKILL_VERSION == "2026.08-v1"
    assert "Part 1" in IELTS_SPEAKING_SKILL
    assert "Part 2" in IELTS_SPEAKING_SKILL
    assert "Part 3" in IELTS_SPEAKING_SKILL
    assert "tutorContext" in IELTS_SPEAKING_SKILL
    assert "learnerContext" in IELTS_SPEAKING_SKILL
    assert "referenceAnswers" in IELTS_SPEAKING_SKILL
    assert "Do not give an IELTS Band score" in IELTS_SPEAKING_SKILL
    assert "雅思口语备考知识库_流利优先" not in IELTS_SPEAKING_SKILL
