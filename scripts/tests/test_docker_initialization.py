"""Cheap harness safety checks; real Docker coverage lives in its CI workflow."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[1] / "test-docker-initialization.py"
SPEC = importlib.util.spec_from_file_location("docker_initialization_smoke", PATH)
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


class DockerSmokeSafetyTests(unittest.TestCase):
    def make_smoke(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        return smoke.Smoke(scratch.name)

    def test_cli_refuses_non_github_hosted_environment_before_docker(self):
        for environment in ({}, {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "self-hosted"}):
            with patch.dict(smoke.os.environ, environment, clear=True), \
                 patch.object(smoke.sys, "argv", [str(PATH), "--disposable-ci-only"]), \
                 patch.object(smoke.Smoke, "prepare") as prepare:
                with self.assertRaisesRegex(AssertionError, "isolated GitHub-hosted"):
                    smoke.main()
                prepare.assert_not_called()

    def test_synthetic_children_do_not_inherit_application_or_docker_configuration(self):
        poison = {
            "DATABASE_URL": "never-inherit",
            "SESSION_SECRET": "never-inherit",
            "STAFF_ENCRYPTION_KEYS": "never-inherit",
            "DOCKER_HOST": "never-inherit",
            "DOCKER_CONTEXT": "never-inherit",
            "COMPOSE_FILE": "never-inherit",
            "PYTHONPATH": "never-inherit",
            "SSH_AUTH_SOCK": "never-inherit",
        }
        with patch.dict(smoke.os.environ, poison):
            fixture = self.make_smoke()
        self.assertTrue(set(poison).isdisjoint(fixture.env))
        self.assertNotEqual(fixture.env["HOME"], str(Path.home()))
        self.assertTrue(fixture.project.startswith("evexia-init-ci-"))

    def test_existing_containers_and_volumes_are_refused(self):
        fixture = self.make_smoke()
        for values in (["existing-container"], ["", "existing-volume"]):
            with patch.object(fixture, "docker", side_effect=values), \
                 patch.object(smoke.shutil, "copyfile") as copy:
                with self.assertRaisesRegex(AssertionError, "no existing"):
                    fixture.prepare()
                copy.assert_not_called()

    def test_container_or_volume_changes_fail_preservation_check(self):
        fixture = self.make_smoke()
        fixture.original = {"identity": "original"}
        with patch.object(fixture, "snapshot", return_value={"identity": "replacement"}):
            with self.assertRaisesRegex(AssertionError, "changed"):
                fixture.preserved()

    def test_cleanup_is_scoped_to_random_project_labels(self):
        fixture = self.make_smoke()
        with patch.object(fixture, "run") as run:
            run.return_value.stdout = "owned-resource\n"
            fixture.cleanup()
        for kind, listing, removal in zip(
            ("container", "network", "volume"), run.call_args_list[::2], run.call_args_list[1::2]
        ):
            self.assertEqual(listing.args[0], [
                "docker", kind, "ls", "-q", "--filter",
                f"label=com.docker.compose.project={fixture.project}",
            ])
            self.assertEqual(removal.args[0][-1], "owned-resource")
            self.assertNotIn("prune", removal.args[0])

    def test_credential_detection_does_not_echo_credential(self):
        fixture = self.make_smoke()
        fixture.secret_values = ["synthetic-sensitive-value"]
        with self.assertRaisesRegex(AssertionError, "printed a synthetic credential") as error:
            fixture.check_output("synthetic-sensitive-value")
        self.assertNotIn("synthetic-sensitive-value", str(error.exception))
