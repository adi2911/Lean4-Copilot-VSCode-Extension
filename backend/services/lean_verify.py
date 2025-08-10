from __future__ import annotations
import asyncio
import tempfile
import os
from typing import Tuple

LEAN_CMD = os.getenv("LEAN_CMD", "lean")  # allow overriding path via env var
VERIFY_TIMEOUT = 15  


async def verify_lean_code(code: str) -> Tuple[bool, str | None]:
    """
    Verify Lean 4 code by writing it to a temp file and running `lean`.
    Returns: (ok, error_message)
    """
    # Write code to a temporary .lean file
    with tempfile.NamedTemporaryFile(suffix=".lean", delete=False) as f:
        f.write(code.encode("utf-8"))
        tmp_path = f.name

    try:
        proc = await asyncio.create_subprocess_exec(
            LEAN_CMD,
            tmp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=VERIFY_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            return False, f"Lean verification timed out after {VERIFY_TIMEOUT} seconds"

        # Lean exits with 0 on success
        if proc.returncode == 0:
            return True, None

        # Trim error output
        err_str = stderr.decode("utf-8", errors="replace").strip()
        return False, _short_err(err_str)

    except FileNotFoundError:
        return False, f"Lean CLI not found: '{LEAN_CMD}'"
    except Exception as e:
        return False, f"Unexpected error during Lean verification: {e}"
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def _short_err(err: str, limit: int = 1500) -> str:
    """Return a shortened error message if it's too long."""
    if not err:
        return ""
    return err if len(err) <= limit else err[:limit] + "\n…(truncated)…"
