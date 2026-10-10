"""Operator gate evidence in historical, disposable populated PostgreSQL."""
from types import SimpleNamespace
import uuid

from alembic import command
from app.core.config import Settings
from app.services.directory_inventory import LEGACY_FIELDS as FIELDS, INDEX_COLUMNS
from app.services.directory_runtime import ready
from app.services.directory_crypto import DirectoryCrypto
from app.services.directory_staging import batch, freeze
from sqlalchemy import inspect, text, select
from sqlalchemy.orm import Session
import pytest
from test_migration_0006 import migration_db
from test_directory_staging import seed, runtime, snapshot


def stage(engine, config, runtime_role):
    settings = Settings()
    with Session(engine) as db:
        plan = freeze(db, settings, runtime_role=runtime_role)
    backup, change = str(uuid.uuid4()), str(uuid.uuid4())
    with Session(engine) as db:
        freeze(db, settings, runtime_role=runtime_role, execute=True, approval=plan["approval"],
               backup_ref=backup, change_ref=change, writes_paused=True, recovery_verified=True)
    for table in FIELDS:
        with Session(engine) as db:
            while batch(db, settings, table=table, limit=1)["remaining"]:
                pass
    config.cmd_opts = SimpleNamespace(x=[
        "directory_retirement_approved=yes", "directory_recovery_verified=yes",
        f"directory_backup_ref={backup}", f"directory_change_ref={change}",
    ])
    return settings


def test_populated_cutover_verified_same_transaction_preserves_operations(migration_db):
    engine, config, *_ = seed(migration_db)
    before = snapshot(engine)
    with runtime(engine) as (role, runtime_engine):
        settings = stage(engine, config, role)
        command.upgrade(config, "0030_directory_crypto_retirement")
        current = DirectoryCrypto(settings)
        with engine.connect() as connection:
            for table, fields in FIELDS.items():
                columns = {c["name"] for c in inspect(connection).get_columns(table)}
                assert not set(fields) & columns
                assert {f + "_ciphertext" for f in fields} <= columns
                for row in connection.execute(text(f"SELECT * FROM {table}")).mappings():
                    old = next(source for source in before[table] if source["id"] == row["id"])
                    for field in fields:
                        assert current.decrypt(table, row["id"], field, row[field + "_ciphertext"]) == old[field]
                    for field, value in old.items():
                        if field not in fields and not field.endswith("_ciphertext") and field not in INDEX_COLUMNS[table]:
                            assert row[field] == value
            for table in ("patients", "mr_profiles", "users", "files", "audit_events"):
                assert snapshot(engine)[table] == before[table]
        with Session(runtime_engine) as db:
            ready(db)  # minimal runtime SELECT only on the key check
        with pytest.raises(RuntimeError, match="backup"):
            command.downgrade(config, "0029_directory_crypto_additive")


@pytest.mark.parametrize("failure", ["unapproved", "incomplete", "corrupt", "index", "source", "operational", "wrong_backup"])
def test_failed_retirement_is_atomic_and_recoverable(migration_db, failure):
    engine, config, *_ = seed(migration_db)
    with runtime(engine) as (role, _):
        stage(engine, config, role)
        if failure == "unapproved":
            config.cmd_opts.x = []
        elif failure == "wrong_backup":
            config.cmd_opts.x[-2] = "directory_backup_ref=" + str(uuid.uuid4())
        else:
            expression = {
                "incomplete": "name_ciphertext=NULL",
                "corrupt": "name_ciphertext='invalid'",
                "index": "state_index=repeat('0',64)",
                "source": "name='Changed Synthetic Source'",
                "operational": "version=version+1",
            }[failure]
            with engine.begin() as connection:
                connection.execute(text("UPDATE doctor_directory SET " + expression))
        before = snapshot(engine)
        with pytest.raises(Exception):
            command.upgrade(config, "0030_directory_crypto_retirement")
        assert snapshot(engine) == before
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0029_directory_crypto_additive"
            assert connection.scalar(text("SELECT phase FROM directory_crypto_stage WHERE id=1")) == "frozen"
