"""Synthetic unit checks; never read configured credentials or selected data."""
import asyncio
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
import io
from email.message import Message
from urllib.error import HTTPError
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "artifacts/api-server/backend"))
from app.core.development_identity import candidate_identity, LOADED_IDENTITY
from app.services.development_gate import DevelopmentGate, run_preflight

spec = importlib.util.spec_from_file_location("verify_development", ROOT / "scripts/verify-development-release.py")
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class GateTests(unittest.TestCase):
    def test_python_and_vite_hashes_match(self):
        javascript = subprocess.check_output(["node", "--input-type=module", "-e",
            "import {candidateIdentity} from './scripts/development-identity.mjs'; console.log(JSON.stringify(candidateIdentity()))"],
            cwd=ROOT)
        self.assertEqual(json.loads(javascript), candidate_identity())

    def test_runtime_cache_expires_and_new_source_cannot_pass_indefinitely(self):
        async def scenario():
            gate = DevelopmentGate()
            with patch("app.services.development_gate.run_preflight", return_value=True) as preflight:
                self.assertTrue(await gate.ready())
                self.assertTrue(await gate.ready())
                self.assertEqual(preflight.call_count, 1)
                gate.until = 0
                with patch("app.services.development_gate.candidate_identity",
                           return_value={**LOADED_IDENTITY, "source": "b" * 64}):
                    self.assertFalse(await gate.ready())
                self.assertEqual(preflight.call_count, 1)
        asyncio.run(scenario())

    def test_single_flight_and_explicit_recovery(self):
        async def scenario():
            gate = DevelopmentGate()
            with patch("app.services.development_gate.run_preflight", return_value=False) as probe:
                self.assertEqual(await asyncio.gather(*(gate.ready() for _ in range(20))), [False] * 20)
                self.assertEqual(probe.call_count, 1)
            gate.until = 0
            with patch("app.services.development_gate.run_preflight", return_value=True):
                self.assertTrue(await gate.ready())
        asyncio.run(scenario())

    def test_timeout_invalid_json_and_nonzero_are_fail_closed(self):
        for result in (
            subprocess.CompletedProcess([], 1, b'{"format":1,"ok":true}'),
            subprocess.CompletedProcess([], 0, b'<html>fallback</html>'),
            subprocess.CompletedProcess([], 0, b'{"format":2,"ok":true}'),
        ):
            with patch("subprocess.run", return_value=result):
                self.assertFalse(run_preflight())
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired([], 10)):
            self.assertFalse(run_preflight())

    def test_ingress_pass_and_stale_identity(self):
        identity = candidate_identity()
        candidate = {"format": 1, "identity": identity}
        runtime = {"format": 1, "identity": identity, "ready": True}
        def fetch(path):
            return candidate if path == "/__development-release" else runtime
        self.assertTrue(verifier.verify("https://synthetic.replit.dev", fetch)["ok"])
        runtime["identity"] = {**identity, "source": "b" * 64}
        self.assertFalse(verifier.verify("https://synthetic.replit.dev", fetch)["ok"])
        runtime["identity"] = identity
        runtime["ready"] = False
        self.assertFalse(verifier.verify("https://synthetic.replit.dev", fetch)["ok"])

    def test_ingress_503_cannot_report_success_from_a_ready_body(self):
        expected = json.loads(subprocess.check_output(
            ["node", str(ROOT / "scripts/frontend-runtime.mjs")], cwd=ROOT, timeout=10))
        identity = candidate_identity()
        candidate = json.dumps({**expected, "mode": "development", "assets": {}}).encode()
        runtime = json.dumps({"format": 1, "identity": identity, "ready": True}).encode()
        headers = Message()
        headers["Content-Type"] = "application/json"
        class Response(io.BytesIO):
            status = 200
            def __init__(self):
                super().__init__(candidate)
                self.headers = headers
            def geturl(self):
                return "https://synthetic.replit.dev/release-runtime.json"
        error = HTTPError("https://synthetic.replit.dev/api/v1/version",
                          503, "Unavailable", headers, io.BytesIO(runtime))
        with patch("urllib.request.urlopen", side_effect=[Response(), error]):
            result = verifier.verify("https://synthetic.replit.dev")
        self.assertFalse(result["ok"])
        self.assertEqual(result["checks"]["failure"], "unreachable_or_invalid_runtime")

    def test_no_mutation_or_regression_suite_in_recurring_scripts(self):
        for script in ("development-preflight.sh", "start-development-api.sh", "post-merge.sh"):
            source = (ROOT / "scripts" / script).read_text()
            self.assertNotIn("alembic upgrade", source)
            self.assertNotIn("validate:release", source)
            self.assertNotIn("bootstrap-super-admin", source)
        source = (ROOT / "scripts/start-development-api.sh").read_text()
        self.assertIn("set -eu", source)
        self.assertIn("exec python -m uvicorn", source)
        self.assertNotIn("development-preflight.sh", source)
        self.assertNotIn("verify-development-release.py", source)
        self.assertIn("development-sync.py", source)
        source = (ROOT / "scripts/post-merge.sh").read_text()
        self.assertIn("set -euo pipefail", source)
        self.assertIn("pnpm install --frozen-lockfile", source)
        self.assertIn("uv sync --frozen", source)
        self.assertNotIn("development-preflight.sh", source)
        self.assertNotIn("verify-development-release.py", source)
        self.assertIn("development-sync.py", source)
        launcher = (ROOT / "scripts/start-development-web.sh").read_text()
        self.assertIn("exec pnpm exec vite", launcher)
        self.assertNotIn("verify-running-release.py", launcher)
        self.assertNotIn("DEVELOPMENT_RUNNING_RELEASE_VERIFIED", launcher)
