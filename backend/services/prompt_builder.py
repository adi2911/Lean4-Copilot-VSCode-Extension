import re
from langchain_core.messages import AIMessage

_FENCE_RE = re.compile(r"^```.*?\n?|```$", re.S)

def clean_suggestion(raw: str | AIMessage) -> str:
    if hasattr(raw, "content"):
        raw = raw.content
    return _FENCE_RE.sub("", raw)