#!/usr/bin/env python3
"""Run-local, offline PostgreSQL snapshots. Never cache a bootstrapped fixture.

Only the two synthetic harnesses call this, before API startup or pytest. A hit
is a physical COPY into a new private cluster, not a running template database.
No cache is persisted between release runs or uploaded by CI.
"""
import argparse
import fcntl
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
ENVIRONMENT = (
    "APP_ENV", "STAFF_ENCRYPTION_KEYS", "STAFF_ENCRYPTION_KEY_ID",
    "STAFF_EMAIL_INDEX_KEY", "DIRECTORY_ENCRYPTION_KEYS",
    "DIRECTORY_ENCRYPTION_KEY_ID", "DIRECTORY_INDEX_KEY",
    "COMMUNICATION_ENCRYPTION_KEYS", "COMMUNICATION_ENCRYPTION_KEY_ID",
    "PR_ENCRYPTION_KEYS", "PR_ENCRYPTION_KEY_ID",
    "JWT_SECRET", "SESSION_SECRET",
)
INPUTS = ("artifacts/api-server/backend/app", "artifacts/api-server/backend/alembic")
FILES = ("artifacts/api-server/backend/alembic.ini", "pyproject.toml", "uv.lock",
         "package.json", "pnpm-lock.yaml", "scripts/test-api-foundation.sh",
         "scripts/run-authenticated-previews.sh", "scripts/test-fixture-cache.py")


def fingerprint(database):
    digest = hashlib.sha256()
    for path in sorted(
        [ROOT / name for name in FILES]
        + [p for name in INPUTS for p in (ROOT / name).rglob("*")
           if p.is_file() and p.suffix not in (".pyc", ".pyo")]
    ):
        if "__pycache__" not in path.parts:
            digest.update(str(path.relative_to(ROOT)).encode() + b"\0")
            digest.update(path.read_bytes() + b"\0")
    # Locks capture declared deps; metadata also detects a locally different
    # installed environment, and binary identity prevents cross-version PGDATA.
    metadata = sorted((d.metadata["Name"], d.version)
                      for d in importlib.metadata.distributions())
    binary = Path(shutil.which("postgres")).resolve()
    digest.update(json.dumps({
        "database": database, "uid": os.getuid(),
        "python": sys.version, "dependencies": metadata,
        "postgres": str(binary),
        "postgres_version": subprocess.check_output([binary, "--version"]).decode(),
        "environment": {name: os.environ.get(name) for name in ENVIRONMENT},
    }, sort_keys=True).encode())
    return digest.hexdigest()


def private_directory(path, prefix):
    if (not path.is_absolute() or path.parent != Path("/tmp")
            or not path.name.startswith(prefix) or path.is_symlink()):
        raise ValueError("Expected a private disposable fixture directory")
    info = path.stat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError("Fixture directories must be owner-only")


def cache_root():
    value = os.environ.get("EVEXIA_TEST_CACHE_ROOT")
    if not value or os.environ.get("EVEXIA_DISABLE_FIXTURE_CACHE") == "1":
        return None
    path = Path(value)
    private_directory(path, "evexia-release-cache.")
    return path


def check_fixture(fixture, database):
    prefix = {"evexia_api_test": "evexia-api-test.",
              "evexia_auth_preview_test": "evexia-auth-preview."}[database]
    private_directory(fixture, prefix)
    if os.environ.get("APP_ENV") != "test":
        raise ValueError("Only synthetic APP_ENV=test fixtures may use snapshots")
    # Do not accept arbitrary connection strings or operator databases.
    expected = (f"postgresql+psycopg://{subprocess.check_output(['id', '-un']).decode().strip()}"
                f"@/{database}?host={fixture}/socket&port=5432")
    if (os.environ.get("DATABASE_URL") != expected
            or os.environ.get("TEST_DATABASE_URL") != expected):
        raise ValueError("Snapshot database must use this fixture's private socket")


def tree_digest(path):
    digest = hashlib.sha256()
    for item in sorted(path.rglob("*")):
        if item.is_symlink():
            raise ValueError("Snapshot cannot contain symlinks")
        if item.is_file():
            digest.update(str(item.relative_to(path)).encode() + b"\0")
            with item.open("rb") as stream:
                while block := stream.read(1024 * 1024):
                    digest.update(block)
    return digest.hexdigest()


def execute(action, fixture, database):
    check_fixture(fixture, database)
    cache = cache_root()
    if cache is None:
        return "disabled"
    key = fingerprint(database)
    entry = cache / key
    # Serialize publication only. Fixtures never share a live database, socket,
    # file inode, API listener, authenticated context, or a writable PGDATA.
    with (cache / (key + ".lock")).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if action == "restore":
            if not entry.exists():
                return "miss"
            manifest = json.loads((entry / "manifest.json").read_text())
            data = entry / "data"
            if (entry.is_symlink() or data.is_symlink()
                    or (data / "postmaster.pid").exists()
                    or manifest != {"key": key, "sha256": tree_digest(data)}):
                raise ValueError("Invalid fixture snapshot; refusing reuse")
            # copytree uses independent files (no hardlinks); target must not exist.
            shutil.copytree(data, fixture / "data")
            return "hit"
        if entry.exists():
            return "already-published"
        data = fixture / "data"
        # No login, bootstrap or test data may enter the cache. The snapshot is
        # setup-only; preserve every real migration test in its original suite.
        from sqlalchemy import create_engine, text
        from app.core.schema import SCHEMA_REVISION
        engine = create_engine(os.environ["DATABASE_URL"], hide_parameters=True)
        try:
            with engine.connect() as connection:
                if list(connection.scalars(text("SELECT version_num FROM alembic_version"))) != [SCHEMA_REVISION]:
                    raise ValueError("Only the exact application schema can be snapshotted")
                for table in ("users", "auth_sessions", "refresh_sessions", "audit_events"):
                    if connection.scalar(text(f"SELECT count(*) FROM {table}")):
                        raise ValueError("Refusing to snapshot identities or authenticated history")
        finally:
            engine.dispose()
        # This command is called only after successful migration and before
        # pytest/bootstrap. Clean stop is mandatory, not an optional fallback.
        subprocess.run(["pg_ctl", "-D", str(data), "-m", "fast", "stop"],
                       check=True, stdout=sys.stderr)
        if (data / "postmaster.pid").exists():
            raise ValueError("Cannot snapshot a running PostgreSQL cluster")
        staging = Path(tempfile.mkdtemp(prefix=".building-", dir=cache))
        try:
            shutil.copytree(data, staging / "data")
            (staging / "manifest.json").write_text(json.dumps({
                "key": key, "sha256": tree_digest(staging / "data"),
            }))
            staging.rename(entry)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
        subprocess.run([
            "pg_ctl", "-D", str(data), "-l", str(fixture / "postgres.log"),
            "-o", f"-k {fixture}/socket -p 5432 -c listen_addresses=''", "start",
        ], check=True, stdout=sys.stderr)
        return "published"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("restore", "save"))
    parser.add_argument("fixture", type=Path)
    parser.add_argument("database", choices=("evexia_api_test", "evexia_auth_preview_test"))
    args = parser.parse_args()
    start = time.monotonic()
    outcome = execute(args.action, args.fixture, args.database)
    print(outcome)
    print(f"FIXTURE_CACHE {args.action} {args.database} {outcome} "
          f"{time.monotonic() - start:.3f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
