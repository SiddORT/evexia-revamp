"""Snapshot safety and timing contracts; no configured database is used."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("fixture_cache", ROOT / "scripts/test-fixture-cache.py")
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class CacheContracts(unittest.TestCase):
    def test_disabled_by_default_and_explicit_baseline(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(cache.cache_root())
        with patch.dict(os.environ, {"EVEXIA_DISABLE_FIXTURE_CACHE": "1",
                                     "EVEXIA_TEST_CACHE_ROOT": "/not/a/cache"}, clear=True):
            self.assertIsNone(cache.cache_root())

    def test_private_root_and_symlinks(self):
        with tempfile.TemporaryDirectory(prefix="evexia-release-cache.") as directory:
            path = Path(directory)
            cache.private_directory(path, "evexia-release-cache.")
            path.chmod(0o755)
            with self.assertRaises(ValueError):
                cache.private_directory(path, "evexia-release-cache.")
            path.chmod(0o700)
            with tempfile.TemporaryDirectory() as other:
                link = Path(other) / "evexia-release-cache.link"
                link.symlink_to(path, target_is_directory=True)
                with self.assertRaises(ValueError):
                    cache.private_directory(link, "evexia-release-cache.")

    def test_reject_nonfixture_database_and_production(self):
        with tempfile.TemporaryDirectory(prefix="evexia-api-test.") as directory:
            fixture = Path(directory)
            with patch.dict(os.environ, {"APP_ENV": "production"}, clear=True):
                with self.assertRaises(ValueError):
                    cache.check_fixture(fixture, "evexia_api_test")
            with patch.dict(os.environ, {"APP_ENV": "test", "DATABASE_URL":
                                         "postgresql://operator/db"}, clear=True):
                with self.assertRaises(ValueError):
                    cache.check_fixture(fixture, "evexia_api_test")

    def test_schema_dependencies_and_synthetic_keys_invalidate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "schema.py").write_text("schema-a")
            (root / "lock").write_text("deps-a")
            with patch.object(cache, "ROOT", root), patch.object(cache, "INPUTS", ()), \
                    patch.object(cache, "FILES", ("schema.py", "lock")), \
                    patch.dict(os.environ, {}, clear=True), \
                    patch.object(cache.shutil, "which", return_value="/bin/postgres"), \
                    patch.object(cache.subprocess, "check_output", return_value=b"PG17"), \
                    patch.object(cache.importlib.metadata, "distributions", return_value=[]):
                original = cache.fingerprint("evexia_api_test")
                self.assertNotEqual(original, cache.fingerprint("evexia_auth_preview_test"))
                for filename in ("schema.py", "lock"):
                    old = (root / filename).read_text()
                    (root / filename).write_text(old + "-changed")
                    self.assertNotEqual(original, cache.fingerprint("evexia_api_test"))
                    (root / filename).write_text(old)
                for name in cache.ENVIRONMENT:
                    with patch.dict(os.environ, {name: "synthetic-changed"}):
                        self.assertNotEqual(original, cache.fingerprint("evexia_api_test"), name)

    def test_copies_do_not_share_inodes_or_mutations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "row").write_text("pristine")
            digest = cache.tree_digest(source)
            cache.shutil.copytree(source, root / "a")
            cache.shutil.copytree(source, root / "b")
            self.assertNotEqual((root / "a/row").stat().st_ino, (root / "b/row").stat().st_ino)
            (root / "a/row").write_text("mutated")
            self.assertEqual((root / "b/row").read_text(), "pristine")
            self.assertEqual(cache.tree_digest(source), digest)
            (source / "link").symlink_to(source / "row")
            with self.assertRaises(ValueError):
                cache.tree_digest(source)

    def test_corruption_is_failure_not_a_silent_miss(self):
        with tempfile.TemporaryDirectory(prefix="evexia-release-cache.") as directory:
            root = Path(directory)
            entry = root / "key"
            (entry / "data").mkdir(parents=True)
            (entry / "data/row").write_text("changed")
            (entry / "manifest.json").write_text(json.dumps({"key": "key", "sha256": "old"}))
            with patch.object(cache, "check_fixture"), patch.object(cache, "cache_root", return_value=root), \
                    patch.object(cache, "fingerprint", return_value="key"):
                with self.assertRaises(ValueError):
                    cache.execute("restore", root / "fixture", "evexia_api_test")

    def test_live_cluster_is_never_restored(self):
        with tempfile.TemporaryDirectory(prefix="evexia-release-cache.") as directory:
            root = Path(directory)
            entry = root / "key"
            (entry / "data").mkdir(parents=True)
            (entry / "data/postmaster.pid").write_text("1234")
            (entry / "manifest.json").write_text(json.dumps({
                "key": "key", "sha256": cache.tree_digest(entry / "data"),
            }))
            with patch.object(cache, "check_fixture"), patch.object(cache, "cache_root", return_value=root), \
                    patch.object(cache, "fingerprint", return_value="key"):
                with self.assertRaises(ValueError):
                    cache.execute("restore", root / "fixture", "evexia_api_test")

    def test_ci_caches_only_downloads_with_exact_invalidation(self):
        workflow = (ROOT / ".github/workflows/release-validation.yml").read_text()
        section = workflow.split("- uses: actions/cache@v4", 1)[1].split("- name:", 1)[0]
        self.assertNotIn("restore-keys:", section)
        self.assertNotIn("evexia-release-cache", section)
        for source in ("uv.lock", "pnpm-lock.yaml", "backend/alembic/**",
                       "test-api-foundation.sh", "run-authenticated-previews.sh",
                       "test-fixture-cache.py"):
            self.assertIn(source, section)
        self.assertIn("playwright install --with-deps chromium firefox webkit", workflow)

    def test_timing_retains_failure_and_argument_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "profile.jsonl"
            result = subprocess.run([
                sys.executable, str(ROOT / "scripts/profile-release-command.py"),
                "--output", str(output), "--label", "failure", "--",
                sys.executable, "-c", "import sys; assert sys.argv[1] == 'two words'; sys.exit(7)",
                "two words",
            ], capture_output=True)
            self.assertEqual(result.returncode, 7)
            row = json.loads(output.read_text())
            self.assertEqual(row["returncode"], 7)
            self.assertGreaterEqual(row["seconds"], 0)
            self.assertNotIn("command", row)
            self.assertEqual(result.stdout, b"")
            self.assertIn(b"RELEASE_TIMING", result.stderr)

    def test_profiles_success_without_changing_captured_command_output(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([
                sys.executable, str(ROOT / "scripts/profile-release-command.py"),
                "--output", str(Path(directory) / "profile.jsonl"), "--label", "cache", "--",
                sys.executable, "-c", "print('hit')",
            ], capture_output=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, b"hit\n")


if __name__ == "__main__":
    unittest.main()
