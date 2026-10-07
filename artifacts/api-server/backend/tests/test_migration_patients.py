"""Actual forward migration and committed duplicate/stale/atomic-import races."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from alembic import command
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.db.models import Patient, AuthSession, AuditEvent
from app.db.file_models import FileRecord
from app.db.patient_models import PatientDirectory
from app.schemas.doctors import DoctorFields
from app.schemas.patients import PatientFields, PatientStatus
from app.services import doctors, patients, patient_transfer
from app.services.auth import AuthError
from test_migration_0006 import migration_db
from test_migration_doctors import prepare as prepare_doctor
from test_migration_zones import identity
from test_doctors import fields as doctor_fields
from test_patients import fields, csv_file


def prepare(fixture):
    engine, config, actor_id, sid, mr = prepare_doctor(fixture)
    with Session(engine) as db:
        actor = identity(db, actor_id, sid)
        doctor = doctors.create(db, actor, DoctorFields(**doctor_fields(mr)))
    return engine, config, actor_id, sid, mr, doctor


def test_empty_forward_migration_preserves_identity_file_history(migration_db):
    engine, config, actor_id, sid, mr, _ = prepare(migration_db)
    command.downgrade(config, "0019_doctor_directory")
    with Session(engine) as db:
        patient = Patient(assigned_mr_id=mr["id"], is_active=False, version=7)
        db.add(patient); db.flush()
        file_id = uuid.uuid4()
        key = f"patients/{patient.id}/documents/{file_id}.pdf"
        db.add(FileRecord(id=file_id, patient_id=patient.id, category="documents", object_key=key,
                          display_name="Synthetic retained file", content_type="application/pdf",
                          uploader_id=actor_id, state="deleted"))
        db.commit()
        owner_id = patient.id
        count = db.scalar(select(func.count()).select_from(AuditEvent))
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(PatientDirectory)) == 0
        assert db.get(Patient, owner_id).version == 7 and not db.get(Patient, owner_id).is_active
        assert db.get(Patient, owner_id).assigned_mr_id == mr["id"]
        assert db.get(FileRecord, file_id).object_key == key and db.get(FileRecord, file_id).state == "deleted"
        assert db.get(AuthSession, sid).status == "ACTIVE"
        assert db.scalar(select(func.count()).select_from(AuditEvent)) == count


def test_duplicate_and_status_races_commit_once(migration_db):
    engine, _, actor_id, sid, _, doctor = prepare(migration_db)
    barrier = Barrier(2)
    def create(index):
        with Session(engine) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(10)
            try:
                return patients.create(db, actor, PatientFields(**fields(doctor, name="DuPe" if index else "dupe")))
            except patients.PatientError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert sum(isinstance(r, dict) for r in results) == 1 and "patient_duplicate" in results
    record = next(r for r in results if isinstance(r, dict))
    barrier = Barrier(2)
    def status(value):
        with Session(engine) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(10)
            try:
                return patients.mutate(db, actor, record["id"], PatientStatus(expected_version=1, status=value), "status")
            except patients.PatientError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(status, ("active", "inactive")))
    assert sum(isinstance(r, dict) for r in results) == 1 and "patient_stale" in results


def test_import_rollback_and_session_binding(migration_db, monkeypatch):
    engine, _, actor_id, sid, _, doctor = prepare(migration_db)
    data = csv_file([fields(doctor), fields(doctor, name="Second Patient")], doctor)
    original, calls = patients.insert, 0
    def fail(db, actor, body, code=None):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise patients.PatientError("Synthetic second-row failure", 409, "patient_conflict")
        return original(db, actor, body, code)
    with Session(engine) as db:
        actor = identity(db, actor_id, sid)
        report = patient_transfer.transfer(db, actor, data, "batch.csv")
        monkeypatch.setattr(patients, "insert", fail)
        with pytest.raises(patients.PatientError):
            patient_transfer.transfer(db, actor, data, "batch.csv", True, report["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(PatientDirectory)) == 0
        assert db.scalar(select(func.count()).select_from(Patient)) == 0
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "patient_directory_create")) == 0
        actor = identity(db, actor_id, sid)
        report = patient_transfer.transfer(db, actor, data, "batch.csv")
        with Session(engine) as other:
            session = other.get(AuthSession, sid)
            session.status = "REVOKED"
            from app.core.security import utcnow
            session.revoked_at = utcnow()
            other.commit()
        with pytest.raises(AuthError):
            patient_transfer.transfer(db, actor, data, "batch.csv", True, report["digest"])
