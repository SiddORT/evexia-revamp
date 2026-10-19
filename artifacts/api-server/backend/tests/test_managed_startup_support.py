"""Synthetic plumbing checks; no database, managed service or real credentials."""
import os
import shlex
import subprocess
import sys

import pytest

from managed_startup_support import dependency_environment, sanitized_startup_output


def test_dependency_environment_drops_source_paths_and_pins_interpreter(tmp_path, monkeypatch):
    packages = tmp_path / ".pythonlibs/lib/python3.13/site-packages"
    packages.mkdir(parents=True)
    original_backend = tmp_path / "original/backend"
    original_backend.mkdir(parents=True)
    monkeypatch.setattr(sys, "executable", "/synthetic/python with 'quotes'/bin/python")
    env = dependency_environment(
        {"PATH": "/synthetic/bin", "PYTHONPATH": str(original_backend)},
        tmp_path / "bin", ["", str(original_backend), str(packages), str(packages)])
    assert env["PYTHONPATH"] == str(packages)
    assert env["PATH"] == str(tmp_path / "bin") + os.pathsep + "/synthetic/bin"
    shim = tmp_path / "bin/python"
    assert shim.stat().st_mode & 0o777 == 0o700
    assert shim.read_text().splitlines()[0] == "#!/bin/sh"
    assert shlex.split(shim.read_text().splitlines()[1]) == ["exec", sys.executable, "$@"]


def test_dependency_environment_fails_without_installed_packages(tmp_path):
    with pytest.raises(AssertionError, match="requires installed Python package directories"):
        dependency_environment({}, tmp_path / "bin", ["", str(tmp_path)])


def test_selected_interpreter_and_packages_import_only_cloned_app(tmp_path):
    # Exercise the same bare-python shim and dependency-only environment as the
    # managed test, including a real child (not parent sys.modules).
    backend = tmp_path / "candidate/backend"
    (backend / "app").mkdir(parents=True)
    expected = backend / "app/__init__.py"
    expected.write_text("")
    cwd = tmp_path / "candidate/artifacts/api-server"
    cwd.mkdir(parents=True)
    env = dependency_environment(os.environ, tmp_path / "bin")
    env["PYTHONPATH"] = str(backend) + os.pathsep + env["PYTHONPATH"]
    child = subprocess.run(
        ["python", "-B", "-c",
         "import app, alembic, fastapi, psycopg, sqlalchemy, uvicorn, sys; "
         "from pathlib import Path; "
         "assert Path(app.__file__) == Path(sys.argv[1]); "
         "assert sys.executable == sys.argv[2]",
         str(expected), sys.executable],
        cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        timeout=10, check=False,
    )
    assert child.returncode == 0, sanitized_startup_output(child.stdout, tmp_path)


def test_startup_output_withholds_values_but_keeps_stage_and_exception(tmp_path):
    sensitive = "synthetic-secret-not-for-output"
    raw = (
        f"DATABASE_URL=postgresql://person:{sensitive}@private.invalid/db\n"
        f'DEVELOPMENT_SCHEMA_BLOCKED: {sensitive}\n'
        "DEVELOPMENT_SYNC_BLOCKED: ModuleNotFoundError\n"
        "ModuleNotFoundError: No module named 'sqlalchemy'\n"
        f"ValueError: input_value={sensitive}\n"
        f'  File "{tmp_path}/scripts/development-sync.py", line 115, in synchronize\n'
        f"    credentials = '{sensitive}'\n"
        f"INFO: Uvicorn running on http://{sensitive}:8080\n"
        f'SESSION_SECRET="{sensitive}\\nsecond-secret-line"\n'
    ).encode()
    safe = sanitized_startup_output(raw, tmp_path)
    assert sensitive not in safe
    assert "second-secret-line" not in safe
    assert "postgresql://" not in safe
    assert "DEVELOPMENT_SCHEMA_BLOCKED: [detail withheld]" in safe
    assert "DEVELOPMENT_SYNC_BLOCKED: ModuleNotFoundError" in safe
    assert "ModuleNotFoundError: 'sqlalchemy'" in safe
    assert "scripts/development-sync.py:115" in safe
    assert "UVICORN: listener started" in safe


def test_startup_output_is_bounded_and_unknown_text_is_not_echoed(tmp_path):
    safe = sanitized_startup_output(
        b"ValueError: synthetic-sensitive-input\n" * 1000, tmp_path)
    assert len(safe.splitlines()) == 40
    assert "synthetic-sensitive-input" not in safe
    assert "withheld" in sanitized_startup_output(b"unknown private exception", tmp_path)
