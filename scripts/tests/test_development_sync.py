"""No live connections: classifier, identity and actual HTTP-proof contracts."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "artifacts/api-server/backend"))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sync = load("dev_sync_tests", "development-sync.py")
runtime = load("running_release_tests", "verify-running-release.py")


class AdditiveTests(unittest.TestCase):
    def check(self, body, *, module="", success=False):
        source = ("from alembic import op\nimport sqlalchemy as sa\nrevision='next'\n"
                  "down_revision='previous'\nbranch_labels=depends_on=None\n" + module +
                  "\ndef upgrade():\n" + "".join("    " + line + "\n" for line in body.splitlines()) +
                  "\ndef downgrade():\n    pass\n")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "migration.py"
            path.write_text(source)
            if success:
                sync.additive(path)
            else:
                with self.assertRaises((sync.Blocked, ValueError)):
                    sync.additive(path)

    def test_nullable_addition(self):
        self.check("op.add_column('records',sa.Column('note',sa.Text(),nullable=True))", success=True)

    def test_new_table_and_index(self):
        self.check("op.create_table('notes',sa.Column('id',sa.Integer(),primary_key=True))\n"
                   "op.create_index('idx_notes','notes',['id'])", success=True)

    def test_unsafe_changes_rejected(self):
        for code in (
            "op.drop_table('users')", "op.execute('UPDATE users SET password_hash=NULL')",
            "op.alter_column('users','email',nullable=False)",
            "op.add_column('users',sa.Column('x',sa.Text(),nullable=False))",
            "op.add_column('users',sa.Column('x',sa.Text(),nullable=True,server_default='x'))",
            "op.create_index('x','users',['id'],postgresql_concurrently=True)",
            "op.add_column('users',sa.Column('x',sa.func.some_function(),nullable=True))",
            "op.add_column('users',sa.Column('x',sa.Text(),nullable=True),**options)",
            "for x in ['users']:\n    op.drop_table(x)",
        ):
            with self.subTest(code=code):
                self.check(code)

    def test_executable_import_or_module_state_rejected(self):
        for extra in ("import os\n", "revision = print('side effect')\n",
                      "def helper():\n    pass\n", "@side_effect()\ndef downgrade():\n    pass\n"):
            with self.subTest(extra=extra):
                self.check("pass", module=extra)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        from app.core.development_identity import candidate_identity
        self.expected = {"format": 1, "frontend": "a" * 64, "backend": candidate_identity(),
                         "mode": "build", "assets": {"index.html": hashlib.sha256(b"html").hexdigest(),
                                                    "assets/app.js": hashlib.sha256(b"js").hexdigest()}}
        self.responses = {"/release-runtime.json": copy.deepcopy(self.expected),
                          "/api/v1/version": {"api": "v1", "release": self.expected["backend"]},
                          "/api/v1/health/readiness": {"status": "ready"},
                          "/index.html": b"html", "/assets/app.js": b"js"}

    def verify(self, expected=None, development=False):
        return runtime.verify("http://frontend", "http://backend", expected or self.expected,
            development=development, fetch=lambda _origin, path, **kw: self.responses[path])

    def test_matching_running_build_and_asset_bytes(self):
        self.assertTrue(self.verify()["ok"])

    def test_same_git_but_stale_loaded_backend(self):
        self.responses["/api/v1/version"] = {"api": "v1", "release":
            {**self.expected["backend"], "source": "b" * 64}}
        self.assertFalse(self.verify()["ok"])

    def test_old_backend_without_runtime_proof(self):
        self.responses["/api/v1/version"] = {"api": "v1"}
        self.assertFalse(self.verify()["ok"])

    def test_stale_frontend_process(self):
        self.responses["/release-runtime.json"]["frontend"] = "c" * 64
        self.assertFalse(self.verify()["ok"])

    def test_new_metadata_with_old_served_javascript(self):
        self.responses["/assets/app.js"] = b"stale javascript"
        self.assertEqual(self.verify()["checks"]["failure"], "stale_frontend_asset")

    def test_live_health_without_schema_readiness_not_sufficient(self):
        self.responses["/api/v1/health/readiness"] = {"status": "unavailable"}
        self.assertFalse(self.verify()["ok"])

    def test_candidate_metadata_cannot_authorize_another_backend(self):
        expected = copy.deepcopy(self.expected)
        expected["backend"]["schema"] = "unreviewed"
        self.assertFalse(self.verify(expected)["ok"])

    def test_development_identity_and_build_mode_are_distinct(self):
        expected = {k: self.expected[k] for k in ("format", "frontend", "backend")}
        self.responses["/release-runtime.json"] = {**expected, "mode": "development", "assets": {}}
        self.assertTrue(self.verify(expected, development=True)["ok"])
        self.assertFalse(self.verify(expected)["ok"])

    def test_missing_and_traversing_assets_rejected(self):
        for assets in ({}, {"../outside": "0" * 64}):
            expected = {**self.expected, "assets": assets}
            self.responses["/release-runtime.json"] = expected
            self.assertFalse(self.verify(expected)["ok"])

    def test_python_and_javascript_backend_fingerprints_match(self):
        from app.core.development_identity import candidate_identity
        metadata = json.loads(subprocess.check_output(["node", str(ROOT / "scripts/frontend-runtime.mjs")]))
        self.assertEqual(metadata["backend"], candidate_identity())

    def test_ci_checks_images_and_runtime_before_reporting_promoted(self):
        source = (ROOT / ".github/workflows/deploy.yml").read_text()
        self.assertLess(source.index("run_policy --execute"), source.index("--force-recreate"))
        self.assertLess(source.index("docker cp"), source.index("run_policy --execute"))
        self.assertLess(source.index("verify-running-release.py"), source.index('echo "EVEXIA_DEPLOY_STATUS=promoted"'))
        self.assertIn("docker image inspect", source)
        self.assertIn('cancel-in-progress: false', source)
        self.assertIn('exit "$CODE"', source)


if __name__ == "__main__":
    unittest.main()
