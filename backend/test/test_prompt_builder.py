# backend/tests/test_prompt_builder.py
from app.services import prompt_builder as pb

def test_clean_suggestion_strips_fences_and_takes_first_line():
    raw = "```lean\nrfl\nsimp\n```"
    out = pb.clean_suggestion(raw)
    assert out == "rfl\n"

def test_clean_suggestion_drops_comment_only():
    raw = "-- just a comment"
    out = pb.clean_suggestion(raw)
    assert out == ""

def test_make_complete_proof_prompt_no_instruction():
    text = "theorem t : True := by\n"
    s = pb.make_complete_proof_prompt(file_text=text)
    # Must include file text, and either explicit (none) or no instruction block
    assert "theorem t" in s
    assert ("(none)" in s) or ("Additional guidance" not in s)

def test_make_complete_proof_prompt_with_instruction():
    text = "theorem t : True := by\n"
    s = pb.make_complete_proof_prompt(file_text=text, instruction="try rfl")
    assert "theorem t" in s
    # If template has {instruction_block}, it should appear
    assert ("try rfl" in s) or ("Additional guidance" not in s)
