"""Explicit read-only diagnostics through normal browser-facing ingress."""
import json
import os
import ssl
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "artifacts/api-server/backend"))


def verify(origin, fetch=None):
    if fetch is None:
        import importlib.util
        import subprocess
        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location("running_release", root / "scripts/verify-running-release.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        expected = json.loads(subprocess.check_output(
            ["node", str(root / "scripts/frontend-runtime.mjs")], cwd=root, timeout=10))
        return module.verify(origin, origin, expected, development=True)
    from app.core.development_identity import candidate_identity
    expected = candidate_identity()
    def read(path, allow503=False):
        if fetch:
            return fetch(path)
        request = urllib.request.Request(origin + path, headers={"Accept": "application/json", "Cache-Control": "no-cache"})
        try:
            response = urllib.request.urlopen(request, timeout=12,
                context=ssl.create_default_context(cafile="/etc/ssl/certs/ca-certificates.crt"))
        except urllib.error.HTTPError as exc:
            if not (allow503 and exc.code == 503):
                raise ValueError() from None
            response = exc
        with response:
            if response.geturl() != origin + path:
                raise ValueError()
            if response.headers.get_content_type() != "application/json":
                raise ValueError()
            raw = response.read(65537)
            if len(raw) > 65536:
                raise ValueError()
            body = json.loads(raw)
            # A failed HTTP status can never establish readiness, even if an
            # inconsistent body claims success.
            if response.status == 503 and (not isinstance(body, dict) or body.get("ready") is not False):
                raise ValueError()
            return body
    report = {"format": 1, "scope": "running-development-ingress", "ok": False,
              "checks": {"candidate": "pass", "ingress": "not_verified", "running_api": "not_verified", "readiness": "not_verified"}}
    try:
        candidate = read("/__development-release")
        if candidate != {"format": 1, "identity": expected}:
            report["checks"]["ingress"] = "incompatible_contract"
            return report
        report["checks"]["ingress"] = "pass"
        runtime = read("/api/v1/development/compatibility", True)
        if (not isinstance(runtime, dict) or set(runtime) != {"format", "identity", "ready"}
                or runtime["format"] != 1 or runtime["identity"] != expected):
            report["checks"]["running_api"] = "stale_or_incompatible_api"
            return report
        report["checks"]["running_api"] = "pass"
        report["checks"]["readiness"] = "pass" if runtime["ready"] is True else "setup_pending"
        report["ok"] = runtime["ready"] is True
    except Exception:
        report["checks"]["connection"] = "unavailable_or_invalid_json"
    return report


def main():
    import re
    import signal
    started = time.monotonic()
    # Domain is an input only, never printed or inferred as a production URL.
    host = os.environ.get("REPLIT_DEV_DOMAIN", "")
    if not re.fullmatch(r"[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.replit\.dev", host):
        print('{"ok":false,"checks":{"ingress":"development_hostname_unverified"}}')
        return 1
    from app.services.development_preflight import Deadline
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(Deadline()))
    signal.alarm(25)
    try:
        result = verify("https://" + host)
    except (Exception, Deadline):
        result = {"ok": False, "checks": {"ingress": "timeout_or_unverified"}}
    signal.alarm(0)
    result["elapsed_ms"] = round((time.monotonic() - started) * 1000)
    print(json.dumps(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
