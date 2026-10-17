#!/usr/bin/env python3
"""One-command Docker installation; host lock stays held by this supervisor."""
import fcntl
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

ACTIVE = Path("/var/www/admin-uat.allergyevexia.in")


def run(arguments):
    if not arguments or "--help" in arguments:
        print("Usage: python3 scripts/initialize-production.py "
              "--expected-database NAME --expected-system-identifier ID "
              "--expected-host HOST [--expected-port 5432] [--admin-hostname HOSTNAME]")
        return 0
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--expected-system-identifier", required=True, type=int)
    parser.add_argument("--expected-host", required=True)
    parser.add_argument("--expected-port", default=5432, type=int)
    parser.add_argument("--admin-hostname")
    parsed = parser.parse_args(arguments)
    if (not parsed.expected_database or not parsed.expected_host
            or not 0 < parsed.expected_system_identifier < 2**64
            or not 0 < parsed.expected_port < 65536):
        raise ValueError("Valid independently verified target required.")
    root = Path(__file__).resolve().parents[1]
    if root != ACTIVE or ACTIVE.resolve(strict=True) != ACTIVE:
        raise ValueError("Run from the canonical VPS project checkout.")
    for name in (".env", "docker-compose.yml"):
        if not (root / name).is_file() or (root / name).is_symlink():
            raise ValueError("Existing regular .env and Compose files required.")
    lock = root / ".deploy.lock"
    marker = root / ".operator-maintenance"
    descriptor = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise ValueError("Regular deployment lock required.")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        actual, opened = lock.lstat(), os.fstat(descriptor)
        if lock.resolve(strict=True) != lock or (actual.st_dev, actual.st_ino) != (opened.st_dev, opened.st_ino):
            raise ValueError("Canonical deployment lock identity changed.")
        # Existing markers are never overwritten, including dangling symlinks.
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump({"operation": "empty-database-initialization"}, stream)
            stream.flush()
            os.fsync(stream.fileno())
            marker_identity = os.fstat(stream.fileno())
        project = subprocess.check_output([
            "docker", "inspect", "--format",
            '{{ index .Config.Labels "com.docker.compose.project" }}',
            "evexia-backend"], text=True).strip()
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", project):
            raise ValueError("Existing backend Compose project could not be established.")
        compose = ["docker", "compose", "--project-name", project, "--project-directory", str(root),
                   "--env-file", str(root / ".env"), "-f", str(root / "docker-compose.yml")]
        # Build a candidate only. No service/container/volume replacement.
        subprocess.run(compose + ["build", "backend"], check=True, cwd=root)
        result = subprocess.run(compose + [
            "run", "--rm", "--no-deps", "--workdir", "/release-source",
            "-v", f"{root}:/release-source:ro", "-e", "APP_ENV=production",
            "-e", "PYTHONPATH=/release-source/artifacts/api-server/backend",
            "--entrypoint", "/workspace/.venv/bin/python", "backend",
            "-B", "-m", "app.initialize_database", *arguments], cwd=root)
        if result.returncode:
            print("INITIALIZATION_NOT_CONFIRMED: maintenance retained; inspect state before retry.", file=sys.stderr)
            return result.returncode
        observed = marker.lstat()
        if (observed.st_dev, observed.st_ino) != (marker_identity.st_dev, marker_identity.st_ino):
            raise ValueError("Maintenance marker changed; retained for review.")
        marker.unlink()
        print("INITIALIZATION_COMPLETE: maintenance cleared; normal deployment may proceed.")
        return 0
    finally:
        os.close(descriptor)


if __name__ == "__main__":
    try:
        sys.exit(run(sys.argv[1:]))
    except Exception:
        print("INITIALIZATION_BLOCKED: inspect checkout/lock/maintenance/build state. "
              "Existing maintenance is never cleared on failure.", file=sys.stderr)
        sys.exit(1)
