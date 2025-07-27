import asyncio
import tempfile
import os

async def verify_lean_code(file_text: str) -> tuple[bool, str]:
    """
    Write Lean4 code to a temp file and validate it using the Lean CLI.
    Returns (ok, log): True if valid, False + stderr if invalid.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        file_path = os.path.join(tmpdir, "Test.lean")
        with open(file_path, "w") as f:
            f.write(file_text)

        print(f">>>>>> file text received at lean verification {file_text}")
        # Run lean on the file
        proc = await asyncio.create_subprocess_exec(
            "lean",
            file_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await proc.communicate()
        print(f">>>>> the output from verification : {stdout} \n and the error is : {stderr}")
        ok = proc.returncode == 0
        log = stderr.decode() if not ok else stdout.decode()

        return ok, log

