# backend/tests/test_main_endpoints.py
from fastapi.testclient import TestClient
from app.main import app
from app.services import langchain_pipeline as lp
from app import main as app_main

client = TestClient(app)

async def fake_suggest(_payload):  # returns dict like endpoint expects
    return {"suggestion": "rfl\n", "error": None}

async def fake_retry(_payload):
    return {"suggestion": "simp [double]\n", "error": None}

async def fake_complete(_payload):
    return {"proof": "theorem t : True := by rfl\n", "ok": True, "log": None}

async def fake_verify(code: str):
    return True, None

def test_suggest_endpoint(monkeypatch):
    monkeypatch.setattr(lp.SUGGEST_PIPELINE, "ainvoke", fake_suggest)
    r = client.post("/suggest", json={"file_text":"theorem t : True := by\n","cursor_line":0,"cursor_col":0})
    assert r.status_code == 200
    assert r.json()["suggestion"].strip() == "rfl"

def test_complete_endpoint(monkeypatch):
    monkeypatch.setattr(lp.COMPLETE_PIPELINE, "ainvoke", fake_complete)
    r = client.post("/complete", json={"file_text":"theorem t : True := by\n"})
    assert r.status_code == 200
    assert r.json()["ok"] is True

def test_validate_endpoint(monkeypatch):
    monkeypatch.setattr(app_main, "verify_lean_code", fake_verify)
    r = client.post("/validate", json={"file_text":"theorem t : True := by rfl\n"})
    assert r.status_code == 200
    assert r.json()["ok"] is True
