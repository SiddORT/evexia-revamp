"""Actual dump/restore evidence for disposable socket-only test databases."""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import uuid
from contextlib import contextmanager

from sqlalchemy import create_engine, text


@contextmanager
def rehearsed_account_approval(engine, expose_restore=False):
    # Never turn this helper into a fixture that accepts configured/live URLs.
    socket = engine.url.query.get("host", "")
    if (not socket.startswith("/tmp/evexia-api-test.")
            or not Path(socket).is_dir() or engine.url.host not in (None, "")):
        raise RuntimeError("Account rehearsal requires the socket-only API test harness.")
    restored_name = "account_rehearsal_" + uuid.uuid4().hex
    source_url = engine.url.set(drivername="postgresql")
    restored_url = source_url.set(database=restored_name, query={"host": socket})
    with tempfile.TemporaryDirectory(prefix="evexia-account-evidence.", dir="/tmp") as directory:
        backup = Path(directory) / "backup.dump"
        subprocess.run(["pg_dump", "--format=custom", "--file", str(backup),
                        "--dbname", source_url.render_as_string(hide_password=False)],
                       check=True, capture_output=True, timeout=60)
        backup.chmod(0o600)
        subprocess.run(["createdb", "--maintenance-db",
                        source_url.render_as_string(hide_password=False), restored_name],
                       check=True, capture_output=True, timeout=30)
        restored = create_engine(engine.url.set(database=restored_name),
                                 hide_parameters=True)
        try:
            subprocess.run(["pg_restore", "--exit-on-error", "--no-owner", "--no-privileges",
                            "--dbname", restored_url.render_as_string(hide_password=False), str(backup)],
                           check=True, capture_output=True, timeout=60)
            with engine.connect() as original, restored.connect() as recovered:
                schema = original.scalar(text("SELECT current_schema()"))
                name, identifier = original.execute(text(
                    "SELECT current_database(), system_identifier FROM pg_catalog.pg_control_system()"
                )).one()
                quote = original.dialect.identifier_preparer.quote
                for table, order in (("users", "id"), ("account_identifier_reservations", "identifier")):
                    query = text(f"SELECT * FROM {quote(schema)}.{quote(table)} ORDER BY {quote(order)}")
                    if original.execute(query).all() != recovered.execute(query).all():
                        raise RuntimeError("Independent account restoration comparison failed.")
            # This attestation is reached only after a real successful restore,
            # never solely after digest verification or a fabricated/default file.
            arguments = [
                "account_crypto_approved=yes", "account_writers_stopped=yes",
                "account_backup_durable=yes", "account_restoration_rehearsal=yes",
                "account_external_consumers_reviewed=yes",
                f"account_expected_database={name}", f"account_expected_system_identifier={identifier}",
                f"account_backup={backup}",
                f"account_backup_sha256={hashlib.sha256(backup.read_bytes()).hexdigest()}",
            ]
            yield (arguments, restored) if expose_restore else arguments
        finally:
            restored.dispose()
            subprocess.run(["dropdb", "--maintenance-db",
                            source_url.render_as_string(hide_password=False), restored_name],
                           check=True, capture_output=True, timeout=30)
