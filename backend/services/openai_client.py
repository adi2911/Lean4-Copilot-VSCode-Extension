import os
import openai


async def stream_completion(prompt: str, max_tokens: int = 256):
    response = await openai.ChatCompletion.acreate(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        temperature=0.2,
        stream=True,
    )

    async for chunk in response:
        # Some deltas carry only {"role": ...}. Skip them.
        content = getattr(chunk.choices[0].delta, "content", None)
        if content:
            yield content

async def chat_completion(messages: list[dict], *, max_tokens: int = 512, model: str = "gpt-4o"):
    """Single-shot completion used when we must validate before replying."""
    resp = await openai.ChatCompletion.acreate(
        model=model,
        messages=messages,
        temperature=0,
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content
