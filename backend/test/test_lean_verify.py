# backend/tests/test_lean_verify.py
import asyncio
import types
from app.services import lean_verify as lv

class FakeProc:
    def __init__(self, returncode=0, stdout=b"", stderr=b""):
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr
    async def communicate(self):
        return self._stdout, self._stderr
    def kill(self):  # used on timeout
        pass

async def _fake_create_proc_ok(*args, **kwargs):
    return FakeProc(returncode=0)

async def _fake_create_proc_err(*args, **kwargs):
    return FakeProc(returncode=1, stderr=b"some lean error")

def test_verify_lean_code_success(monkeypatch):
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_create_proc_ok)
    ok, err = asyncio.get_event_loop().run_until_complete(
        lv.verify_lean_code("theorem t : True := by rfl\n")
    )
    assert ok is True
    assert err is None

def test_verify_lean_code_failure(monkeypatch):
    monkeypatch.setattr(asyncio, "create_subprocess_exec", _fake_create_proc_err)
    ok, err = asyncio.get_event_loop().run_until_complete(
        lv.verify_lean_code("theorem t : True := by rfl\n")
    )
    assert ok is False
    assert "some lean error" in (err or "")

def test_verify_lean_code_timeout(monkeypatch):
    async def fake_create(*a, **k): return FakeProc(returncode=0)
    async def fake_wait_for(awaitable, timeout=None):
        raise asyncio.TimeoutError
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    monkeypatch.setattr(asyncio, "wait_for", fake_wait_for)
    ok, err = asyncio.get_event_loop().run_until_complete(
        lv.verify_lean_code("theorem t : True := by rfl\n")
    )
    assert ok is False
    assert "timed out" in (err or "").lower()

def test_verify_lean_code_not_found(monkeypatch):
    async def fake_create(*a, **k):
        raise FileNotFoundError("lean not on PATH")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)
    ok, err = asyncio.get_event_loop().run_until_complete(
        lv.verify_lean_code("theorem t : True := by rfl\n")
    )
    assert ok is False
    assert "not found" in (err or "").lower()
