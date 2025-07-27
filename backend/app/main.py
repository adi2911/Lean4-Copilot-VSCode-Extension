# backend/app/main.py
from __future__ import annotations

import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

# ── local modules ─────────────────────────────────────────────────────────────
from app.schemas import (
    CompletionRequest,
    CompletionResponse,
    RetryRequest,
    ValidationRequest,
    ValidationResponse,
)
from services.prompt_retry_builder import make_retry_prompt, resilient_invoke  # retry logic
from services.lean_verify import verify_lean_code                     # ↔ lean --run

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI()


# ------------------------------------------------------------------------------
#  /complete  ── ghost-text / “Complete proof” entry point
# ------------------------------------------------------------------------------
@app.post("/complete", response_model=CompletionResponse)
async def complete(req: CompletionRequest):
    """
    1. Build the vars dict the pipeline expects.
    2. Ask the LLM(s) for a suggestion (resilient_invoke includes retries).
    3. Stream the answer with the sentinel `[[END]]` the front-end splits on.
    """
    vars_ = {
        "file_text": req.file_text,
        "line": req.cursor_line,
        "col": req.cursor_col,
    }

    print(f">>>>> triggered suggestion building")

    # resilient_invoke already wraps generate_suggestion with tenacity.
    suggestion: str = await resilient_invoke(vars_)

    print(f">>>>>> Receieved suggestion at the endpoint ,method : {suggestion}")

    async def stream():
        yield suggestion
        yield "\n[[END]]"

    # VS Code extension consumes plain-text chunks
    return StreamingResponse(stream(), media_type="text/plain")



@app.post("/validate", response_model=ValidationResponse)
async def validate(req: ValidationRequest):
    print(">>> validate endpoint is call to verify lean code")
    ok, err = await verify_lean_code(req.file_text)
    # `err` is raw stderr bytes from `lake exe lean …` (may be None)
    return {"ok": ok, "log": err.decode() if err else None}


# ------------------------------------------------------------------------------
#  /retry  ── user clicked “Retry” (or supplied a note) after a failed proof
# ------------------------------------------------------------------------------
@app.post("/retry", response_model=CompletionResponse)
async def retry(req: RetryRequest):
    """
    Build a specialised prompt that shows:
      • the current file,
      • the Lean error log,
      • the user’s note (optional).
    The LLM returns a *replacement* fragment; we re-validate it.
    """
    messages = make_retry_prompt(
        file_text=req.file_text,
        error_log=req.error_log,
        user_note=req.user_note or "",
    )

    # Direct OpenAI chat call wrapped in helper; returns *raw* code block(s)
    from openai_client import chat_completion, strip_fences

    raw_fix = await chat_completion(messages)
    fix = strip_fences(raw_fix)

    ok, err = await verify_lean_code(fix)

    return {
        "completion": fix,
        "ok": ok,
        "log": err.decode() if err else None,
    }


# ------------------------------------------------------------------------------
#  Ready!
# ------------------------------------------------------------------------------
@app.get("/")
async def root():
    return {"status": "lean-copilot backend up ✨"}
