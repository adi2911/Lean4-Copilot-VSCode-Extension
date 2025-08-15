# schemas.py
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


# ── /suggest ───────────────────────────────────────────────────────────────────

class SuggestRequest(BaseModel):
    file_text: str = Field(..., description="Current Lean file contents")
    cursor_line: int = Field(..., ge=0, description="0-based cursor line")
    cursor_col: int = Field(..., ge=0, description="0-based cursor column")


class SuggestResponse(BaseModel):
    suggestion: Optional[str] = Field(
        None, description="Single-line Lean suggestion with trailing newline if verified"
    )
    error: Optional[str] = Field(
        None, description="Lean error snippet if no candidate verified"
    )


# ── /retry ─────────────────────────────────────────────────────────────────────

class RetryRequest(BaseModel):
    file_text: str = Field(..., description="Current Lean file contents")
    previous_suggestion: str = Field(
        ..., description="The prior single-line suggestion that failed"
    )
    error: str = Field(..., description="Compiler error from Lean for that suggestion")
    instruction: Optional[str] = Field(
        None, description="Optional extra guidance from user"
    )


class RetryResponse(BaseModel):
    suggestion: Optional[str] = Field(
        None, description="Single-line Lean suggestion with trailing newline if verified"
    )
    error: Optional[str] = Field(
        None, description="Lean error snippet if no candidate verified"
    )


# ── /complete ──────────────────────────────────────────────────────────────────

class CompleteRequest(BaseModel):
    file_text: str = Field(..., description="Lean file to complete (entire content)")
    instruction: Optional[str] = Field(
        None, description="Optional user hint to guide completion"
    )

class CompleteResponse(BaseModel):
    ok: bool
    proof: str = ""                    
    log: Optional[str] = None          
    attempt: Optional[str] = None     
    candidates: Optional[List[str]] = None

# ── /validate ──────────────────────────────────────────────────────────────────

class ValidateRequest(BaseModel):
    file_text: str = Field(..., description="Lean code to type-check")


class ValidateResponse(BaseModel):
    ok: bool = Field(..., description="True if Lean verification passed")
    error: Optional[str] = Field(
        None, description="Compiler error if verification failed"
    )


__all__ = [
    "SuggestRequest",
    "SuggestResponse",
    "RetryRequest",
    "RetryResponse",
    "CompleteRequest",
    "CompleteResponse",
    "ValidateRequest",
    "ValidateResponse",
]
