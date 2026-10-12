import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "diagnose_portal_runtime", Path(__file__).resolve().parents[1] / "diagnose-portal-runtime.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DiagnosticsSafety(unittest.TestCase):
    def test_categories_do_not_emit_exception_text(self):
        for code, expected in [
            ("42P01", "missing_relation_or_column"), ("42703", "missing_relation_or_column"),
            ("42501", "insufficient_privilege"), ("28P01", "database_authentication"),
            ("08001", "database_connection"), ("57014", "timeout_or_lock"),
            ("55P03", "timeout_or_lock"), ("XX000", "database_or_runtime_failure"),
        ]:
            error = Exception("credential-bearing exception must not be returned")
            error.orig = type("DriverError", (), {"sqlstate": code})()
            self.assertEqual(module.failure_category(error), expected)

    def test_identity_fingerprint_is_stable_not_raw(self):
        self.assertEqual(module.fingerprint("synthetic-target"), module.fingerprint("synthetic-target"))
        self.assertNotIn("synthetic-target", module.fingerprint("synthetic-target"))
        self.assertNotEqual(module.fingerprint("a"), module.fingerprint("b"))

    def test_total_timeout_escapes_per_query_exception_catches(self):
        with self.assertRaises(module.DiagnosticTimeout):
            module.deadline(None, None)
        self.assertFalse(issubclass(module.DiagnosticTimeout, Exception))
