from typing import Optional

SYSTEM_MSG = (
    "You are an expert Lean4 assistant. "
    "Return ONLY raw Lean4 code – do NOT wrap it in markdown fences."
)

def make_retry_prompt(file_text: str, error_log: str, user_hint: Optional[str]) -> list[dict]:
    """Return an OpenAI chat-style messages list."""
    
    msgs = [
        {"role": "system", "content": SYSTEM_MSG},
        {"role": "user", "content": "Here is the failing Lean file:\n```lean\n" + file_text + "\n```"},
        {"role": "user", "content": "Lean error:\n```\n" + error_log + "\n```"},
    ]
    if user_hint:
        msgs.append({"role": "user", "content": "Extra hint from user:\n" + user_hint})
    msgs.append({"role": "system", "content": "Please output the FULL corrected file."})
    return msgs
