#!/usr/bin/env python3
"""Exercise concurrent offline clones using synthetic data and private sockets."""
import importlib.util
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fixture_cache", ROOT / "scripts/test-fixture-cache.py")
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


def main():
    # Discard ambient database/auth/encryption configuration before any helpers.
    preserved = {name: os.environ[name] for name in ("PATH", "PYTHONPATH", "HOME") if name in os.environ}
    os.environ.clear()
    os.environ.update(preserved)
    os.environ["PYTHONPATH"] = str(ROOT / "artifacts/api-server/backend") + os.pathsep + preserved.get("PYTHONPATH", "")
    os.environ.update({name: "synthetic-cache-isolation-only" for name in cache.ENVIRONMENT})
    os.environ["APP_ENV"] = "test"
    with tempfile.TemporaryDirectory(prefix="evexia-release-cache.") as shared, \
            tempfile.TemporaryDirectory(prefix="evexia-api-test.") as original, \
            tempfile.TemporaryDirectory(prefix="evexia-api-test.") as first, \
            tempfile.TemporaryDirectory(prefix="evexia-api-test.") as second:
        os.environ["EVEXIA_TEST_CACHE_ROOT"] = shared
        username = subprocess.check_output(["id", "-un"]).decode().strip()
        fixtures = [Path(path) for path in (original, first, second)]

        def select(path):
            url = f"postgresql+psycopg://{username}@/evexia_api_test?host={path}/socket&port=5432"
            os.environ.update(DATABASE_URL=url, TEST_DATABASE_URL=url)
            return url

        def start(path):
            subprocess.run(["pg_ctl", "-D", str(path / "data"), "-l", str(path / "postgres.log"),
                            "-o", f"-k {path}/socket -p 5432 -c listen_addresses=''", "start"],
                           check=True, stdout=subprocess.DEVNULL)

        def action(verb, path):
            return subprocess.check_output([
                "python3", str(ROOT / "scripts/test-fixture-cache.py"), verb,
                str(path), "evexia_api_test",
            ], text=True).strip()

        try:
            for path in fixtures:
                (path / "socket").mkdir()
            select(fixtures[0])
            assert action("restore", fixtures[0]) == "miss"
            subprocess.run(["initdb", "-D", str(fixtures[0] / "data"), "-A", "trust",
                            "--no-locale", "--encoding=UTF8"], check=True, stdout=subprocess.DEVNULL)
            start(fixtures[0])
            subprocess.run(["createdb", "-h", str(fixtures[0] / "socket"), "-U", username,
                            "evexia_api_test"], check=True)
            engine = create_engine(select(fixtures[0]))
            revision = runpy.run_path(str(ROOT / "artifacts/api-server/backend/app/core/schema.py"))["SCHEMA_REVISION"]
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE alembic_version (version_num text)"))
                connection.execute(text("INSERT INTO alembic_version VALUES (:revision)"),
                                   {"revision": revision})
                for table in ("users", "auth_sessions", "refresh_sessions", "audit_events"):
                    connection.execute(text(f"CREATE TABLE {table} (id int)"))
                connection.execute(text("CREATE TABLE synthetic_rows (id int PRIMARY KEY)"))
            engine.dispose()
            assert action("save", fixtures[0]) == "published"
            # subprocesses avoid shared os.environ and exercise real file locking.
            def clone(path):
                environment = dict(os.environ)
                url = f"postgresql+psycopg://{username}@/evexia_api_test?host={path}/socket&port=5432"
                environment.update(DATABASE_URL=url, TEST_DATABASE_URL=url)
                result = subprocess.check_output([
                    "python3", str(ROOT / "scripts/test-fixture-cache.py"), "restore",
                    str(path), "evexia_api_test",
                ], env=environment, text=True)
                assert result.strip() == "hit"
                start(path)
                engine = create_engine(url)
                try:
                    with engine.begin() as connection:
                        assert connection.scalar(text("SELECT count(*) FROM synthetic_rows")) == 0
                        connection.execute(text("INSERT INTO synthetic_rows VALUES (1)"))
                finally:
                    engine.dispose()
            with ThreadPoolExecutor(max_workers=2) as pool:
                list(pool.map(clone, fixtures[1:]))
            # A write to each clone cannot reach the other or its template.
            engine = create_engine(select(fixtures[0]))
            with engine.connect() as connection:
                assert connection.scalar(text("SELECT count(*) FROM synthetic_rows")) == 0
            engine.dispose()
            assert (fixtures[1] / "data/base").stat().st_ino != (fixtures[2] / "data/base").stat().st_ino
            for name in ("PR_ENCRYPTION_KEYS", "PR_ENCRYPTION_KEY_ID"):
                previous = os.environ[name]
                os.environ[name] = "synthetic-changed"
                assert action("restore", fixtures[0]) == "miss"
                os.environ[name] = previous
            os.environ["DIRECTORY_ENCRYPTION_KEYS"] = "synthetic-changed"
            assert action("restore", fixtures[0]) == "miss"
            print("PASS: concurrent clones have independent data, socket-only listeners and no authenticated history.")
        finally:
            for path in fixtures:
                subprocess.run(["pg_ctl", "-D", str(path / "data"), "-m", "immediate", "stop"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
