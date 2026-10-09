"""Forward preservation, committed races, rollback and revoked-session evidence."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, DataError
from sqlalchemy.orm import Session
from app.db.models import AuditEvent, AuthSession, User
from app.db.opening_balance_models import OpeningBalance, OpeningBalanceImportReview
from app.db.doctor_models import DoctorDirectory
from app.schemas.doctors import DoctorFields, DoctorStatus
from app.schemas.opening_balances import OpeningBalanceFields, OpeningBalanceStatus, OpeningBalanceVersion
from app.services import doctors, opening_balances as service, opening_balance_transfer as transfer
from app.services.auth import AuthError
from test_migration_0006 import migration_db
from test_migration_doctors import prepare as doctor_fixture
from test_migration_zones import identity
from test_doctors import fields as doctor_fields
from test_opening_balances import body, file


def prepare(fixture):
    engine, config, actor_id, sid, mr = doctor_fixture(fixture)
    with Session(engine) as db:
        doctor = doctors.create(db, identity(db, actor_id, sid), DoctorFields(**doctor_fields(mr)))
    return engine, config, actor_id, sid, doctor


def test_empty_forward_migration_preserves_doctors_identity_and_audit(migration_db):
    engine, config, actor_id, sid, doctor = prepare(migration_db)
    command.downgrade(config, "0023_sales_targets")
    with Session(engine) as db:
        original = db.get(DoctorDirectory, doctor["id"])
        count = db.scalar(select(func.count()).select_from(AuditEvent))
        assert original.registrationNumber == doctor["registrationNumber"]
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(OpeningBalance)) == 0
        assert db.scalar(select(func.count()).select_from(OpeningBalanceImportReview)) == 0
        assert db.get(User, actor_id).is_protected_system_admin
        assert db.get(AuthSession, sid).status == "ACTIVE"
        assert db.get(DoctorDirectory, doctor["id"]).version == 1
        assert db.scalar(select(func.count()).select_from(AuditEvent)) == count
        actor = identity(db, actor_id, sid)
        row = service.create(db, actor, OpeningBalanceFields(**body(doctor)))
        for sql in ("UPDATE opening_balances SET version=0", "UPDATE opening_balances SET status='unknown'",
                    'UPDATE opening_balances SET "startYear"=1899', 'UPDATE opening_balances SET "endYear"=2028',
                    "UPDATE opening_balances SET amount='NaN'", "UPDATE opening_balances SET amount='Infinity'",
                    "UPDATE opening_balances SET deleted_at=now()"):
            with pytest.raises((IntegrityError, DataError)):
                with db.begin_nested():
                    db.execute(text(sql))
        deleted = service.mutate(db, actor, row["id"], OpeningBalanceVersion(expected_version=1), "delete")
        assert deleted["version"] == 2
    with Session(engine) as db:
        historical = db.get(OpeningBalance, row["id"])
        assert historical.deleted_by == actor_id and historical.deleted_at == historical.updated_at
        assert historical.created_by == actor_id


def test_duplicate_create_and_stale_status_delete_race(migration_db):
    engine, _, actor_id, sid, doctor = prepare(migration_db)
    barrier = Barrier(2)
    def create(_):
        with Session(engine) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(timeout=10)
            try:
                return service.create(db, actor, OpeningBalanceFields(**body(doctor)))
            except service.OpeningBalanceError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert sum(isinstance(r, dict) for r in results) == 1 and "opening_balance_conflict" in results
    row = next(r for r in results if isinstance(r, dict))
    barrier = Barrier(2)
    def change(index):
        with Session(engine) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(timeout=10)
            try:
                return service.mutate(db, actor, row["id"], OpeningBalanceStatus(expected_version=1, status="inactive")
                    if index else OpeningBalanceVersion(expected_version=1), "status" if index else "delete")
            except service.OpeningBalanceError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, range(2)))
    assert sum(isinstance(r, dict) for r in results) == 1
    assert "opening_balance_stale" in results or "not_found" in results


def test_concurrent_commits_single_use_and_second_insert_rollback(migration_db, monkeypatch):
    engine, _, actor_id, sid, doctor = prepare(migration_db)
    data = file(doctor, (2026, "0.00", "active"), (2027, "-1.25", "inactive"))
    with Session(engine) as db:
        review = transfer.transfer(db, identity(db, actor_id, sid), data, "batch.csv")
    barrier = Barrier(2)
    def commit(_):
        with Session(engine) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(timeout=10)
            try:
                return transfer.transfer(db, actor, data, "batch.csv", True, review["digest"])
            except service.OpeningBalanceError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(commit, range(2)))
    assert sum(isinstance(r, dict) for r in results) == 1
    assert "opening_balance_review_changed" in results
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(OpeningBalance)) == 2
    original, calls = service.insert, 0
    def fail(db, actor, fields):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise service.OpeningBalanceError("Synthetic failure", 409, "opening_balance_conflict")
        return original(db, actor, fields)
    data = file(doctor, (2028, "0", "active"), (2029, "1", "active"))
    with Session(engine) as db:
        actor = identity(db, actor_id, sid)
        review = transfer.transfer(db, actor, data, "new.csv")
        monkeypatch.setattr(service, "insert", fail)
        with pytest.raises(service.OpeningBalanceError):
            transfer.transfer(db, actor, data, "new.csv", True, review["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(OpeningBalance)) == 2
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "opening_balance_create")) == 2
        assert db.get(OpeningBalanceImportReview, sid) is None


def test_doctor_change_serializes_with_creation_and_import_rechecks(migration_db):
    engine, _, actor_id, sid, doctor = prepare(migration_db)
    barrier = Barrier(2)
    def run(index):
        with Session(engine) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(timeout=10)
            if index:
                return doctors.mutate(db, actor, doctor["id"], DoctorStatus(expected_version=1, status="inactive"), "status")
            try:
                return service.create(db, actor, OpeningBalanceFields(**body(doctor)))
            except service.OpeningBalanceError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    with Session(engine) as db:
        assert db.get(DoctorDirectory, doctor["id"]).status == "inactive"
        assert db.scalar(select(func.count()).select_from(OpeningBalance)) == (0 if "opening_balance_reference" in results else 1)
        actor = identity(db, actor_id, sid)
        doctors.mutate(db, actor, doctor["id"], DoctorStatus(expected_version=2, status="active"), "status")
        data = file(doctor, (2027, "0", "active"))
        review = transfer.transfer(db, actor, data, "new.csv")
        doctors.mutate(db, actor, doctor["id"], DoctorStatus(expected_version=3, status="inactive"), "status")
        with pytest.raises(service.OpeningBalanceError, match="Invalid rows"):
            transfer.transfer(db, actor, data, "new.csv", True, review["digest"])


def test_commit_export_and_direct_crud_revalidate_revoked_identity(migration_db):
    engine, _, actor_id, sid, doctor = prepare(migration_db)
    with Session(engine) as db:
        actor = identity(db, actor_id, sid)
        review = transfer.transfer(db, actor, file(doctor), "batch.csv")
        with Session(engine) as other:
            other.execute(text("UPDATE auth_sessions SET status='REVOKED',revoked_at=now() WHERE id=:id"), {"id": sid})
            other.commit()
        with pytest.raises(AuthError):
            transfer.transfer(db, actor, file(doctor), "batch.csv", True, review["digest"])
        with pytest.raises(AuthError):
            transfer.export(db, actor, "", "all", "csv")
        with pytest.raises(AuthError):
            service.create(db, actor, OpeningBalanceFields(**body(doctor)))
