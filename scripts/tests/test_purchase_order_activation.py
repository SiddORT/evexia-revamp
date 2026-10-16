"""Pure safety-guard checks: never open a database or read credentials."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

SPEC = importlib.util.spec_from_file_location(
    "purchase_order_activation",
    Path(__file__).resolve().parents[1] / "activate-purchase-orders-development.py",
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DevelopmentTargetTests(unittest.TestCase):
    def args(self, **overrides):
        return SimpleNamespace(**{
            "approve_development": True, "confirm_database": "heliumdb",
            "confirm_host": "helium", **overrides,
        })

    def test_explicit_confirmed_development_is_accepted(self):
        MODULE.validate_target(SimpleNamespace(app_env="development"), self.args())

    def test_production_is_refused_even_with_approval(self):
        with self.assertRaises(RuntimeError):
            MODULE.validate_target(SimpleNamespace(app_env="production"), self.args())

    def test_test_database_is_not_claimed_as_development_activation(self):
        with self.assertRaises(RuntimeError):
            MODULE.validate_target(SimpleNamespace(app_env="test"), self.args())

    def test_missing_approval_is_refused(self):
        with self.assertRaises(RuntimeError):
            MODULE.validate_target(SimpleNamespace(app_env="development"),
                                   self.args(approve_development=False))

    def test_another_database_is_refused(self):
        with self.assertRaises(RuntimeError):
            MODULE.validate_target(SimpleNamespace(app_env="development"),
                                   self.args(confirm_database="another_database"))

    def test_vps_or_other_host_is_refused(self):
        with self.assertRaises(RuntimeError):
            MODULE.validate_target(SimpleNamespace(app_env="development"),
                                   self.args(confirm_host="vps.example.invalid"))


if __name__ == "__main__":
    unittest.main()
