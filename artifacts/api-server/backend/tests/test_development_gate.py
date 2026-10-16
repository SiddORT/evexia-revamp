"""Read-only gate against disposable PostgreSQL and synthetic configuration."""
import json
import os
import subprocess
import sys
import socket
import time
from pathlib import Path
import urllib.request
import urllib.error
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text

from app.core.config import get_settings
from app.core.development_identity import LOADED_IDENTITY
from app.services.development_preflight import report
from app.db.session import session_factory


@pytest.fixture
def development_settings():
    settings = get_settings().model_copy(update={"app_env": "development",
        "communication_encryption_keys": SecretStr('{"primary":"REREREREREREREREREREREREREREREREREREREREREQ="}')})
    assert "evexia_api_test" in settings.database_url
    with (patch("app.core.config.get_settings", return_value=settings),
          patch("app.services.directory_runtime.get_settings", return_value=settings),
          patch("app.services.account_crypto.get_settings", return_value=settings)):
        yield settings


def test_missing_invalid_and_reused_communication_keys_are_redacted(development_settings):
    settings = development_settings
    for value in (None, SecretStr("synthetic-sensitive-not-json"), settings.staff_encryption_keys):
        settings.communication_encryption_keys = value
        result = report()
        assert not result["ok"]
        assert result["checks"]["communication_keys"] == "missing_or_invalid_configuration"
        assert "synthetic-sensitive" not in json.dumps(result)
        assert settings.database_url not in json.dumps(result)


def test_real_database_read_only_revision_and_functional_anchors(development_settings):
    result = report()
    assert result["checks"]["database"] == "pass"
    assert result["checks"]["revision"] == "pass"
    assert result["checks"]["communication_keys"] == "pass"
    assert result["checks"]["directory_state"] == result["checks"]["account_state"] == "pass"
    assert result["checks"]["running_api"] == result["checks"]["ingress"] == "not_verified"
    assert result["ok"]
    # Functionally invalid anchors cannot pass merely because keys parse.
    development_settings.directory_index_key = SecretStr("RkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkY=")
    assert report()["checks"]["directory_state"] != "pass"


def test_revision_mismatch_unavailable_database_and_read_only_no_writes(development_settings):
    from app.core.schema import SCHEMA_REVISION
    engine = session_factory().kw["bind"]
    with engine.connect() as db, db.begin():
        before = db.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
    with patch("app.core.schema.SCHEMA_REVISION", "synthetic_unapproved"):
        result = report()
        assert result["checks"]["revision"] == "revision_mismatch"
    with engine.connect() as db, db.begin():
        assert db.execute(text("SELECT version_num FROM alembic_version")).scalars().all() == before == [SCHEMA_REVISION]
    development_settings.database_url = "postgresql+psycopg://synthetic@127.0.0.1:1/synthetic"
    result = report()
    assert result["checks"]["database"] == "database_unavailable"
    assert not result["ok"]


def test_missing_signing_configuration_does_not_echo_values(development_settings):
    development_settings.jwt_secret = development_settings.session_secret = None
    result = report()
    assert result["checks"]["configuration"] == "missing_or_invalid_configuration"
    assert result["checks"]["database"] == "not_verified"


def test_managed_middleware_quarantine_diagnostics_and_auth_are_separate(monkeypatch):
    import app.main as main
    settings = get_settings().model_copy(update={"app_env": "development"})
    monkeypatch.setattr(main, "_managed_development", True)
    monkeypatch.setattr(main, "LOADED_IDENTITY", LOADED_IDENTITY, raising=False)
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    from app.services.development_gate import DevelopmentGate
    async def failed(self):
        return False
    monkeypatch.setattr(DevelopmentGate, "ready", failed)
    with TestClient(main.create_app()) as api:
        assert api.get("/api/v1/health").status_code == 200
        status = api.get("/api/v1/development/compatibility")
        assert status.status_code == 503
        assert set(status.json()) == {"format", "identity", "ready"}
        assert "checks" not in status.json()
        assert api.post("/api/v1/auth/refresh").status_code == 503
        assert api.get("/api/v1/health/readiness").status_code == 503
        async def passed(self):
            return True
        monkeypatch.setattr(DevelopmentGate, "ready", passed)
        assert api.get("/api/v1/development/compatibility").json()["ready"] is True
        assert api.get("/api/v1/admin/staff").status_code == 503  # missing browser contract
        headers = {"X-Evexia-Development-Contract": f'{LOADED_IDENTITY["contract"]}:{LOADED_IDENTITY["schema"]}'}
        assert api.get("/api/v1/admin/staff", headers=headers).status_code == 401  # no auth bypass


def test_production_has_no_development_dependency_or_route(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "_managed_development", False)
    with patch("app.services.development_gate.DevelopmentGate", side_effect=AssertionError("must not instantiate")):
        with TestClient(main.create_app()) as api:
            assert api.get("/api/v1/development/compatibility").status_code == 404
            assert api.get("/api/v1/version").json() == {"api": "v1"}


def test_actual_managed_startup_loaded_process_and_nonzero_failed_start(development_settings):
    root = Path(__file__).resolve().parents[4]
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    env = {**os.environ, "APP_ENV": "development", "PORT": str(port),
           "COMMUNICATION_ENCRYPTION_KEYS": development_settings.communication_encryption_keys.get_secret_value()}
    # This environment is the harness's private socket-only synthetic database.
    assert "evexia_api_test" in env["DATABASE_URL"]
    process = subprocess.Popen(["sh", str(root / "scripts/start-development-api.sh")],
                               cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    started = time.monotonic()
    try:
        runtime = None
        while time.monotonic() - started < 12:
            assert process.poll() is None
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/development/compatibility", timeout=2) as response:
                    runtime = json.load(response)
                break
            except (OSError, urllib.error.URLError):
                time.sleep(.05)
        assert runtime and runtime["ready"] is True
        assert runtime["identity"] == LOADED_IDENTITY
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/health", timeout=2) as response:
            assert json.load(response) == {"status": "ok"}
        with pytest.raises(urllib.error.HTTPError) as rejected:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/auth/me", timeout=2)
        assert rejected.value.code == 503
    finally:
        process.terminate()
        process.wait(timeout=5)
    # Missing keys fail before exec: a nonzero setup must never start Uvicorn.
    env["COMMUNICATION_ENCRYPTION_KEYS"] = ""
    failed = subprocess.run(["sh", str(root / "scripts/start-development-api.sh")],
                            cwd=root, env=env, capture_output=True, timeout=12)
    assert failed.returncode != 0
    result = json.loads(failed.stdout)
    assert not result["ok"]
    assert result["checks"]["communication_keys"] == "missing_or_invalid_configuration"
    assert b"Uvicorn running" not in failed.stderr
