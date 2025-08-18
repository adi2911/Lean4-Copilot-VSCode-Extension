# backend/tests/test_langchain_pipeline.py
import asyncio
import types
from app.services import langchain_pipeline as lp

# Helper to run async funcs in sync tests
def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)

def test_suggest_returns_verified_candidate(monkeypatch):
    # Pretend LLMs returned 2 candidates
    fut = asyncio.get_event_loop().create_future()
    fut.set_result(["bad\n", "rfl\n"])  # [fast, smart]
    monkeypatch.setattr(lp, "_call_llms", lambda prompt: fut)

    # Verify only the cleaned "rfl\n" passes
    async def fake_verify(code):
        # pass only if it ends with "\nrfl\n" (i.e., appended)
        return (code.strip().endswith("rfl"), None if code.strip().endswith("rfl") else "err")
    monkeypatch.setattr(lp, "verify_lean_code", fake_verify)

    res = run(lp.SUGGEST_PIPELINE.ainvoke({"file_text":"theorem t : True := by\n", "line":0, "col":0}))
    assert res["suggestion"] in ("rfl\n", "rfl")  # trailing NL acceptable
    assert res["error"] is None

def test_suggest_fallback_when_all_fail(monkeypatch):
    fut = asyncio.Future(); fut.set_result(["simp [double]", "exact trivial"])  # both will "fail"
    monkeypatch.setattr(lp, "_call_llms", lambda prompt: fut)

    async def always_fail(_code): return (False, "lean err")
    monkeypatch.setattr(lp, "verify_lean_code", always_fail)

    res = run(lp.SUGGEST_PIPELINE.ainvoke({"file_text":"theorem t : True := by\n", "line":0, "col":0}))
    # We expect a fallback suggestion (first cleaned candidate) and an error message
    assert res["suggestion"] is not None
    assert isinstance(res["error"], str)

def test_complete_prefers_smart_then_fast(monkeypatch):
    # smart first candidate passes
    fut = asyncio.Future(); fut.set_result(["-- fast proof", "theorem t : True := by rfl"])
    monkeypatch.setattr(lp, "_call_llms", lambda prompt: fut)

    async def verify_ok(code): return (True, None)
    monkeypatch.setattr(lp, "verify_lean_code", verify_ok)

    out = run(lp.COMPLETE_PIPELINE.ainvoke({"file_text": "theorem t : True := by\n"}))
    assert out["ok"] is True
    assert "theorem t" in out["proof"]

def test_complete_both_fail_returns_log(monkeypatch):
    fut = asyncio.Future(); fut.set_result(["fast", "smart"])
    monkeypatch.setattr(lp, "_call_llms", lambda prompt: fut)

    async def verify_bad(_): return (False, "bad")
    monkeypatch.setattr(lp, "verify_lean_code", verify_bad)

    out = run(lp.COMPLETE_PIPELINE.ainvoke({"file_text": "theorem t : True := by\n"}))
    assert out["ok"] is False
    assert out["log"]
