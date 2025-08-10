# backend/app/main.py (or main.py at repo root)
from __future__ import annotations

import logging
from typing import Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# ── Resilient imports (works for both flat and package layouts) ───────────────
try:
    # typical layout: backend/app/services/*
    from services.langchain_pipeline import (
        SUGGEST_PIPELINE,
        RETRY_PIPELINE,
        COMPLETE_PIPELINE,
    )
    from services.lean_verify import verify_lean_code
except Exception:
    # fallback if services/ is sibling to this file
    from langchain_pipeline import (
        SUGGEST_PIPELINE,
        RETRY_PIPELINE,
        COMPLETE_PIPELINE,
    )  # type: ignore
    from lean_verify import verify_lean_code  # type: ignore

try:
    from . import schemas  # if this file is part of a package
except Exception:
    import schemas  # type: ignore

# ── App & CORS ────────────────────────────────────────────────────────────────
app = FastAPI(title="Lean4 Copilot Backend", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],         # tighten to your extension origin if you prefer
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

log = logging.getLogger("uvicorn.error")

# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"ok": True, "service": "lean4-copilot", "version": app.version}


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/suggest", response_model=schemas.SuggestResponse)
async def suggest(req: schemas.SuggestRequest):
    """
    Single-line ghost suggestion at (cursor_line, cursor_col).
    Returns: {suggestion?: str, error?: str}
    """
    try:
        payload: Dict = {
            "file_text": req.file_text,
            "line": req.cursor_line,
            "col": req.cursor_col,
        }
        res = await SUGGEST_PIPELINE.ainvoke(payload)
        return schemas.SuggestResponse(**res)
    except Exception as e:
        # keep stack in server logs, send concise message to client
        log.exception("Error in /suggest")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/retry", response_model=schemas.RetryResponse)
async def retry(req: schemas.RetryRequest):
    """
    Retry a failed single-line suggestion using Lean error (and optional instruction).
    Returns: {suggestion?: str, error?: str}
    """
    try:
        payload: Dict = {
            "file_text": req.file_text,
            "previous_suggestion": req.previous_suggestion,
            "error": req.error,
            "instruction": req.instruction,
        }
        res = await RETRY_PIPELINE.ainvoke(payload)
        return schemas.RetryResponse(**res)
    except Exception as e:
        log.exception("Error in /retry")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/complete", response_model=schemas.CompleteResponse)
async def complete(req: schemas.CompleteRequest):
    try:
        res = await COMPLETE_PIPELINE.ainvoke({
            "file_text": req.file_text,
            "instruction": req.instruction,   # keep this
        })
        return schemas.CompleteResponse(**res)
    except Exception as e:                    # ← ensure "as e"
        log.exception("Error in /complete")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/validate", response_model=schemas.ValidateResponse)
async def validate(req: schemas.ValidateRequest):
    """
    Type-check the provided Lean code via CLI.
    Returns: {ok: bool, error?: str}
    """
    try:
        ok, err = await verify_lean_code(req.file_text)
        return schemas.ValidateResponse(ok=ok, error=None if ok else (err or ""))
    except Exception as e:
        log.exception("Error in /validate")
        raise HTTPException(status_code=500, detail=str(e))
