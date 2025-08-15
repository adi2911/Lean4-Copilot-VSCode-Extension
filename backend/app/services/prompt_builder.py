# services/prompt_builder.py
from __future__ import annotations
from typing import Optional
from langchain.prompts import PromptTemplate

GHOST_TEXT_TMPL = PromptTemplate.from_template(
    """
You are an assistant that writes the next SINGLE LINE of Lean 4 code.

Rules:
- Output exactly ONE tactic/command line that can be placed at the cursor.
- Do NOT restate the theorem or goal. Do NOT add ':=', 'where', or a new declaration.
- Prefer simple, verifying steps like: `rfl`, `simp [defs]`, `simp`, `rewrite [...]`, `exact …`, `apply …`.
- No comments, no prose, no code fences.

The Lean snippet includes a special cursor marker: <CURSOR>.
Write the next line that should go at <CURSOR>.

Examples:
-- Example A
def double (n : Nat) : Nat := n + n
theorem t (n : Nat) : double n = n + n := by
<CURSOR>
→ rfl

-- Example B
def double (n : Nat) : Nat := n + n
theorem t (n : Nat) : double n = 2 * n := by
<CURSOR>
→ simp [double]

Snippet:
{file_text}

Return ONLY the single next line.
"""
)

def make_ghost_prompt(*, file_text: str, line: int, col: int) -> str:
    # file_text already contains <CURSOR> in our pipeline (we inject it there)
    return GHOST_TEXT_TMPL.format(file_text=file_text, line=line, col=col)



# ──────────────────────────────────────────────────────────────────────────────
# Prompt: retry a single-line suggestion with error feedback (/retry)
# Goal: improve the previous single-line suggestion using Lean error + optional instruction.
# Output format: a SINGLE line of Lean code (no prose, no fences).
# ──────────────────────────────────────────────────────────────────────────────
RETRY_TMPL = PromptTemplate.from_template(
    """
You are improving a single next-line Lean 4 suggestion based on the compiler error.

Constraints:
- Output exactly ONE line of Lean code that replaces the previous suggestion.
- No prose, no backticks, no code fences, no comments.
- Keep it minimal and syntactically valid.

Lean file (truncated as provided):
{file_text}

Previous suggestion (failed):
{previous_suggestion}

Lean error:
{error}

{instruction_block}

Return the corrected SINGLE line only.
"""
)

# ──────────────────────────────────────────────────────────────────────────────
# Prompt: complete full proof or multi-line block (/complete)
# Goal: produce the full Lean 4 file text with the relevant proof(s) completed.
# Output format: the ENTIRE Lean file content (no prose, no fences).
# ──────────────────────────────────────────────────────────────────────────────
# services/prompt_builder.py
from typing import Optional

COMPLETE_TMPL = PromptTemplate.from_template(
    """
You are completing Lean 4 proofs in the given file.

Requirements:
- Return the ENTIRE Lean 4 file content, with the target theorem(s)/proof(s) completed.
- Preserve imports and existing definitions.
- Keep style idiomatic and minimal.
- No explanations, no comments (unless already present in the file), no backticks, no fences.

Additional guidance (may be empty):
{instruction_block}

Lean file:
{file_text}

Return ONLY the full Lean file content.
"""
)

def make_complete_proof_prompt(*, file_text: str, instruction: Optional[str] = None) -> str:
    """
    Build the /complete prompt. Works whether COMPLETE_TMPL contains
    {instruction_block} or not.
    """
    instr = (instruction or "").strip()
    params = {
        "file_text": file_text,
        "instruction_block": (instr if instr else "(none)"),
    }
    try:
        # If the template has {instruction_block}, this succeeds.
        return COMPLETE_TMPL.format(**params)
    except KeyError:
        # Older template without {instruction_block}
        return COMPLETE_TMPL.format(file_text=file_text)


def make_retry_prompt(
    *,
    file_text: str,
    previous_suggestion: str,
    error: str,
    instruction: Optional[str] = None,
) -> str:
    instruction_block = (
        "Additional guidance:\n" + instruction.strip()
        if instruction and instruction.strip()
        else "Additional guidance: (none)"
    )
    return RETRY_TMPL.format(
        file_text=file_text,
        previous_suggestion=previous_suggestion,
        error=error,
        instruction_block=instruction_block,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Output post-processing for /suggest and /retry (single-line)
# ──────────────────────────────────────────────────────────────────────────────

def clean_suggestion(text: str) -> str:
    """
    Normalize model output to a single Lean line:
    - Strip code fences/backticks and surrounding whitespace.
    - Take the first non-empty line.
    - Remove leading/trailing whitespace and guarantee a trailing newline.
    - Disallow accidental multi-line returns.
    """
    if not text:
        return ""

    t = text.strip()

    # Remove markdown code fences if present
    if t.startswith("```"):
        lines = [ln for ln in t.splitlines() if not ln.strip().startswith("```")]
        t = "\n".join(lines).strip()

    # Keep first non-empty line only
    for line in t.splitlines():
        ln = line.strip()
        if ln:
            return ln + "\n"

    return ""

# ──────────────────────────────────────────────────────────────────────────────
# Backwards-compatible export names (used elsewhere in the codebase)
# ──────────────────────────────────────────────────────────────────────────────
GHOST_TEXT_PROMPT = GHOST_TEXT_TMPL
RETRY_PROMPT = RETRY_TMPL
COMPLETE_PROOF_PROMPT = COMPLETE_TMPL

__all__ = [
    # prompt objects
    "GHOST_TEXT_TMPL",
    "RETRY_TMPL",
    "COMPLETE_TMPL",
    # compat aliases
    "GHOST_TEXT_PROMPT",
    "RETRY_PROMPT",
    "COMPLETE_PROOF_PROMPT",
    # builders
    "make_ghost_prompt",
    "make_retry_prompt",
    "make_complete_proof_prompt",
    # utils
    "clean_suggestion",
]
