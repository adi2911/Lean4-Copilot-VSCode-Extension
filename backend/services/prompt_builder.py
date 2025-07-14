def make_prompt(file_text: str, cursor_line: int, cursor_col: int) -> str:
    """
    Generate a structured prompt for the LLM to complete Lean4 proof code.
    """
    TEMPLATE = """You are a Lean4 theorem-proving assistant.
                    Given a Lean4 file and a cursor position, suggest the next 
                    line of code to help complete a proof or tactic.

                Return only valid Lean4 code — do not include any explanation or
                  commentary.

                -- Lean4 File Content START
                {code}
                -- Lean4 File Content END

                The cursor is at line {line}, column {col}.
                Respond with only one or two lines of Lean4 code that would 
                logically go here.
Respond **with Lean code only**.
DO NOT wrap the answer in triple back-ticks
or any Markdown fences.
                """

    return TEMPLATE.format(code=file_text, line=cursor_line, col=cursor_col)
