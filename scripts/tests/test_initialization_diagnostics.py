"""Synthetic exceptions and mocked transactions only: no Docker/DB/network."""
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "artifacts/api-server/backend"))
from app import initialize_database as initializer
from app.services.initialization_diagnostics import exception_diagnostic
from pydantic import BaseModel, ValidationError
from sqlalchemy.exc import ProgrammingError, StatementError

ARGS = ["--expected-database", "synthetic", "--expected-system-identifier", "1",
        "--expected-host", "synthetic-host"]


class InitializationDiagnosticTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)

    def test_database_primary_and_sqlstate_without_sql_parameters_or_details(self):
        class UndefinedColumn(Exception):
            sqlstate = "42703"
            diag = SimpleNamespace(message_primary='column "missing_field" does not exist',
                                   table_name="storage_locations", column_name="missing_field")
        underlying = UndefinedColumn("DETAIL: unquoted-private-input")
        error = ProgrammingError("SELECT unquoted-private-sql", {"secret": "unquoted-private-parameter"},
                                 underlying)
        output = exception_diagnostic(error)
        self.assertIn("UndefinedColumn [SQLSTATE 42703]", output)
        self.assertIn("does not exist", output)
        self.assertIn("table_name=storage_locations", output)
        self.assertIn("column_name=missing_field", output)
        for value in ("unquoted-private-input", "unquoted-private-sql", "unquoted-private-parameter"):
            self.assertNotIn(value, output)

    def test_urls_dsn_assignments_and_quoted_values_are_redacted(self):
        output = exception_diagnostic(RuntimeError(
            'connection failed postgresql+psycopg://operator:p%40ss@db/private '
            "password=inline-value token:another-value 'quoted-data' \"private-data\""))
        self.assertIn("RuntimeError", output)
        for value in ("operator", "p%40ss", "inline-value", "another-value", "quoted-data", "private-data"):
            self.assertNotIn(value, output)
        self.assertNotIn("://", output)

    def test_known_secret_values_keyring_entries_and_encoded_passwords(self):
        password = "synthetic password@42"
        values = ("short-secret", "synthetic-key-value", password, quote(password, safe=""))
        with patch.dict(os.environ, {
            "SESSION_SECRET": values[0],
            "STAFF_ENCRYPTION_KEYS": json.dumps({"primary": values[1]}),
            "DATABASE_URL": "postgresql://operator:" + quote(password, safe="") + "@db/synthetic",
        }):
            output = exception_diagnostic(ValueError("invalid configuration " + " ".join(values)))
        self.assertIn("invalid configuration", output)
        for value in values:
            self.assertNotIn(value, output)

    def test_subprocess_arguments_stdout_and_stderr_are_not_rendered(self):
        error = subprocess.CalledProcessError(17, ["docker", "unsafe-command-private-value"],
                                             output="private-output", stderr="private-stderr")
        output = exception_diagnostic(error)
        self.assertIn("CalledProcessError", output)
        self.assertIn("status 17", output)
        self.assertNotIn("private", output)

    def test_validation_errors_show_fields_without_input_or_context(self):
        class Configuration(BaseModel):
            expected_port: int
        try:
            Configuration(expected_port="private-input-must-not-appear")
        except ValidationError as error:
            output = exception_diagnostic(error)
        self.assertIn("ValidationError", output)
        self.assertIn("expected_port", output)
        self.assertNotIn("private-input", output)

    def test_os_error_omits_filename_and_terminal_control_characters(self):
        output = exception_diagnostic(PermissionError(13, "Permission denied", "private-file-value"))
        self.assertIn("PermissionError", output)
        self.assertIn("Permission denied", output)
        self.assertNotIn("private-file-value", output)
        output = exception_diagnostic(RuntimeError("cannot proceed\x1b[31m\nprivate detail"))
        self.assertNotIn("\x1b", output)
        self.assertNotIn("\n", output)
        self.assertNotIn("private detail", output)

    def test_unrenderable_exception_fails_closed(self):
        class BadError(Exception):
            def __str__(self):
                raise RuntimeError("private-log-failure")
        self.assertEqual(exception_diagnostic(BadError()), "Exception: diagnostic unavailable; message withheld")

    def test_statement_error_without_orig_omits_sql_and_parameters(self):
        error = StatementError("cannot bind value", "private-sql", {"password": "private-parameter"}, None)
        output = exception_diagnostic(error)
        self.assertIn("cannot bind value", output)
        self.assertNotIn("private", output)

    def test_message_is_bounded_and_opaque_tokens_are_hidden(self):
        token = "x" * 48
        output = exception_diagnostic(RuntimeError(token + " failed; " + "message " * 200))
        self.assertNotIn(token, output)
        self.assertLess(len(output), 850)

    def test_backend_failure_rolls_back_disposes_and_reports_no_success(self):
        events = []

        @contextmanager
        def transaction():
            try:
                yield object()
            except Exception:
                events.append("rollback")
                raise
            else:
                events.append("commit")

        engine = SimpleNamespace(begin=transaction, dispose=Mock())
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(initializer, "get_settings", return_value=SimpleNamespace(
                database_url="postgresql://synthetic@db/synthetic")), \
                patch.object(initializer, "create_engine", return_value=engine) as create, \
                patch.object(initializer, "initialize", side_effect=RuntimeError("unsupported catalog operation")), \
                redirect_stdout(output), redirect_stderr(errors):
            self.assertEqual(initializer.main(ARGS), 1)
        self.assertEqual(events, ["rollback"])
        engine.dispose.assert_called_once_with()
        self.assertTrue(create.call_args.kwargs["hide_parameters"])
        self.assertIn("INITIALIZATION_ERROR: RuntimeError: unsupported catalog operation", errors.getvalue())
        self.assertIn("do not assume rollback", errors.getvalue())
        self.assertNotIn("INITIALIZATION_READY", output.getvalue())

    def test_backend_guard_failure_stays_blocked_before_opening_database(self):
        errors = io.StringIO()
        with patch.object(initializer, "get_settings", side_effect=initializer.fresh.FreshInstallBlocked(
                "Explicit valid target required.")), \
                patch.object(initializer, "create_engine") as create, redirect_stderr(errors):
            self.assertEqual(initializer.main(ARGS), 1)
        create.assert_not_called()
        self.assertIn("INITIALIZATION_BLOCKED: FreshInstallBlocked: Explicit valid target required.",
                      errors.getvalue())


if __name__ == "__main__":
    unittest.main()
