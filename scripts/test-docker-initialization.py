#!/usr/bin/env python3
"""Destructive fixtures for a NEW, isolated GitHub-hosted Docker runner ONLY.

No application environment is inherited. No SSH, deployment integrations or
published targets are used. Only this run's labeled Compose resources are removed.
"""
import argparse
import base64
import fcntl
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time

SOURCE = Path(__file__).resolve().parents[1]
ACTIVE = Path("/var/www/admin-uat.allergyevexia.in")
PYTHON = "/workspace/.venv/bin/python"
# Reserved documentation domain with a public TLD accepted by the unchanged
# production hostname validator. This is stored only; no DNS/HTTP is performed.
HOSTNAME = "initialization.example.com"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


class Smoke:
    def __init__(self, scratch):
        self.scratch = Path(scratch)
        self.project = "evexia-init-ci-" + secrets.token_hex(6)
        # Do not inherit real DATABASE_URL, keys, Docker contexts, Compose
        # overrides, Python import paths, SSH agents or credential helpers.
        self.env = {
            "PATH": os.defpath + ":" + os.environ.get("PATH", ""),
            "HOME": scratch,
            "DOCKER_CONFIG": str(self.scratch / "docker"),
            "COMPOSE_PROJECT_NAME": "ci-deliberately-wrong-project",
            "COMPOSE_ANSI": "never",
            "PYTHONUNBUFFERED": "1",
        }
        self.compose = [
            "docker", "compose", "--project-name", self.project,
            "--project-directory", str(ACTIVE), "--env-file", str(ACTIVE / ".env"),
            "-f", str(ACTIVE / "docker-compose.yml"),
        ]
        self.original = None
        self.processes = []

    def run(self, command, *, check=True, **kwargs):
        return subprocess.run(command, env=self.env, text=True, capture_output=True,
                              check=check, timeout=600, **kwargs)

    def docker(self, *args):
        return self.run(["docker", *args]).stdout.strip()

    def prepare(self):
        require(not self.docker("ps", "-aq"), "Docker daemon must have no existing containers.")
        require(not self.docker("volume", "ls", "-q"), "Docker daemon must have no existing volumes.")
        require(ACTIVE.is_dir() and not ACTIVE.is_symlink()
                and ACTIVE.resolve() == ACTIVE and not list(ACTIVE.iterdir()),
                "Canonical fixture directory must be newly reserved and empty.")
        # Copy only repository files, never ignored .env files, caches or secrets.
        paths = self.run(["git", "-C", str(SOURCE), "ls-files", "-z",
                          "--cached", "--others", "--exclude-standard"]).stdout.split("\0")
        for name in filter(None, paths):
            relative = Path(name)
            require(not relative.is_absolute() and ".." not in relative.parts,
                    "Unsafe repository path.")
            if relative.name == ".env" or relative.name.startswith(".env."):
                continue
            source = SOURCE / relative
            require(source.is_file() and not source.is_symlink(), "Expected regular repository file.")
            destination = ACTIVE / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        key = lambda: base64.b64encode(secrets.token_bytes(32)).decode()
        self.password = secrets.token_urlsafe(32)
        settings = {
            "POSTGRES_DB": "initialization_ci",
            "POSTGRES_USER": "initialization_ci",
            "POSTGRES_PASSWORD": secrets.token_urlsafe(32),
            "SESSION_SECRET": secrets.token_urlsafe(48),
            "SUPER_ADMIN_INITIAL_PASSWORD": self.password,
            "APP_ENV": "production",
            "CORS_ORIGINS": f"https://{HOSTNAME}",
            "PORTAL_BOOTSTRAP_HOSTS": HOSTNAME,
            "TRUSTED_PROXY_PEERS": "127.0.0.1",
            "STAFF_EMAIL_INDEX_KEY": key(),
            "DIRECTORY_INDEX_KEY": key(),
        }
        for prefix in ("STAFF", "DIRECTORY", "COMMUNICATION", "PR"):
            settings[f"{prefix}_ENCRYPTION_KEYS"] = json.dumps({"primary": key()})
            settings[f"{prefix}_ENCRYPTION_KEY_ID"] = "primary"
        # Bare URL deliberately exercises the installed Psycopg 3 conversion.
        settings["DATABASE_URL"] = (
            "postgresql://initialization_ci:" + settings["POSTGRES_PASSWORD"]
            + "@postgres:5432/initialization_ci"
        )
        (ACTIVE / ".env").write_text("".join(f"{k}='{v}'\n" for k, v in settings.items()))
        (ACTIVE / ".env").chmod(0o600)
        self.secret_values = [v for k, v in settings.items()
                              if any(word in k for word in ("PASSWORD", "SECRET", "KEYS", "INDEX_KEY", "DATABASE_URL"))]
        # Original app containers intentionally idle: no application startup,
        # schema creation or network calls can interfere with the fixture.
        overlay = self.scratch / "original-services.yml"
        overlay.write_text(f"""services:
  backend:
    entrypoint: ["{PYTHON}", "-c"]
    command: ["import time; time.sleep(3600)"]
  frontend:
    build: !reset null
    image: {self.project}-backend
    entrypoint: ["{PYTHON}", "-c"]
    command: ["import time; time.sleep(3600)"]
""")
        self.run(self.compose + ["build", "backend"])
        self.run(self.compose + ["-f", str(overlay), "up", "-d", "--no-build"])
        for _ in range(90):
            ready = self.run(["docker", "exec", "evexia-postgres",
                              "pg_isready", "-h", "127.0.0.1", "-U", "initialization_ci"], check=False)
            if ready.returncode == 0:
                break
            time.sleep(1)
        else:
            raise AssertionError("Disposable PostgreSQL did not start.")
        require(self.sql("SHOW server_version_num").startswith("17"), "PostgreSQL 17 required.")
        self.cluster = self.sql("SELECT system_identifier FROM pg_control_system()")
        self.original = self.snapshot()
        require(self.original["backend"]["project"] == self.project
                and self.project != ACTIVE.name, "Fixture must use an existing non-default project.")

    def sql(self, query):
        return self.docker("exec", "evexia-postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1",
                           "-U", "initialization_ci", "-d", "initialization_ci", "-Atc", query)

    def snapshot(self):
        result = {}
        for service in ("postgres", "backend", "frontend"):
            row = json.loads(self.docker("inspect", f"evexia-{service}"))[0]
            result[service] = {
                "id": row["Id"], "image": row["Image"],
                "started": row["State"]["StartedAt"], "running": row["State"]["Running"],
                "restarts": row["RestartCount"],
                "project": row["Config"]["Labels"]["com.docker.compose.project"],
                "mounts": row["Mounts"],
            }
        volume = next(m["Name"] for m in result["postgres"]["mounts"] if m["Type"] == "volume")
        result["volume"] = json.loads(self.docker("volume", "inspect", volume))[0]
        result["containers"] = sorted(self.docker("ps", "-aq").splitlines())
        result["volumes"] = sorted(self.docker("volume", "ls", "-q").splitlines())
        return result

    def preserved(self):
        require(self.snapshot() == self.original,
                "Original containers/images/start times/mounts or PostgreSQL volume changed.")
        require(self.sql("SELECT system_identifier FROM pg_control_system()") == self.cluster,
                "PostgreSQL cluster changed.")

    def pristine(self):
        require(self.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n "
                         "ON n.oid=c.relnamespace WHERE n.nspname='public'") == "0",
                "Failed initialization left public relations behind.")
        require(self.sql("SELECT count(*) FROM pg_namespace WHERE nspname !~ '^pg_' "
                         "AND nspname NOT IN ('public','information_schema')") == "0",
                "Failed initialization left a schema behind.")

    def tool(self, code):
        return self.run(self.compose + [
            "run", "--rm", "--no-deps", "--workdir", "/release-source",
            "-v", f"{ACTIVE}:/release-source:ro", "-e", "APP_ENV=production",
            "-e", "PYTHONPATH=/release-source/artifacts/api-server/backend",
            "--entrypoint", PYTHON, "backend", "-B", "-c", code,
        ]).stdout

    def command(self, **changes):
        values = {"database": "initialization_ci", "system-identifier": self.cluster,
                  "host": "postgres", "port": "5432"}
        values.update(changes)
        return [sys.executable, "-B", str(ACTIVE / "scripts/initialize-production.py"),
                *[part for k, v in values.items() for part in (f"--expected-{k}", str(v))],
                "--admin-hostname", HOSTNAME]

    def check_output(self, output):
        require(all(value not in output for value in self.secret_values),
                "Initializer printed a synthetic credential.")

    def invoke(self, *, expected, message, **changes):
        result = self.run(self.command(**changes), check=False, cwd=ACTIVE)
        output = result.stdout + result.stderr
        self.check_output(output)
        require((result.returncode == 0) == expected and message in output,
                f"Unexpected initializer result for {message}: {output}")
        if expected:
            require('"result": "INITIALIZATION_READY"' in output,
                    "Supervisor success did not include the committed initialization result.")
        require((ACTIVE / ".operator-maintenance").exists() != expected,
                "Maintenance must clear only on confirmed success.")
        self.preserved()

    def clear_failed_marker(self):
        # Test-only operator action under the same lock, never production advice.
        with (ACTIVE / ".deploy.lock").open("r+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            marker = ACTIVE / ".operator-maintenance"
            require(json.loads(marker.read_text()) == {"operation": "empty-database-initialization"},
                    "Refusing to clear an unknown maintenance marker.")
            # Reconcile on a fresh connection before any test-only retry.
            # A nonzero initializer result alone does not establish rollback.
            require(self.sql("SELECT to_regclass('public.alembic_version') IS NULL") == "t",
                    "Revision exists after failed initialization; maintenance retained.")
            require(self.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n "
                             "ON n.oid=c.relnamespace WHERE n.nspname='public' "
                             "AND c.relkind IN ('r','p','v','m','S','f')") == "0",
                    "Initialization objects remain; maintenance retained.")
            require(self.sql("SELECT count(*) FROM pg_namespace WHERE nspname !~ '^pg_' "
                             "AND nspname NOT IN ('public','information_schema')") == "0",
                    "Initialization schemas remain; maintenance retained.")
            marker.unlink()

    def lock_and_atomic_failure(self):
        # A test-only import hook leaves all reviewed source/guards untouched.
        # Fail AFTER real catalog/bootstrap/hostname/readiness ran, proving
        # bootstrap and the entire historical graph share the outer transaction.
        hook = ACTIVE / "artifacts/api-server/backend/sitecustomize.py"
        require(not hook.exists(), "Refusing to overwrite an existing Python import hook.")
        hook.write_text("""import pathlib, time
from app import fresh_install
original = fresh_install.finalize
def fail_after_bootstrap(*args, **kwargs):
    original(*args, **kwargs)
    print("CI_BOOTSTRAP_REACHED", flush=True)
    deadline = time.monotonic() + 60
    while not pathlib.Path("/release-source/.ci-release").exists():
        if time.monotonic() > deadline:
            raise RuntimeError("CI release signal timed out")
        time.sleep(0.1)
    raise RuntimeError("CI failure after bootstrap")
fresh_install.finalize = fail_after_bootstrap
""")
        log_path = self.scratch / "atomic.log"
        try:
            with (ACTIVE / ".deploy.lock").open("a+") as lock, log_path.open("w") as log:
                fcntl.flock(lock, fcntl.LOCK_EX)
                process = subprocess.Popen(self.command(), cwd=ACTIVE, env=self.env,
                                           stdout=log, stderr=subprocess.STDOUT)
                self.processes.append(process)
                time.sleep(2)
                require(process.poll() is None and not (ACTIVE / ".operator-maintenance").exists(),
                        "Supervisor did not wait for the deployment host lock.")
                fcntl.flock(lock, fcntl.LOCK_UN)
                for _ in range(1200):
                    if "CI_BOOTSTRAP_REACHED" in log_path.read_text():
                        break
                    require(process.poll() is None, "Initialization failed before bootstrap: " + log_path.read_text())
                    time.sleep(0.1)
                else:
                    raise AssertionError("Bootstrap was not reached.")
                require((ACTIVE / ".operator-maintenance").is_file(), "Maintenance missing during initialization.")
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    pass
                else:
                    raise AssertionError("Host supervisor released the lock while Docker was running.")
                # Other connections must not see uncommitted schema/bootstrap.
                self.pristine()
                (ACTIVE / ".ci-release").touch()
                require(process.wait(timeout=60) != 0, "Injected post-bootstrap failure unexpectedly committed.")
            output = log_path.read_text()
            self.check_output(output)
            require("INITIALIZATION_FAILED" in output and "INITIALIZATION_NOT_CONFIRMED" in output,
                    "Expected transaction failure and retained-maintenance result.")
            self.pristine()
            require("CI_PRISTINE_OK" in self.tool("""
from sqlalchemy import create_engine
from app import fresh_install
from app.core.config import get_settings
engine = create_engine(get_settings().database_url.replace("postgresql://", "postgresql+psycopg://", 1))
with engine.connect() as connection:
    fresh_install.pristine(connection)
print("CI_PRISTINE_OK")
"""), "Rollback left database objects behind.")
            self.preserved()
            self.clear_failed_marker()
        finally:
            hook.unlink(missing_ok=True)
            (ACTIVE / ".ci-release").unlink(missing_ok=True)

    def exercise(self):
        require("CI_IMPORTS_OK" in self.tool("""
from pathlib import Path
from app import initialize_database, fresh_install
for module in (initialize_database, fresh_install):
    assert Path(module.__file__).is_relative_to("/release-source/artifacts/api-server/backend")
assert Path("/app/app/initialize_database.py").is_file()
assert Path("/release-source").stat().st_dev != 0
try:
    Path("/release-source/.ci-mount-must-be-readonly").touch()
except OSError:
    pass
else:
    raise AssertionError("Source mount is writable")
print("CI_IMPORTS_OK")
"""), "Mounted imports were not verified.")
        marker = ACTIVE / ".operator-maintenance"
        marker.write_text("another operator")
        marker_inode = marker.stat().st_ino
        self.invoke(expected=False, message="INITIALIZATION_BLOCKED")
        require(marker.read_text() == "another operator" and marker.stat().st_ino == marker_inode,
                "Existing maintenance marker was overwritten.")
        marker.unlink()
        for wrong in ({"host": "wrong.invalid"}, {"port": "1"},
                      {"database": "wrong_database"},
                      {"system-identifier": str(int(self.cluster) + 1)}):
            self.invoke(expected=False, message="INITIALIZATION_BLOCKED:", **wrong)
            self.pristine()
            self.clear_failed_marker()
        for create, drop in (
            ("CREATE TABLE alembic_version(version_num varchar(64))", "DROP TABLE alembic_version"),
            ("CREATE SCHEMA existing_app", "DROP SCHEMA existing_app"),
            ("CREATE TABLE existing_data(id int); INSERT INTO existing_data VALUES (7)", "DROP TABLE existing_data"),
        ):
            self.sql(create)
            before = self.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n "
                              "ON n.oid=c.relnamespace WHERE n.nspname='public'")
            self.invoke(expected=False, message="INITIALIZATION_BLOCKED:")
            require(self.sql("SELECT to_regclass('users') IS NULL") == "t", "Existing schema was migrated.")
            require(self.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n "
                             "ON n.oid=c.relnamespace WHERE n.nspname='public'") == before,
                    "Existing relations changed.")
            if "existing_data" in create:
                require(self.sql("SELECT id FROM existing_data") == "7", "Existing data changed.")
            if "existing_app" in create:
                require(self.sql("SELECT count(*) FROM pg_namespace WHERE nspname='existing_app'") == "1",
                        "Existing schema was removed.")
            self.sql(drop)  # Only synthetic objects created immediately above.
            self.pristine()
            self.clear_failed_marker()
        self.lock_and_atomic_failure()
        self.invoke(expected=True, message="INITIALIZATION_COMPLETE")
        require("CI_READY_OK" in self.tool(f"""
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from app import fresh_install as fresh
from app.api.v1.system import readiness
from app.bootstrap import SUPER_ADMIN_EMAIL
from app.core.config import get_settings
from app.core.security import verify_password
from app.db.models import User
from app.services.account_crypto import read
settings = get_settings()
engine = create_engine(settings.database_url.replace("postgresql://", "postgresql+psycopg://", 1))
with engine.connect() as connection:
    fresh.catalog(connection, fresh.FINAL_TARGET)
    fresh.communication_channels(connection)
with Session(engine) as db:
    users = list(db.scalars(select(User)))
    assert len(users) == 1
    user = users[0]
    assert user.is_protected_system_admin and user.system_role == "super_admin"
    assert user.email_ciphertext != SUPER_ADMIN_EMAIL
    assert read(user.id, "email", user.email_ciphertext, user.email_index) == SUPER_ADMIN_EMAIL
    assert verify_password(settings.super_admin_initial_password.get_secret_value(), user.password_hash)
    readiness(db)
print("CI_READY_OK")
"""), "Bootstrap/catalog/readiness verification failed.")
        target = json.loads((ACTIVE / "development-contract.json").read_text())["schema"]
        require(self.sql("SELECT version_num FROM alembic_version") == target, "Wrong committed revision.")
        require(self.sql("SELECT hostname FROM role_hostnames") == HOSTNAME, "Hostname not committed.")
        before = self.sql("SELECT id::text || password_hash || email FROM users")
        self.invoke(expected=False, message="Database is not pristine")
        require(self.sql("SELECT id::text || password_hash || email FROM users") == before,
                "Repeat initialization changed account credentials.")
        # This is a deliberately initialized database, not an empty rollback.
        # Preserve the failed-repeat marker until disposable fixture cleanup.
        require((ACTIVE / ".operator-maintenance").is_file(),
                "Failed repeat must retain maintenance for inspection.")
        self.preserved()

    def cleanup(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        # No global prune/down -v. Remove only resources with OUR random label,
        # after preservation assertions; never match production project names.
        for kind in ("container", "network", "volume"):
            result = self.run(["docker", kind, "ls", "-q", "--filter",
                               f"label=com.docker.compose.project={self.project}"], check=False)
            for resource in result.stdout.split():
                args = ["docker", kind, "rm"]
                if kind == "container":
                    args.append("-f")
                self.run([*args, resource], check=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disposable-ci-only", required=True, action="store_true")
    parser.parse_args()
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted",
            "Run only on an isolated GitHub-hosted CI runner, never a VPS or shared Docker host.")
    with tempfile.TemporaryDirectory(prefix="evexia-docker-init-ci-") as scratch:
        smoke = Smoke(scratch)
        try:
            smoke.prepare()
            smoke.exercise()
            print("DOCKER_INITIALIZATION_SMOKE_OK: atomic install, guards, locks and original resources verified.")
        finally:
            smoke.cleanup()


if __name__ == "__main__":
    main()
