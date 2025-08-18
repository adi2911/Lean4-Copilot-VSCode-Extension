# services/langchain_pipeline.py
from __future__ import annotations
import asyncio
from typing import Dict, List, Optional, Tuple

from dotenv import load_dotenv
load_dotenv()  # pick up OPENAI_API_KEY

from langchain_openai import ChatOpenAI
from langchain_core.runnables import RunnableLambda, RunnableParallel

from app.services.prompt_builder import (
    make_ghost_prompt, make_retry_prompt, make_complete_proof_prompt, clean_suggestion
)
from app.services.lean_verify import verify_lean_code

# ──────────────────────────────────────────────────────────────────────────────
# Models
# Keep these names stable so other files (or env switches) don't break.
# ──────────────────────────────────────────────────────────────────────────────
FAST_MODEL_NAME  ="gpt-4.1-2025-04-14" #"gpt-5-2025-08-07" #"gpt-4o-mini"  # cheap/fast
SMART_MODEL_NAME = "gpt-5-chat-latest" #"gpt-4o"      # higher quality

FAST_MODEL  = ChatOpenAI(model=FAST_MODEL_NAME,  temperature=0.2, max_tokens=128)
SMART_MODEL = ChatOpenAI(model=SMART_MODEL_NAME, temperature=0.2, max_tokens=256)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

async def _call_llms(prompt: str) -> List[str]:
    results = await asyncio.gather(
        FAST_MODEL.ainvoke(prompt),
        SMART_MODEL.ainvoke(prompt),
        return_exceptions=True,
    )
    outs: List[str] = []
    for r in results:
        if isinstance(r, Exception):
            outs.append("")
        else:
            outs.append((getattr(r, "content", "") or "").strip())
    return outs  # [
async def _first_valid_line(file_text: str, candidates: List[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    Given model candidates, return the first single-line suggestion that verifies with Lean.
    If none pass, return (None, last_error).
    """
    last_err: Optional[str] = None
    for raw in candidates:
        line = clean_suggestion(raw)
        if not line:
            continue
        ok, err = await verify_lean_code(file_text + line)
        if ok:
            return line, None
        last_err = _short_err(err)
    return None, last_err

def _short_err(err: Optional[str], limit: int = 1200) -> Optional[str]:
    if not err:
        return None
    e = err.strip()
    return (e if len(e) <= limit else e[:limit] + "\n…(truncated)…")

# ──────────────────────────────────────────────────────────────────────────────
# Core runners (used by endpoints)
# ──────────────────────────────────────────────────────────────────────────────

async def _run_suggest(inputs: Dict) -> Dict:
    file_text = inputs["file_text"]
    line = int(inputs["line"])
    col = int(inputs["col"])

    # Build a small, cursor-marked context
    snippet = _cursor_window(file_text, line, col)

    prompt = make_ghost_prompt(file_text=snippet, line=line, col=col)
    candidates = await _call_llms(prompt)
    ordered = [candidates[1], candidates[0]]  # prefer smart

    suggestion, err = await _first_valid_line(file_text, ordered)
    if suggestion:
        return {"suggestion": suggestion, "error": err}

    # Fallback: still surface the first cleaned candidate so user sees ghost text
    fallback_raw = next((c for c in ordered if c), "")
    fallback = clean_suggestion(fallback_raw)
    return {"suggestion": fallback if fallback else None, "error": err or "no verified candidate"}


async def _run_retry(inputs: Dict) -> Dict:
    """
    inputs: {
      file_text: str,
      previous_suggestion: str,
      error: str,
      instruction: Optional[str]
    }
    returns: { suggestion: Optional[str], error: Optional[str] }
    """
    file_text = inputs["file_text"]
    prev = inputs["previous_suggestion"]
    err = inputs["error"]
    instruction = inputs.get("instruction")

    prompt = make_retry_prompt(
        file_text=file_text,
        previous_suggestion=prev,
        error=err,
        instruction=instruction,
    )
    candidates = await _call_llms(prompt)
    ordered = [candidates[1], candidates[0]]
    suggestion, verr = await _first_valid_line(file_text, ordered)
    return {"suggestion": suggestion, "error": verr}

async def _run_complete(inputs: Dict) -> Dict:
    file_text = inputs["file_text"]
    instruction = inputs.get("instruction")

    # Build prompt (backward‑compatible with older signature)
    try:
        prompt = make_complete_proof_prompt(file_text=file_text, instruction=instruction)
    except TypeError:
        prompt = make_complete_proof_prompt(file_text=file_text)

    candidates = await _call_llms(prompt)

    # Prefer SMART then FAST (your existing ordering)
    ordered = [candidates[1], candidates[0]]

    last_error: Optional[str] = None
    attempt_text: Optional[str] = None  

    for raw in ordered:
        proof = (raw or "").strip()
        if not proof:
            continue

        # remember the first substantive attempt (shown in ErrorPanel)
        if attempt_text is None:
            attempt_text = proof

        ok, log = await verify_lean_code(proof)
        if ok:
            return {"proof": proof, "ok": True, "log": None}

        last_error = _short_err(log)

    # If both candidates failed, expose context for the UI
    # Fallback "attempt" if all candidates were empty
    if not attempt_text:
        attempt_text = (ordered[0] or "").strip() or (ordered[1] or "").strip()

    return {
        "ok": False,
        "proof": "",                             # keep shape stable
        "log": last_error or "Verification failed.",
        "attempt": attempt_text or "",
        "candidates": candidates,               # optional, helpful for debugging
    }


def _cursor_window(file_text: str, line: int, col: int, before: int = 30, after: int = 5) -> str:
    lines = file_text.splitlines()
    line = max(0, min(line, len(lines)))
    # insert <CURSOR> at position
    if line < len(lines):
        row = lines[line]
        col = max(0, min(col, len(row)))
        lines[line] = row[:col] + "<CURSOR>" + row[col:]
    else:
        lines.append("<CURSOR>")
    start = max(0, line - before)
    end = min(len(lines), line + after + 1)
    return "\n".join(lines[start:end])

# ──────────────────────────────────────────────────────────────────────────────
# Public pipelines (Runnable* so FastAPI can `.ainvoke({...})`)
# ──────────────────────────────────────────────────────────────────────────────

SUGGEST_PIPELINE = RunnableLambda(_run_suggest)
RETRY_PIPELINE   = RunnableLambda(_run_retry)
COMPLETE_PIPELINE = RunnableLambda(_run_complete)

__all__ = [
    "FAST_MODEL",
    "SMART_MODEL",
    "SUGGEST_PIPELINE",
    "RETRY_PIPELINE",
    "COMPLETE_PIPELINE",
]
