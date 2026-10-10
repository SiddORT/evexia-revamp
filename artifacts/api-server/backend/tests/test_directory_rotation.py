"""Final maintenance uses only historical synthetic disposable PostgreSQL."""
import base64
import json
import logging
import os
import subprocess
import sys
import uuid

from alembic import command
from pydantic import SecretStr
import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import directory_rotation as rotation
from app.services.directory_crypto import DirectoryCrypto
from app.services.directory_inventory import FIELDS, INDEX_COLUMNS
from app.services.directory_runtime import ready
from app.services.directory_staging import batch as stage_batch, StagingError
from test_directory_retirement import stage
from test_directory_staging import seed, runtime, snapshot
from test_migration_0006 import migration_db


def target(settings):
    keys = json.loads(settings.directory_encryption_keys.get_secret_value())
    keys["next"] = base64.b64encode(b"Z" * 32).decode()
    return settings.model_copy(update={"directory_encryption_keys": SecretStr(json.dumps(keys)),
                                       "directory_encryption_key_id": "next"})


def arm(engine, source, destination, **kwargs):
    with Session(engine) as db:
        plan = rotation.prepare(db, source, target_key_id=destination.directory_encryption_key_id,
                                next_keys=destination.directory_encryption_keys, **kwargs)
    with Session(engine) as db:
        result = rotation.prepare(db, source, target_key_id=destination.directory_encryption_key_id,
                                  next_keys=destination.directory_encryption_keys, execute=True,
                                  approval=plan["approval"], backup_ref=uuid.uuid4(), change_ref=uuid.uuid4(),
                                  writes_paused=True, recovery_verified=True, **kwargs)
    return result


def finish_batches(engine, settings):
    for table in FIELDS:
        with Session(engine) as db:
            while rotation.batch(db, settings, table=table, limit=1)["remaining"]:
                pass


def logical(data, crypto):
    for table, fields in FIELDS.items():
        for row in data[table]:
            for field in fields:
                row[field] = crypto.decrypt(table, row["id"], field, row.pop(field + "_ciphertext"))
            for column in INDEX_COLUMNS[table]:
                row.pop(column)
    return data


@pytest.mark.parametrize("revision", [rotation.REVISION, "head"])
def test_resumable_final_rotation_preserves_tombstones_graph_and_metadata(migration_db, monkeypatch, revision):
    engine, config, *_ = seed(migration_db)
    with runtime(engine) as (role, api):
        source = stage(engine, config, role)
        command.upgrade(config, revision)
        destination = target(source)
        before = logical(snapshot(engine), DirectoryCrypto(source))
        plan = arm(engine, source, destination)
        assert plan["status"] == "frozen"
        with Session(api) as db, pytest.raises(Exception):
            ready(db)
        with api.connect() as conn, pytest.raises(Exception):
            conn.execute(text("UPDATE patients SET version=version+1"))
        with Session(engine) as db, pytest.raises(StagingError):
            stage_batch(db, source, table="mr_directory")
        with Session(engine) as db:
            first = rotation.batch(db, destination, table="doctor_directory", limit=1)
            assert first["processed"] == first["remaining"] == 1
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.verify(db, destination, finish=True)
        with Session(engine) as db:
            assert rotation.verify(db, destination)["content_digest"] == plan["content_digest"]
        finish_batches(engine, destination)
        with Session(engine) as db:
            done = rotation.verify(db, destination, finish=True, expected_content_digest=plan["content_digest"])
        assert done["key_usage"] and set(done["key_usage"]) == {"next"}
        assert before == logical(snapshot(engine), DirectoryCrypto(destination))
        from app.services import directory_runtime
        monkeypatch.setattr(directory_runtime, "get_settings", lambda: destination)
        with Session(api) as db:
            ready(db)
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.verify(db, source)
        with Session(engine) as db:
            assert rotation.verify(db, destination)["content_digest"] == plan["content_digest"]
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT phase FROM directory_crypto_stage")) == "encrypted"
            if revision == "head":
                assert conn.scalar(text("SELECT to_regclass('role_hostnames')")) is not None


@pytest.mark.parametrize("failure", ["ciphertext", "aad", "index", "metadata", "owner", "authenticated_value"])
def test_full_verification_refuses_tamper_even_after_completed_batches(migration_db, failure):
    engine, config, *_ = seed(migration_db)
    with runtime(engine) as (role, _):
        source = stage(engine, config, role)
        command.upgrade(config, rotation.REVISION)
        destination = target(source)
        arm(engine, source, destination)
        finish_batches(engine, destination)
        statements = {
            "ciphertext": "UPDATE doctor_directory SET name_ciphertext='v1:next:corrupt'",
            "aad": "UPDATE doctor_directory SET name_ciphertext=phone_ciphertext",
            "index": "UPDATE doctor_directory SET state_index=repeat('0',64)",
            "metadata": "UPDATE doctor_directory SET version=version+1",
            "owner": "UPDATE patients SET version=version+1",
        }
        with engine.begin() as conn:
            if failure == "authenticated_value":
                record = conn.scalar(text("SELECT id FROM doctor_directory LIMIT 1"))
                conn.execute(text("UPDATE doctor_directory SET name_ciphertext=:value WHERE id=:id"),
                             dict(id=record, value=DirectoryCrypto(destination).encrypt(
                                 "doctor_directory", record, "name", "Changed synthetic value")))
            else:
                conn.execute(text(statements[failure]))
        before = snapshot(engine)
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.verify(db, destination, finish=True)
        assert snapshot(engine) == before
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT phase FROM directory_crypto_stage")) == "frozen"


@pytest.mark.parametrize("driver", ["postgresql", "postgresql+psycopg"])
def test_operator_cli_supports_application_urls_and_safe_reports(migration_db, driver):
    engine, config, *_ = seed(migration_db)
    with runtime(engine) as (role, _):
        source = stage(engine, config, role)
        command.upgrade(config, rotation.REVISION)
        env = dict(os.environ)
        env["DATABASE_URL"] = engine.url.set(drivername=driver).render_as_string(hide_password=False)
        process = subprocess.run([sys.executable, "-m", "app.services.directory_rotation", "verify"],
                                 env=env, capture_output=True, text=True, timeout=20)
        assert process.returncode == 0, "Disposable operator CLI failed"
        result = json.loads(process.stdout)
        assert result["status"] == "verified-current-transaction-only"
        assert result["counts"] == {"doctor_directory": 2, "mr_directory": 1,
                                    "patient_directory": 2, "patients": 2}
        assert "Synthetic" not in process.stdout
        assert not process.stderr
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT phase FROM directory_crypto_stage")) == "encrypted"


def test_revision_history_approval_and_configuration_boundaries(migration_db):
    engine, config, *_ = seed(migration_db)
    with runtime(engine) as (role, _):
        from app.core.config import Settings
        source = Settings()
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.prepare(db, source, runtime_role=role)
        source = stage(engine, config, role)
        command.upgrade(config, rotation.REVISION)
        destination = target(source)
        old_keys = json.loads(destination.directory_encryption_keys.get_secret_value())
        old_keys["primary"] = base64.b64encode(b"X" * 32).decode()
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.prepare(db, source, next_keys=SecretStr(json.dumps(old_keys)), target_key_id="next")
        with Session(engine) as db:
            plan = rotation.prepare(db, source, next_keys=destination.directory_encryption_keys, target_key_id="next")
        before = snapshot(engine)
        for kwargs in (
            dict(writes_paused=False, recovery_verified=True),
            dict(writes_paused=True, recovery_verified=False),
            dict(writes_paused=True, recovery_verified=True, backup_ref="invalid"),
            dict(writes_paused=True, recovery_verified=True, production_approved=False),
        ):
            prod = "production_approved" in kwargs
            refs = dict(backup_ref=uuid.uuid4(), change_ref=uuid.uuid4())
            refs.update(kwargs)
            with Session(engine) as db, pytest.raises(rotation.RotationError):
                rotation.prepare(db, source.model_copy(update={"app_env": "production"}) if prod else source,
                                 next_keys=destination.directory_encryption_keys, target_key_id="next",
                                 execute=True, approval=plan["approval"], **refs)
        assert snapshot(engine) == before
        # Unapproved added keys cannot bypass the anchored configuration.
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.verify(db, destination)
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT phase FROM directory_crypto_stage")) == "encrypted"


def test_anchor_renewal_and_independent_atomic_index_rekey(migration_db):
    engine, config, *_ = seed(migration_db)
    with runtime(engine) as (role, _):
        source = stage(engine, config, role)
        command.upgrade(config, rotation.REVISION)
        destination = target(source)
        before = snapshot(engine)
        arm(engine, source, destination, operation="configuration")
        assert snapshot(engine) == before
        with Session(engine) as db:
            rotation.verify(db, destination)
        new_index = SecretStr(base64.b64encode(b"Y" * 32).decode())
        with Session(engine) as db:
            plan = rotation.prepare(db, destination, operation="index", next_index_key=new_index)
        with Session(engine) as db:
            result = rotation.prepare(db, destination, operation="index", next_index_key=new_index,
                                      execute=True, approval=plan["approval"], backup_ref=uuid.uuid4(),
                                      change_ref=uuid.uuid4(), writes_paused=True, recovery_verified=True)
        assert result["status"] == "committed"
        rekeyed = destination.model_copy(update={"directory_index_key": new_index})
        after = snapshot(engine)
        for name in FIELDS:
            for original, changed in zip(before[name], after[name]):
                assert all(original[c] != changed[c] for c in INDEX_COLUMNS[name])
        assert logical(before, DirectoryCrypto(source)) == logical(after, DirectoryCrypto(rekeyed))
        with Session(engine) as db:
            assert rotation.verify(db, rekeyed)["content_digest"] == plan["content_digest"]


def test_stale_plan_roles_history_lock_and_logging_fail_closed(migration_db):
    engine, config, *_ = seed(migration_db)
    with runtime(engine) as (role, api):
        source = stage(engine, config, role)
        command.upgrade(config, rotation.REVISION)
        destination = target(source)
        with Session(api) as db, pytest.raises(rotation.RotationError):
            rotation.prepare(db, source)
        with Session(engine) as db:
            plan = rotation.prepare(db, source, target_key_id="next", next_keys=destination.directory_encryption_keys)
        with engine.begin() as conn:
            conn.execute(text("UPDATE patients SET version=version+1"))
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.prepare(db, source, target_key_id="next", next_keys=destination.directory_encryption_keys,
                             execute=True, approval=plan["approval"], backup_ref=uuid.uuid4(),
                             change_ref=uuid.uuid4(), writes_paused=True, recovery_verified=True)
        missing = SecretStr(json.dumps({"next": base64.b64encode(b"Z" * 32).decode()}))
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.prepare(db, source, target_key_id="next", next_keys=missing)
        arm(engine, source, destination)
        with engine.connect() as blocker:
            blocker.execute(text("SELECT id FROM patients"))
            with Session(engine) as db, pytest.raises(rotation.RotationError):
                rotation.batch(db, destination, table="doctor_directory")
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.batch(db, source, table="doctor_directory")
        logger = logging.getLogger("sqlalchemy.engine")
        level, disabled = logger.level, logger.disabled
        try:
            logger.disabled, logger.level = False, logging.INFO
            with Session(engine) as db, pytest.raises(rotation.RotationError):
                rotation.batch(db, destination, table="doctor_directory")
        finally:
            logger.level, logger.disabled = level, disabled


def test_batch_deadline_rolls_back_and_index_rekey_failure_is_atomic(migration_db, monkeypatch):
    engine, config, *_ = seed(migration_db)
    with runtime(engine) as (role, _):
        source = stage(engine, config, role)
        command.upgrade(config, rotation.REVISION)
        destination = target(source)
        arm(engine, source, destination)
        before = snapshot(engine)
        original = rotation.staging._deadline
        calls = 0
        def expire(start, seconds):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise rotation.RotationError()
        monkeypatch.setattr(rotation.staging, "_deadline", expire)
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.batch(db, destination, table="doctor_directory", limit=2)
        assert snapshot(engine) == before
        monkeypatch.setattr(rotation.staging, "_deadline", original)
        finish_batches(engine, destination)
        with Session(engine) as db:
            rotation.verify(db, destination, finish=True)
        new_index = SecretStr(base64.b64encode(b"Y" * 32).decode())
        with Session(engine) as db:
            plan = rotation.prepare(db, destination, operation="index", next_index_key=new_index)
        before = snapshot(engine)
        calls = 0
        def fail_rekey(start, seconds):
            nonlocal calls
            if seconds == 120:
                calls += 1
                # Fail after source inventory and the first rekey update.
                if calls == 19:
                    raise rotation.RotationError()
        monkeypatch.setattr(rotation.staging, "_deadline", fail_rekey)
        with Session(engine) as db, pytest.raises(rotation.RotationError):
            rotation.prepare(db, destination, operation="index", next_index_key=new_index,
                             execute=True, approval=plan["approval"], backup_ref=uuid.uuid4(),
                             change_ref=uuid.uuid4(), writes_paused=True, recovery_verified=True)
        assert snapshot(engine) == before
