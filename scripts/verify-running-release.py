#!/usr/bin/env python3
"""Verify loaded API identity, real readiness and served frontend bytes.

Expected build metadata must come from the candidate image/artifact, never from
the running HTTP response. Dev mode additionally compares local source identity.
"""
import argparse
import hashlib
import json
import re
import ssl
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "artifacts/api-server/backend"))


def get(origin, path, *, binary=False):
    url = origin.rstrip("/") + path
    with urlopen(Request(url, headers={"Cache-Control": "no-cache", "Accept": "*/*"}),
                 timeout=5, context=ssl.create_default_context(cafile="/etc/ssl/certs/ca-certificates.crt")) as response:
        if response.geturl() != url or response.status != 200:
            raise ValueError("Redirected or unhealthy runtime")
        body = response.read(16 * 1024 * 1024 + 1)
        if len(body) > 16 * 1024 * 1024:
            raise ValueError("Oversized runtime response")
        if binary:
            return body
        if response.headers.get_content_type() != "application/json":
            raise ValueError("Runtime returned non-JSON")
        return json.loads(body)


def verify(frontend, backend, expected, *, development=False, fetch=get):
    from app.core.development_identity import candidate_identity
    report = {"ok": False, "checks": {}}
    api_expected = candidate_identity()
    if expected.get("backend") != api_expected or expected.get("format") != 1:
        report["checks"]["candidate"] = "mismatched_build_metadata"
        return report
    try:
        actual = fetch(frontend, "/release-runtime.json")
        if development:
            if actual != {**expected, "mode": "development", "assets": {}}:
                raise ValueError("stale_frontend")
        elif actual != expected or expected.get("mode") != "build" or not expected.get("assets"):
            raise ValueError("stale_frontend")
        report["checks"]["running_frontend"] = "pass"
        runtime = fetch(backend, "/api/v1/version")
        if runtime != {"api": "v1", "release": api_expected}:
            raise ValueError("stale_backend")
        report["checks"]["running_backend"] = "pass"
        readiness = fetch(backend, "/api/v1/health/readiness")
        if readiness.get("status") not in ("ready", "ok"):
            raise ValueError("database_not_ready")
        report["checks"]["database_readiness"] = "pass"
        assets = actual["assets"]
        if len(assets) > 512:
            raise ValueError("invalid_asset_manifest")
        for name, digest in assets.items():
            if (not isinstance(name, str) or not name or name.startswith("/") or
                    any(p in ("", ".", "..") for p in name.split("/")) or
                    not re.fullmatch(r"[0-9a-f]{64}", digest)):
                raise ValueError("invalid_asset_manifest")
            body = fetch(frontend, "/" + quote(name, safe="/-._~"), binary=True)
            if hashlib.sha256(body).hexdigest() != digest:
                raise ValueError("stale_frontend_asset")
        report["checks"]["served_assets"] = "pass"
        report["ok"] = True
    except Exception as exc:
        reason = str(exc) if type(exc) is ValueError else "unreachable_or_invalid_runtime"
        report["checks"]["failure"] = reason
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend", required=True)
    parser.add_argument("--backend")
    parser.add_argument("--expected-frontend", type=Path)
    parser.add_argument("--development", action="store_true")
    args = parser.parse_args()
    try:
        for origin in (args.frontend, args.backend or args.frontend):
            parsed = urlsplit(origin)
            if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
                raise ValueError("An explicit origin without credentials/path is required")
        if args.development:
            expected = json.loads(subprocess.check_output(
                ["node", str(ROOT / "scripts/frontend-runtime.mjs")], cwd=ROOT, timeout=15))
        elif args.expected_frontend:
            expected = json.loads(args.expected_frontend.read_text())
        else:
            raise ValueError("Candidate image metadata required")
        result = verify(args.frontend, args.backend or args.frontend, expected, development=args.development)
        print(json.dumps(result))
        sys.exit(0 if result["ok"] else 1)
    except Exception:
        print('{"ok":false,"checks":{"failure":"unverified_runtime_inputs"}}')
        sys.exit(1)
