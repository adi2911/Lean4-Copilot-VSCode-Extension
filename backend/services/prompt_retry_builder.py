from typing import Optional
from services.langchain_pipeline import generate_suggestion
from tenacity import retry, wait_random_exponential, stop_after_attempt

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



@retry(wait=wait_random_exponential(min=1, max=3), stop=stop_after_attempt(3))
async def resilient_invoke(vars: dict) -> str:
    return await generate_suggestion(vars)