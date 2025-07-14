from typing import List, Optional

from fastapi import FastAPI, HTTPException
from app.schemas import CompletionRequest, RetryRequest, CompletionResponse
from services.prompt_builder import make_prompt
from services.prompt_retry_builder import make_retry_prompt
from services.openai_client import chat_completion
from services.lean_verify import verify_lean_code

app = FastAPI()

# ── helpers ────────────────────────────────────────────────────────────────
def splice(src: str, snippet: str, line: int, col: int) -> str:
    lines = src.splitlines()
    if line >= len(lines):
        raise HTTPException(status_code=400, detail="Cursor line OOB")
    lines[line] = lines[line][:col] + snippet + lines[line][col:]
    return "\n".join(lines)


def strip_fences(txt: str) -> str:
    return txt.replace("```lean", "").replace("```", "").strip()


# ── /complete ──────────────────────────────────────────────────────────────
@app.post("/complete", response_model=CompletionResponse)
async def complete(req: CompletionRequest) -> CompletionResponse:
    # 0. Fast path – file already valid?  (F-3)
    ok, _ = await verify_lean_code(req.file_text)
    if ok:
        return CompletionResponse(ok=True, code=req.file_text, log="")

    # 1. ask LLM
    prompt_plain = make_prompt(req.file_text, req.cursor_line, req.cursor_col)
    msgs = [
        {
            "role": "system",
            "content": "You are an expert Lean4 assistant. "
            "Return ONLY Lean code that completes the proof.",
        },
        {"role": "user", "content": prompt_plain},
    ]
    snippet = strip_fences(await chat_completion(msgs, max_tokens=req.max_tokens))

    # 2. splice & validate
    candidate = splice(req.file_text, snippet, req.cursor_line, req.cursor_col)
    ok, log = await verify_lean_code(candidate)
    return CompletionResponse(ok=ok, code=candidate, log=log)


# ── /retry ─────────────────────────────────────────────────────────────────
@app.post("/retry", response_model=CompletionResponse)
async def retry(req: RetryRequest) -> CompletionResponse:
    msgs = make_retry_prompt(req.file_text, req.error_log, req.user_note)
    fixed = strip_fences(await chat_completion(msgs))
    ok, log = await verify_lean_code(fixed)
    return CompletionResponse(ok=ok, code=fixed, log=log)
