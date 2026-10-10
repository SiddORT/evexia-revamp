"""Populated additive upgrades and offline maintenance in disposable PostgreSQL."""
from contextlib import contextmanager
from datetime import date
import logging
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

from alembic import command
from pydantic import SecretStr
import pytest
from sqlalchemy import MetaData, Table, create_engine, inspect, select, text
from sqlalchemy.orm import Session

from app.db.models import Patient
from app.db.doctor_models import DoctorDirectory
from app.db.patient_models import PatientDirectory
from app.schemas.doctors import DoctorFields, DoctorDeletion
from app.schemas.patients import PatientFields, PatientDeletion
from app.services import doctors, patients
from app.services.directory_crypto import DirectoryCrypto
from app.services.directory_inventory import LEGACY_FIELDS as FIELDS, INDEX_COLUMNS
from app.services.directory_staging import batch, freeze, verify, StagingError
from app.services import directory_staging
from test_directory_crypto import settings, b64
from test_migration_0006 import migration_db
from test_migration_patients import prepare
from test_migration_zones import identity
from test_doctors import fields as doctor_fields
from test_patients import fields


def seed(fixture):
    # Seed through the HISTORICAL plaintext schema, not the encrypted ORM.
    # These synthetic values are intentionally restricted to disposable DBs.
    from datetime import datetime, timezone
    from app.schemas.mrs import MRFields
    from test_mrs import fields as mr_fields, DESIGNATION_ID
    engine, config = fixture
    command.upgrade(config, "0029_role_lifecycle")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0029_role_lifecycle"
    actor_id, sid, mr_id, zone, hq = (uuid.uuid4() for _ in range(5))
    now = datetime.now(timezone.utc)
    metadata = MetaData()
    with engine.begin() as connection:
        def insert(table, data):
            reflected = Table(table, metadata, autoload_with=connection, resolve_fks=False)
            connection.execute(reflected.insert(), data)
        insert("users", dict(id=actor_id, email=MRFields(**mr_fields(hq, zone)).email,
                            password_hash="synthetic-not-a-login", system_role="mr",
                            username="synthetic.mr", is_protected_system_admin=False,
                            is_active=False, token_version=0, identity_version=1))
        common = dict(created_by=actor_id, updated_by=actor_id, created_at=now, updated_at=now, version=1)
        insert("zones", dict(id=zone, name="Staging Zone", status="active", **common))
        insert("headquarters", dict(id=hq, name="Staging HQ", state_code="DL", status="active", **common))
        insert("designations", dict(id=DESIGNATION_ID, name="Medical Representative", shortName="MR", status="active", **common))
        insert("mr_profiles", dict(id=mr_id, user_id=actor_id, is_active=False, version=1,
                                  created_at=now, updated_at=now))
        mr_values = MRFields(**mr_fields(hq, zone)).model_dump(exclude={"userId"})
        mr_values["status"] = "inactive"
        insert("mr_directory", dict(id=mr_id, **mr_values, **common))
        mr = dict(id=mr_id)
        doctor = dict(id=uuid.uuid4(), **DoctorFields(**doctor_fields(mr)).model_dump())
        insert("doctor_directory", dict(**doctor, verification="unverified", **common))
        tombstone = dict(id=uuid.uuid4(), **DoctorFields(**doctor_fields(
            mr, name="Deleted Synthetic Doctor", registrationNumber="RETIRED-SYNTHETIC")).model_dump())
        insert("doctor_directory", dict(**tombstone, verification="unverified", deleted_at=now, deleted_by=actor_id, **common))
        one = dict(id=uuid.uuid4())
        for index, record in enumerate((one, dict(id=uuid.uuid4()))):
            insert("patients", dict(id=record["id"], assigned_mr_id=mr_id, is_active=index == 0, version=1,
                                    created_at=now, updated_at=now))
            values = PatientFields(**fields(doctor, name="Synthetic Patient" if not index else "Deleted Synthetic",
                                            phone="9000000000" if not index else "9000000001")).model_dump()
            insert("patient_directory", dict(**record, code=f"PAT-STAGING-{index}", **values,
                created_by=actor_id, updated_by=actor_id, created_at=now, updated_at=now,
                deleted_at=now if index else None, deleted_by=actor_id if index else None))
        insert("audit_events", dict(id=uuid.uuid4(), actor_id=actor_id, action="synthetic-staging",
                                   resource_type="patient", resource_id=one["id"], outcome="success"))
    # A populated, already-applied role revision must advance additively without
    # re-running or rewriting that revision, before the guarded retirement tests.
    command.upgrade(config, "0029_directory_crypto_additive")
    with engine.connect() as connection:
        assert list(connection.scalars(text("SELECT version_num FROM alembic_version"))) == ["0029_directory_crypto_additive"]
    return engine, config, actor_id, sid, mr, doctor, one


@contextmanager
def runtime(engine):
    """Separate login with scoped DML, no ownership/maintenance-role inheritance."""
    role = "directory_runtime_" + uuid.uuid4().hex[:16]
    with engine.begin() as conn:
        schema = conn.scalar(text("SELECT current_schema()"))
        quoted = conn.dialect.identifier_preparer.quote_schema(schema)
        conn.execute(text(f'CREATE ROLE "{role}" LOGIN'))
        conn.execute(text(f'GRANT USAGE ON SCHEMA {quoted} TO "{role}"'))
        for table in (*FIELDS, "patients"):
            conn.execute(text(f'GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON {quoted}.{table} TO "{role}"'))
    separate = create_engine(engine.url.set(username=role), hide_parameters=True)
    try:
        yield role, separate
    finally:
        separate.dispose()
        with engine.begin() as conn:
            conn.execute(text(f'DROP OWNED BY "{role}"'))
            conn.execute(text(f'DROP ROLE "{role}"'))


def armed(engine, config, role):
    with Session(engine) as db:
        plan = freeze(db, config, runtime_role=role)
        return freeze(db, config, runtime_role=role, execute=True, approval=plan["approval"],
                      backup_ref=uuid.uuid4(), change_ref=uuid.uuid4(),
                      writes_paused=True, recovery_verified=True)


def finish(engine, config, *, limit=1):
    for table in FIELDS:
        while True:
            with Session(engine) as db:
                result = batch(db, config, table=table, limit=limit)
            if not result["remaining"]:
                break


def snapshot(engine):
    with engine.connect() as conn:
        names = (*FIELDS, "patients", "mr_profiles", "users", "files", "audit_events")
        return {name: [dict(row) for row in conn.execute(select(Table(
            name, MetaData(), autoload_with=conn)).order_by(text("id"))).mappings()] for name in names}


def test_populated_additive_upgrade_preserves_every_source_and_graph(migration_db):
    engine, config, *_ = seed(migration_db)
    command.downgrade(config, "0028_staff_designation_lifecycle")
    before = snapshot(engine)
    command.upgrade(config, "0029_directory_crypto_additive")
    after = snapshot(engine)
    for table in FIELDS:
        for row in after[table]:
            for column in (*[field + "_ciphertext" for field in FIELDS[table]], *INDEX_COLUMNS[table]):
                assert row.pop(column) is None
            columns = {c["name"]: c for c in inspect(engine).get_columns(table)}
            assert all(columns[field + "_ciphertext"]["nullable"] for field in FIELDS[table])
            assert all(str(columns[field + "_ciphertext"]["type"]) == "TEXT" for field in FIELDS[table])
    assert before == after
    # Empty staging downgrade is allowed without resurrecting deleted directory rows.
    command.downgrade(config, "0028_staff_designation_lifecycle")
    assert snapshot(engine) == before


def test_bounded_resume_roundtrip_tombstones_and_graph_parity(migration_db):
    engine, _, *_ = seed(migration_db)
    config = settings()
    before = snapshot(engine)
    with runtime(engine) as (role, api_engine):
        armed(engine, config, role)
        with Session(engine) as db:
            with pytest.raises(StagingError):
                verify(db, config)  # Missing staged ciphertext must not count as verified.
        with Session(engine) as db:
            first = batch(db, config, table="patient_directory", limit=1)
        assert first["processed"] == 1 and first["remaining"] == 1
        # New connection after interruption resumes, not overwrites.
        finish(engine, config)
        with Session(engine) as db:
            checked = verify(db, config)
        assert checked["counts"] == {"doctor_directory": 2, "mr_directory": 1,
                                     "patient_directory": 2, "patients": 2}
        with Session(engine) as db:
            assert batch(db, config, table="patient_directory", limit=1)["processed"] == 0
        after = snapshot(engine)
        crypto = DirectoryCrypto(config)
        for table in FIELDS:
            for row in after[table]:
                for field in FIELDS[table]:
                    assert crypto.decrypt(table, row["id"], field, row[field + "_ciphertext"]) == row[field]
                    row[field + "_ciphertext"] = None
                for column in INDEX_COLUMNS[table]:
                    assert len(row[column]) == 64
                    row[column] = None
        assert before == after
        # Neither PII writes nor owner/version changes can race maintenance.
        for statement in (
            "UPDATE patient_directory SET name='Synthetic' WHERE true",
            "UPDATE patients SET version=version+1 WHERE true",
            "DELETE FROM doctor_directory WHERE false",
            "TRUNCATE patient_directory",
        ):
            with api_engine.connect() as conn:
                with pytest.raises(Exception) as failure:
                    conn.execute(text(statement))
                assert "Directory maintenance in progress" in str(failure.value)
        with api_engine.connect() as conn:
            with pytest.raises(Exception):
                conn.execute(text("UPDATE directory_crypto_stage SET phase='additive'"))


def test_corruption_wrong_index_and_source_changes_block_verification(migration_db):
    engine, _, *_ = seed(migration_db)
    config = settings()
    with runtime(engine) as (role, _):
        armed(engine, config, role)
        finish(engine, config)
        for column, value in (("name_ciphertext", "corrupted"),
                              ("duplicate_identity_index", "0" * 64),
                              ("name", "Changed Synthetic Source")):
            with engine.begin() as conn:
                original = conn.execute(text(f'SELECT id, "{column}" FROM patient_directory LIMIT 1')).one()
                conn.execute(text(f'UPDATE patient_directory SET "{column}"=:value WHERE id=:id'),
                             {"value": value, "id": original.id})
            with Session(engine) as db:
                with pytest.raises(StagingError):
                    verify(db, config)
            with engine.begin() as conn:
                conn.execute(text(f'UPDATE patient_directory SET "{column}"=:value WHERE id=:id'),
                             {"value": original[1], "id": original.id})
        # Metadata changes invalidate the frozen baseline even with valid crypto.
        with engine.begin() as conn:
            conn.execute(text("UPDATE patients SET version=version+1"))
        with Session(engine) as db:
            with pytest.raises(StagingError):
                verify(db, config)


def test_batch_partial_row_corruption_rolls_back_without_plaintext_repair(migration_db):
    engine, _, *_ = seed(migration_db)
    config = settings()
    with runtime(engine) as (role, _):
        armed(engine, config, role)
        with engine.begin() as conn:
            conn.execute(text("UPDATE patient_directory SET name_ciphertext='corrupt' "
                              "WHERE id=(SELECT id FROM patient_directory ORDER BY id LIMIT 1)"))
        before = snapshot(engine)
        with Session(engine) as db:
            with pytest.raises(StagingError):
                batch(db, config, table="patient_directory", limit=2)
        assert snapshot(engine) == before


def test_stale_plan_wrong_keys_role_and_downgrade_refusal(migration_db):
    engine, config, *_ = seed(migration_db)
    crypto_config = settings()
    with runtime(engine) as (role, api_engine):
        with Session(engine) as db:
            plan = freeze(db, crypto_config, runtime_role=role)
        with engine.begin() as conn:
            conn.execute(text("UPDATE patients SET version=version+1"))
        with Session(engine) as db:
            with pytest.raises(StagingError):
                freeze(db, crypto_config, runtime_role=role, execute=True,
                       approval=plan["approval"], backup_ref=uuid.uuid4(), change_ref=uuid.uuid4(),
                       writes_paused=True, recovery_verified=True)
        armed(engine, crypto_config, role)
        wrong = crypto_config.model_copy(update={"directory_index_key": SecretStr(b64(b"F" * 32))})
        for candidate in (wrong, crypto_config.model_copy(update={"directory_encryption_keys": None})):
            with Session(engine) as db:
                with pytest.raises(StagingError):
                    batch(db, candidate, table="mr_directory", limit=1)
        with Session(api_engine) as db:
            with pytest.raises(StagingError):
                batch(db, crypto_config, table="mr_directory", limit=1)
        with pytest.raises(RuntimeError, match="frozen"):
            command.downgrade(config, "0028_staff_designation_lifecycle")


def test_lock_contention_prevents_batch_and_freeze_is_nonautomatic(migration_db):
    engine, _, *_ = seed(migration_db)
    config = settings()
    with Session(engine) as db:
        with pytest.raises(StagingError):
            batch(db, config, table="mr_directory")
    with runtime(engine) as (role, _):
        armed(engine, config, role)
        with engine.connect() as blocker:
            blocker.execute(text("SELECT id FROM patients LIMIT 1"))
            with Session(engine) as db:
                with pytest.raises(StagingError):
                    batch(db, config, table="mr_directory")
            blocker.rollback()
        with Session(engine) as db:
            assert batch(db, config, table="mr_directory")["processed"] == 1


def test_real_disposable_pg_dump_restore_matches_verified_frozen_source(migration_db):
    for executable in ("pg_dump", "pg_restore", "createdb", "dropdb"):
        assert shutil.which(executable), f"Missing synthetic recovery prerequisite: {executable}"
    engine, _, *_ = seed(migration_db)
    config = settings()
    restored_name = "directory_recovery_test_" + uuid.uuid4().hex[:16]
    url = engine.url
    # migration_db independently checked an isolated TEST_DATABASE_URL; only its
    # private socket/database are used, never ambient connection or credentials.
    env = {**os.environ, "PGHOST": url.query["host"], "PGPORT": str(url.query.get("port", "5432")),
           "PGUSER": url.username, "PGDATABASE": url.database}
    env.pop("PGPASSWORD", None)
    def run(arguments):
        result = subprocess.run(arguments, env=env, capture_output=True, timeout=30)
        # Neither stderr nor backup contents are copied to test failure logs.
        assert result.returncode == 0, "Synthetic backup/recovery command failed"
    with runtime(engine) as (role, _):
        armed(engine, config, role)
        finish(engine, config)
        with Session(engine) as db:
            original = verify(db, config)
        restored = None
        created = False
        try:
            with tempfile.TemporaryDirectory(prefix="directory-synthetic-backup-") as temp:
                archive = str(Path(temp) / "synthetic.dump")
                run(["pg_dump", "--format=custom", "--file", archive])
                os.chmod(archive, 0o600)
                run(["createdb", restored_name])
                created = True
                run(["pg_restore", "--no-owner", "--no-privileges", "--dbname", restored_name, archive])
                restored = create_engine(url.set(database=restored_name), hide_parameters=True)
                with Session(restored) as db:
                    recovered = verify(db, config)
                assert recovered == original
                assert snapshot(restored) == snapshot(engine)
        finally:
            if restored is not None:
                restored.dispose()
            if created:
                run(["dropdb", restored_name])


def test_deadline_rollback_and_sql_debug_logging_refusal(migration_db, monkeypatch):
    engine, _, *_ = seed(migration_db)
    config = settings()
    with runtime(engine) as (role, _):
        armed(engine, config, role)
        before = snapshot(engine)
        original = directory_staging._deadline
        calls = 0
        def expired(start, seconds):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise StagingError()
        monkeypatch.setattr(directory_staging, "_deadline", expired)
        with Session(engine) as db:
            with pytest.raises(StagingError):
                batch(db, config, table="patient_directory", limit=2)
        assert snapshot(engine) == before
        monkeypatch.setattr(directory_staging, "_deadline", original)
        logger = logging.getLogger("sqlalchemy.engine")
        old_level = logger.level
        old_disabled = logger.disabled
        try:
            # Alembic fileConfig disables pre-existing loggers; enabling a level
            # alone does not enable actual SQL diagnostics.
            logger.disabled = False
            logger.setLevel(logging.INFO)
            with Session(engine) as db:
                with pytest.raises(StagingError):
                    batch(db, config, table="patient_directory", limit=1)
        finally:
            logger.setLevel(old_level)
            logger.disabled = old_disabled
