from app.services.deepseek_service import _generation_profile


def test_generation_profile_is_server_owned_and_part_aware():
    simple = _generation_profile("simple", "british", 1)
    challenging = _generation_profile("challenging", "american", 3)
    part_two = _generation_profile("medium", "british", 2)

    assert simple["level"] == "simple"
    assert simple["style"] == "british"
    assert simple["lengthBudget"]["targetSeconds"] == 15
    assert challenging["style"] == "american"
    assert challenging["lengthBudget"]["maxWords"] == 78
    assert part_two["lengthBudget"]["minWords"] == 150
    assert "profileInstruction" in challenging
