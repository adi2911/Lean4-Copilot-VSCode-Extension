from __future__ import annotations
import asyncio
from dotenv import load_dotenv

load_dotenv()                              # get OPENAI_API_KEY

from langchain_openai import ChatOpenAI
from langchain.prompts import PromptTemplate

from langchain_core.messages import AIMessage      # add import


from services.lean_verify import verify_lean_code
from services.prompt_builder import clean_suggestion   
from langchain_core.output_parsers import StrOutputParser


# ── LLM endpoints ─────────────────────────────────────────────────────────────
FAST_MODEL  = ChatOpenAI(model="gpt-4.1", temperature=0.2, max_tokens=256)
SMART_MODEL = ChatOpenAI(model="gpt-40",        temperature=0.2, max_tokens=256)

LLM_CANDIDATES = {
    "fast":  FAST_MODEL,
    "smart": SMART_MODEL,
}

LEAN_PROMPT = PromptTemplate.from_template(
 """You are a Lean4 theorem-proving assistant.
                    Given a Lean4 file and a cursor position, suggest the next 
                    line of code to help complete a proof or tactic.

                Return only valid Lean4 code — do not include any explanation or
                  commentary.

                -- Lean4 File Content START
                {file_text}
                -- Lean4 File Content END

                The cursor is at line {line}, column {col}.
                Respond with only one or two lines of Lean4 code that would 
                logically go here.
                Respond **with Lean code only**.
                DO NOT wrap the answer in triple back-ticks
                or any Markdown fences.
                """
)

# ── Core helper ---------------------------------------------------------------
async def first_valid_suggestion(
    file_text: str, line: int, col: int
) -> str:
    """Run all LLMs in parallel, return first Lean-validated suggestion."""


    prompt = LEAN_PROMPT.format(file_text=file_text, line=line, col=col)

    print(f">>>> prompt genereted for /complete {prompt}")

    async def run_model(llm):
        msg = await llm.ainvoke(prompt)          # AIMessage
        text = msg.content if hasattr(msg, "content") else str(msg)
        return StrOutputParser().parse(text)

    # ① call every model concurrently
    tasks = [asyncio.create_task(run_model(llm)) for llm in LLM_CANDIDATES.values()]
    responses = await asyncio.gather(*tasks, return_exceptions=True)

    # ② validate in original candidate order
    for raw in responses:
        if isinstance(raw, Exception):
            continue
        sug = clean_suggestion(raw)
        completed = file_text + sug
        print(f" >>>>>> suggestion : {sug} \n completed file : {completed}")
        ok, _ = await verify_lean_code(completed)
        if ok:
            # prepend newline + indent if missing
            if sug and not sug.startswith("\n"):
                sug = "\n  " + sug.lstrip()
            return sug
    return ""  # nothing passed


async def generate_suggestion(vars: dict) -> str:
    return await first_valid_suggestion(
        vars["file_text"], vars["line"], vars["col"]
    )





# ── 3. Validation wrapper -----------------------------------------------------
# async def validate_or_none(suggestion: str, file_text: str) -> str | None:
#     """Return suggestion if Lean accepts it, else None."""
#     if not suggestion.strip():
#         return None
#     completed = file_text + suggestion
#     ok, _ = await verify_lean_code(completed)
#     return suggestion if ok else None

# ValidateStep = RunnableLambda(
#     lambda args: asyncio.get_event_loop().run_until_complete(
#         validate_or_none(args["suggestion"], args["file_text"])
#     )
# )

# # ── 4. Build the LCEL graph  ──────────────────────────────────────────────────
# def build_chain():
#     # fan-out to all models in parallel
#     fanout = {
#         name: llm | StrOutputParser()
#         for name, llm in LLM_CANDIDATES.items()
#     }

#     parallel_chain = RunnableParallel(**fanout)

#     # pick the first validated answer (strategy-switching / retries later)
#     def first_valid(d: dict[str, str], file_text: str):
#         for name, raw in d.items():
#             sug = clean_suggestion(raw)
#             ok = asyncio.get_event_loop().run_until_complete(
#                 validate_or_none(sug, file_text)
#             )
#             if ok:
#                 return ok
#         return ""   # all failed

#     select_valid = RunnableLambda(lambda d, file_text: first_valid(d, file_text))

#     # full graph:  {input} → prompt → {model fan-out} → select → result str
#     return (
#         LEAN_PROMPT
#         | parallel_chain.bind()     
#         | select_valid
#     )

# PIPELINE = build_chain()
