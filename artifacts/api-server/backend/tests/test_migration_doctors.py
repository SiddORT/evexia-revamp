"""Real empty forward migration, committed concurrency and rollback evidence."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import uuid
import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session
from app.db.doctor_models import DoctorDirectory
from app.db.models import AuditEvent, AuthSession, MRProfile, User
from app.db.mr_models import MRDirectory
from app.schemas.doctors import DoctorFields, DoctorStatus
from app.schemas.mrs import MRCreate
from app.services import doctors, doctor_transfer, mrs
from app.services.auth import AuthError
from test_migration_0006 import migration_db
from test_migration_mrs import setup
from test_migration_zones import identity
from test_mrs import fields as mr_fields
from test_doctors import fields, csv_file


def prepare(fixture):
    engine, config, actor_id, session_id, hq, zone = setup(fixture)
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        mr = mrs.create(db, actor, MRCreate(**mr_fields(hq, zone)))["record"]
    return engine, config, actor_id, session_id, mr


def test_empty_forward_migration_retains_mr_profile_and_audit(migration_db):
    from test_migration_zones import prepare as prepare_identity
    from test_migration_sales_targets import seed
    engine, config, actor_id, sid = prepare_identity(migration_db)
    command.downgrade(config, "0018_mr_directory")
    with Session(engine) as db:
        mr = seed(db, actor_id, historical=True)
        mr["id"] = uuid.UUID(mr["id"])
        user_id = db.get(MRProfile, mr["id"]).user_id
        mr_version = db.scalar(text("SELECT version FROM mr_directory WHERE id=:id"), {"id": mr["id"]})
        audit_count = db.scalar(select(func.count()).select_from(AuditEvent))
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(DoctorDirectory)) == 0
        assert db.get(MRProfile, mr["id"]).user_id == user_id
        assert db.get(MRDirectory, mr["id"]).version == mr_version
        assert db.get(User, user_id).system_role == "mr"
        assert db.get(AuthSession, sid).status == "ACTIVE"
        assert db.scalar(select(func.count()).select_from(AuditEvent)) == audit_count


def test_duplicate_race_and_atomic_stale_bulk(migration_db):
    # Fixture is explicitly isolated; concurrent calls need independent committed sessions.
    engine, _, actor_id, sid, mr = prepare(migration_db)
    barrier = Barrier(2)
    def create(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(timeout=10)
            try:
                return doctors.create(db, actor, DoctorFields(**fields(mr, registrationNumber="DuPe" if index else "DUPE")))
            except doctors.DoctorError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1 and "doctor_registration_duplicate" in results
    one = next(r for r in results if isinstance(r, dict))
    barrier = Barrier(2)
    def change(status):
        with Session(engine) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(timeout=10)
            try:
                return doctors.mutate(db, actor, one["id"], DoctorStatus(expected_version=1, status=status), "status")
            except doctors.DoctorError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, ("inactive", "active")))
    assert sum(isinstance(result, dict) for result in results) == 1 and "doctor_stale" in results


def test_import_rolls_back_second_failure_and_revoked_sessions(migration_db, monkeypatch):
    engine, _, actor_id, sid, mr = prepare(migration_db)
    data = csv_file([fields(mr), fields(mr, registrationNumber="REG-02")])
    original, calls = doctors.insert, 0
    def fail(db, actor, body, verification="unverified"):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise doctors.DoctorError("Synthetic second-row failure", 409, "doctor_conflict")
        return original(db, actor, body, verification)
    with Session(engine) as db:
        actor = identity(db, actor_id, sid)
        report = doctor_transfer.transfer(db, actor, data, "batch.csv")
        monkeypatch.setattr(doctors, "insert", fail)
        with pytest.raises(doctors.DoctorError):
            doctor_transfer.transfer(db, actor, data, "batch.csv", True, report["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(DoctorDirectory)) == 0
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "doctor_directory_import")) == 0
        actor = identity(db, actor_id, sid)
        report = doctor_transfer.transfer(db, actor, data, "batch.csv")
        with Session(engine) as other:
            other.execute(text("UPDATE auth_sessions SET status='REVOKED',revoked_at=now() WHERE id=:id"), {"id": sid})
            other.commit()
        with pytest.raises(AuthError):
            doctor_transfer.transfer(db, actor, data, "batch.csv", True, report["digest"])
        with pytest.raises(AuthError):
            doctor_transfer.export(db, actor, format="csv")
