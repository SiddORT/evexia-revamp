"""Populated historical migration, FK preservation and committed delete races."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from alembic import command
from sqlalchemy import MetaData, Table, select, inspect, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.security import utcnow
from app.db.models import Patient
from app.db.doctor_models import DoctorDirectory
from app.db.patient_models import PatientDirectory
from app.schemas.doctors import DoctorFields, DoctorDeletion
from app.schemas.patients import PatientFields, PatientDeletion
from app.services import doctors, patients
from app.services import patient_transfer, opening_balance_transfer, opening_balances
from test_migration_0006 import migration_db
from test_migration_patients import prepare
from test_migration_zones import identity
from test_patients import fields
from test_doctors import fields as doctor_fields
from test_patients import csv_file
from test_opening_balances import file as balance_file


def test_populated_historical_upgrade_only_adds_nullable_metadata(migration_db):
    engine, config, actor, sid, mr, _ = prepare(migration_db)
    command.downgrade(config, "0027_mr_designation_identity")
    meta = MetaData()
    names = ("doctor_directory", "patient_directory", "patients", "files", "audit_events")
    # Seed exclusively through the installed historical table contracts.
    tables = {name: Table(name, meta, autoload_with=engine) for name in names}
    did, pid, fid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    now = utcnow()
    key = f"patients/{pid}/documents/{fid}.pdf"
    with engine.begin() as conn:
        conn.execute(tables["doctor_directory"].insert(), dict(
            **DoctorFields(**doctor_fields(mr, registrationNumber="HISTORICAL")).model_dump(),
            id=did, verification="verified", version=7, created_by=actor, updated_by=actor,
            created_at=now, updated_at=now))
        conn.execute(tables["patients"].insert(), dict(id=pid, assigned_mr_id=mr["id"],
                                                      is_active=True, version=6, created_at=now, updated_at=now))
        conn.execute(tables["patient_directory"].insert(), dict(
            **PatientFields(**fields({"id": did})).model_dump(), id=pid, code="PAT-HISTORICAL",
            created_by=actor, updated_by=actor, created_at=now, updated_at=now))
        conn.execute(tables["files"].insert(), dict(
            id=fid, patient_id=pid, category="documents", object_key=key, display_name="Synthetic history",
            content_type="application/pdf", uploader_id=actor, state="deleted", version=1, size=0, scanner_status="pending"))
        before = {name: [dict(r) for r in conn.execute(select(table)).mappings()] for name, table in tables.items()}
        indexes = {name: inspect(conn).get_indexes(name) for name in names[:2]}
    # Test this revision's exact historical contract, not later additive columns.
    command.upgrade(config, "0028_directory_soft_delete")
    with engine.begin() as conn:
        for name in names:
            table = Table(name, MetaData(), autoload_with=conn)
            actual = [dict(r) for r in conn.execute(select(table)).mappings()]
            if name in names[:2]:
                for row in actual:
                    assert row.pop("deleted_at") is None and row.pop("deleted_by") is None
                assert inspect(conn).get_indexes(name) == indexes[name]
                columns = {c["name"]: c for c in inspect(conn).get_columns(name)}
                assert columns["deleted_at"]["nullable"] and columns["deleted_at"]["type"].timezone
                assert columns["deleted_by"]["nullable"]
                fk = next(f for f in inspect(conn).get_foreign_keys(name) if f["constrained_columns"] == ["deleted_by"])
                assert fk["referred_table"] == "users" and fk["referred_columns"] == ["id"]
                assert fk["options"].get("ondelete") not in ("CASCADE", "SET NULL")
            assert actual == before[name]
    for name, record_id in (("doctor_directory", did), ("patient_directory", pid)):
        table = Table(name, MetaData(), autoload_with=engine)
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(update(table).where(table.c.id == record_id).values(deleted_by=uuid.uuid4()))
        with engine.begin() as conn:
            conn.execute(update(table).where(table.c.id == record_id).values(deleted_at=now, deleted_by=actor))
    command.downgrade(config, "0027_mr_designation_identity")
    with engine.begin() as conn:
        for name in names:
            table = Table(name, MetaData(), autoload_with=conn)
            assert [dict(r) for r in conn.execute(select(table)).mappings()] == before[name]


@pytest.mark.parametrize("resource", ("doctor", "patient"))
def test_concurrent_delete_commits_once(migration_db, resource):
    engine, _, actor_id, sid, _, doctor = prepare(migration_db)
    with Session(engine) as db:
        actor = identity(db, actor_id, sid)
        patient = patients.create(db, actor, PatientFields(**fields(doctor)))
    record = doctor if resource == "doctor" else patient
    service = doctors if resource == "doctor" else patients
    body = (DoctorDeletion if resource == "doctor" else PatientDeletion)(expected_version=record["version"])
    barrier = Barrier(2)
    def run(_):
        with Session(engine) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(10)
            try:
                return service.mutate(db, actor, record["id"], body, "delete")
            except (doctors.DoctorError, patients.PatientError) as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "not_found" in results
    with Session(engine) as db:
        row = db.get(DoctorDirectory if resource == "doctor" else PatientDirectory, record["id"])
        assert row.deleted_by == actor_id and row.deleted_at
        assert (row.version if resource == "doctor" else db.get(Patient, row.id).version) == record["version"] + 1


def test_import_commit_revalidates_cross_connection_doctor_deletion(migration_db):
    engine, _, actor_id, sid, _, doctor = prepare(migration_db)
    pid = uuid.UUID(str(doctor["id"]))
    data = csv_file([fields(doctor)], doctor)
    balance_data = balance_file(doctor)
    with Session(engine, expire_on_commit=False) as review_db:
        actor = identity(review_db, actor_id, sid)
        # Keep a cached object alive to model a long-lived service session.
        cached = review_db.get(DoctorDirectory, pid)
        patient_review = patient_transfer.transfer(review_db, actor, data, "patients.csv")
        balance_review = opening_balance_transfer.transfer(review_db, actor, balance_data, "balances.csv")
        assert patient_review["valid"] and balance_review["valid"] and cached.deleted_at is None
        with Session(engine) as other:
            other_actor = identity(other, actor_id, sid)
            doctors.mutate(other, other_actor, pid, DoctorDeletion(expected_version=doctor["version"]), "delete")
        with pytest.raises(patients.PatientError):
            patient_transfer.transfer(review_db, actor, data, "patients.csv", True, patient_review["digest"])
        with pytest.raises(opening_balances.OpeningBalanceError) as rejected:
            opening_balance_transfer.transfer(review_db, actor, balance_data, "balances.csv", True, balance_review["digest"])
        assert rejected.value.code == "opening_balance_import_conflict"
