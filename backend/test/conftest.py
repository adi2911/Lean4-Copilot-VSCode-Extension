# backend/tests/conftest.py
import os
import sys
from pathlib import Path
import pytest

# Ensure `import app.main` works when tests run from repo root
ROOT = Path(__file__).resolve().parents[1]  # …/backend
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Keep OpenAI from being contacted by accident
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("OPENAI_FAST_MODEL", "test-fast")
os.environ.setdefault("OPENAI_SMART_MODEL", "test-smart")

@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Paranoid: prevent accidental network in tests."""
    import socket
    def guard(*args, **kwargs):
        raise RuntimeError("Network disabled in tests")
    monkeypatch.setattr(socket, "create_connection", guard, raising=True)
    # Allow loopback usage for FastAPI TestClient if you ever use it
    # (we don't here—just defensive)
    yield
