#!/usr/bin/env python3
"""Issue a CI result or optional signed evidence after every release command passes.

Run on a clean checkout in validation infrastructure, never on the VPS.
No result is issued on failure. Optional private signing material stays external.
"""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "release_authorization", ROOT / "artifacts/api-server/backend/app/services/release_authorization.py")
authorization = importlib.util.module_from_spec(spec)
spec.loader.exec_module(authorization)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--signing-key", type=Path)
    mode.add_argument("--ci-report", action="store_true",
                      help="CI-only result; no signed recovery/retirement authority.")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        from cryptography.hazmat.primitives.serialization import load_pem_private_key
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        if git("status", "--porcelain", "--untracked-files=all").strip():
            raise ValueError("Clean committed checkout required")
        output = authorization.private_path(args.output, ROOT, missing=True)
        if output.exists():
            raise ValueError("Never overwrite release evidence")
        key = None
        if args.signing_key:
            key_path = authorization.private_path(args.signing_key, ROOT)
            key = load_pem_private_key(key_path.read_bytes(), password=None)
            if not isinstance(key, Ed25519PrivateKey):
                raise ValueError("Dedicated Ed25519 validation signing key required")
        rules = authorization.policy(ROOT)
        paths = git("ls-files", "-z").decode().strip("\0").split("\0")
        files = {}
        for name in paths:
            path = ROOT / name
            if not path.is_file() or path.resolve() != path:
                raise ValueError("Unsupported artifact file")
            files[name] = authorization.sha(path)
        commit = git("rev-parse", "HEAD").decode().strip()
        results = []
        for command in rules["validation_commands"]:
            invocation = command
            if os.environ.get("EVEXIA_RELEASE_PROFILE"):
                invocation = [
                    sys.executable, str(ROOT / "scripts/profile-release-command.py"),
                    "--output", os.environ["EVEXIA_RELEASE_PROFILE"],
                    "--label", "release:" + " ".join(command), "--", *command,
                ]
            code = subprocess.run(invocation, cwd=ROOT).returncode
            results.append(code)
            if code:
                print("RELEASE_VALIDATION_FAILED: no automatic authorization issued.")
                return 1
        if (git("rev-parse", "HEAD").decode().strip() != commit
                or git("status", "--porcelain", "--untracked-files=all").strip()
                or any(authorization.sha(ROOT / name) != digest for name, digest in files.items())):
            raise ValueError("Source changed during validation")
        payload = {
            "purpose": "evexia-release-validation-v1" if key else "evexia-ci-validation-v1", "commit": commit,
            "target": rules["final_target"], "files": files,
            "review_sha256": authorization.sha(ROOT / "scripts/fresh-install-review.json"),
            "commands": rules["validation_commands"], "results": results,
        }
        envelope = ({"payload": payload, "signature": base64.b64encode(
            key.sign(authorization.canonical(payload))).decode()} if key else payload)
        descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(envelope, stream)
            stream.flush()
            os.fsync(stream.fileno())
        print("RELEASE_VALIDATED: " + commit)
        return 0
    except Exception:
        print("RELEASE_VALIDATION_BLOCKED: no automatic authorization issued.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
