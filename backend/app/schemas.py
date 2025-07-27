from pydantic import BaseModel
from typing import Optional


class CompletionRequest(BaseModel):
    file_text: str
    cursor_line: int
    cursor_col: int

class CompletionChunk(BaseModel):
    text: str
    done: bool = False


class ValidationRequest(BaseModel):
    file_text: str

class ValidationResponse(BaseModel):
    ok: bool
    log: str | None = None


class CompletionResponse(BaseModel):
    """Unified response for both /complete and /retry."""
    ok: bool            # proof verifies?
    code: str           # model’s suggestion (Lean source)
    log: str            # Lean compiler output (empty if ok=True)

class RetryRequest(BaseModel):
    """Payload sent when user presses ‘Retry’."""
    file_text: str              # full Lean file at the time of retry
    error_log: str              # Lean error trace to show the LLM
    user_note: Optional[str] = None  # optional hint typed by the user
