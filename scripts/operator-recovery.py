#!/usr/bin/env python3
"""Export retirement recovery using a separate Docker tooling container.

No migration, application startup, retirement approval, or service replacement.
The existing preflight remains responsible for database inventory and export.
"""
import argparse
import os
from pathlib import Path
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CONTAINER_ROOT = Path("/operator-release")


def canonical_path(value):
    path = Path(value)
    if not path.is_absolute() or path != path.resolve():
        raise ValueError("An absolute canonical path without symlink aliases is required.")
    return path


def command(args):
    recovery = canonical_path(args.recovery_dir)
    env_file = canonical_path(args.env_file)
    if not env_file.is_file() or not os.access(env_file, os.R_OK):
        raise ValueError("A readable existing production environment file is required.")
    # Check both the pinned checkout and active deployment directory on the host.
    # The original restricted_path() will check the mounted checkout again.
    if any(recovery.is_relative_to(workspace) for workspace in (ROOT, env_file.parent)):
        raise ValueError("Recovery must be outside the checkout and active deployment directory.")
    info = recovery.stat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077
            or info.st_uid != os.geteuid()):
        raise ValueError("An existing private operator-owned recovery directory is required.")
    name = args.backup_name
    if not name or name in (".", "..") or "/" in name or "\x00" in name:
        raise ValueError("Backup name must be a single filename.")
    backup = recovery / name
    if os.path.lexists(backup):
        raise ValueError("Backup already exists; it will not be overwritten.")
    if "," in str(recovery) or "," in str(ROOT):
        raise ValueError("Bind-mount paths containing commas are not supported.")
    if not args.image or args.image.startswith("-") or not args.network or args.network.startswith("-"):
        raise ValueError("A reviewed image and existing backend network are required.")
    backend = CONTAINER_ROOT / "artifacts/api-server/backend"
    return [
        "docker", "run", "--rm", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--network", args.network,
        "--user", f"{os.geteuid()}:{os.getegid()}",
        "--env-file", str(env_file),
        "-e", "APP_ENV=production",
        "-e", f"PYTHONPATH={backend}",
        "--mount", f"type=bind,src={ROOT},dst={CONTAINER_ROOT},readonly",
        "--mount", f"type=bind,src={recovery},dst={recovery}",
        "--workdir", str(backend),
        "--entrypoint", "/workspace/.venv/bin/python",
        args.image, "-B", "-m", "app.organization_preflight",
        "--backup", str(backup),
    ]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Pinned reviewed backend image.")
    parser.add_argument("--network", required=True, help="Existing backend Docker network.")
    parser.add_argument("--env-file", required=True, help="Absolute production environment-file path.")
    parser.add_argument("--recovery-dir", required=True, help="Existing external private directory.")
    parser.add_argument("--backup-name", default="recovery.json", help="New filename; never overwritten.")
    args = parser.parse_args(argv)
    try:
        return subprocess.run(command(args), check=False).returncode
    except (OSError, ValueError):
        print("OPERATOR_RECOVERY_FAILED: check canonical external paths, private ownership, "
              "new filename, installed Docker, and reviewed image/network.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
