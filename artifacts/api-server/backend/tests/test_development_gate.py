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


def test_managed_requests_never_run_compatibility_and_diagnostics_do_not_gate_auth(monkeypatch):
    import app.main as main
    settings = get_settings().model_copy(update={"app_env": "development"})
    monkeypatch.setattr(main, "_managed_development", True)
    monkeypatch.setattr(main, "LOADED_IDENTITY", LOADED_IDENTITY, raising=False)
    monkeypatch.setattr(main, "get_settings", lambda: settings)
    from app.services.development_gate import DevelopmentGate
    calls = []
    async def failed(self):
        calls.append("explicit")
        return False
    monkeypatch.setattr(DevelopmentGate, "ready", failed)
    with TestClient(main.create_app()) as api:
        assert api.get("/api/v1/health").status_code == 200
        assert api.get("/api/v1/version").status_code == 200
        assert api.get("/api/v1/auth/me").status_code == 401
        assert api.post("/api/v1/auth/refresh").status_code == 403  # origin protection
        assert api.get("/api/v1/admin/staff").status_code == 401
        assert api.get("/api/v1/health/readiness").status_code == 200
        assert calls == []  # including ordinary readiness, no diagnostic preflight
        status = api.get("/api/v1/development/compatibility")
        assert status.status_code == 503
        assert set(status.json()) == {"format", "identity", "ready"}
        assert "checks" not in status.json()
        assert calls == ["explicit"]
        assert api.post("/api/v1/auth/refresh").status_code == 403
        assert api.get("/api/v1/admin/staff").status_code == 401
        assert calls == ["explicit"]
        async def passed(self):
            return True
        monkeypatch.setattr(DevelopmentGate, "ready", passed)
        assert api.get("/api/v1/development/compatibility").json()["ready"] is True
        assert api.get("/api/v1/admin/staff").status_code == 401
        headers = {"X-Evexia-Development-Contract": "stale:irrelevant"}
        assert api.get("/api/v1/admin/staff", headers=headers).status_code == 401


def test_production_has_no_development_dependency_or_route(monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "_managed_development", False)
    with patch("app.services.development_gate.DevelopmentGate", side_effect=AssertionError("must not instantiate")):
        with TestClient(main.create_app()) as api:
            assert api.get("/api/v1/development/compatibility").status_code == 404
            assert api.get("/api/v1/version").json() == {"api": "v1", "release": LOADED_IDENTITY}


@pytest.mark.parametrize("diagnostics_pass", [True, False])
def test_actual_managed_startup_without_preflight_and_security_failure(development_settings, diagnostics_pass, tmp_path):
    root = Path(__file__).resolve().parents[4]
    # Preserve the real launcher's separately approved database-sync boundary:
    # bind a code-only clone to this disposable database, never the shared one.
    import shutil
    original = root
    root = tmp_path / "candidate"
    review = json.loads((original / "scripts/fresh-install-review.json").read_text())
    files = set(review["release_sources"]) | {
        "scripts/fresh-install-review.json", "scripts/fresh-install-catalog.json",
        "scripts/migration-policy.json", "scripts/development-preflight.sh",
        "scripts/review-development-schema.py", "scripts/development-sync.py",
        "scripts/deploy-migrations.py", "development-contract.json",
        "scripts/development-schema-review.json",
        "pyproject.toml", "uv.lock", "artifacts/api-server/backend/alembic.ini"}
    for name in files:
        destination = root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original / name, destination)
    for directory in ("app", "alembic"):
        shutil.copytree(original / "artifacts/api-server/backend" / directory,
                        root / "artifacts/api-server/backend" / directory,
                        dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__"))
    with session_factory().kw["bind"].connect() as connection:
        info = connection.connection.driver_connection.info
        cluster, oid = connection.execute(text(
            "SELECT system_identifier::text,(SELECT oid FROM pg_database WHERE datname=current_database()) FROM pg_control_system()"
        )).one()
        binding = {"version": 1, "host": info.host, "port": info.port,
                   "database": info.dbname, "cluster": cluster, "oid": oid}
    (root / "scripts/development-database.json").write_text(json.dumps(binding))
    subprocess.run([sys.executable, "-B", str(root / "scripts/review-schema-release.py"), "--refresh"],
                   check=True, stdout=subprocess.DEVNULL)
    # The clone uses a newly bound disposable database. Review its exact
    # development execution sources instead of borrowing the workspace binding.
    subprocess.run([sys.executable, "-B", str(root / "scripts/review-development-schema.py"), "--refresh"],
                   check=True, stdout=subprocess.DEVNULL)
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    env = {**os.environ, "APP_ENV": "development", "PORT": str(port),
           "COMMUNICATION_ENCRYPTION_KEYS": (
               development_settings.communication_encryption_keys.get_secret_value() if diagnostics_pass else "")}
    # This environment is the harness's private socket-only synthetic database.
    assert "evexia_api_test" in env["DATABASE_URL"]
    # Managed workflows start in the artifact, without the harness's import path.
    # Explicit diagnostics must still import app in their real child process.
    env.pop("PYTHONPATH", None)
    process = subprocess.Popen(["sh", str(root / "scripts/start-development-api.sh")],
                               cwd=root / "artifacts/api-server", env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    started = time.monotonic()
    try:
        healthy = False
        while time.monotonic() - started < 12:
            assert process.poll() is None
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/health", timeout=2) as response:
                    healthy = json.load(response) == {"status": "ok"}
                break
            except (OSError, urllib.error.URLError):
                time.sleep(.05)
        # Missing diagnostic prerequisites do not prevent normal startup.
        assert healthy
        with pytest.raises(urllib.error.HTTPError) as rejected:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/auth/me", timeout=2)
        assert rejected.value.code == 401
        # Only now explicitly request diagnostics, against the disposable DB.
        try:
            response = urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/v1/development/compatibility", timeout=12)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            assert response.status == (200 if diagnostics_pass else 503)
            runtime = json.load(response)
        assert runtime["ready"] is diagnostics_pass
        assert runtime["identity"] == LOADED_IDENTITY
        with pytest.raises(urllib.error.HTTPError) as still_protected:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/auth/me", timeout=2)
        assert still_protected.value.code == 401
    finally:
        process.terminate()
        process.wait(timeout=5)
    # Independent signing validation remains mandatory at actual startup.
    env["JWT_SECRET"] = ""
    env["SESSION_SECRET"] = ""
    failed = subprocess.run(["sh", str(root / "scripts/start-development-api.sh")],
                            cwd=root, env=env, capture_output=True, timeout=12)
    assert failed.returncode != 0
    assert b"Uvicorn running" not in failed.stderr
