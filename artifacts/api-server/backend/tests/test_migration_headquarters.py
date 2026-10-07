"""Migration preservation, independent committed races, service-boundary denial."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, DataError
from sqlalchemy.orm import Session
from app.db.models import User, AuthSession, AuditEvent
from app.db.headquarter_models import Headquarter
from app.db.designation_models import Designation
from app.schemas.designations import DesignationFields
from app.schemas.headquarters import HeadquarterFields, HeadquarterStatus, HeadquarterVersion
from app.services import headquarters, headquarter_transfer, designations
from app.services.auth import AuthError
from test_migration_0006 import migration_db
from test_migration_zones import prepare, identity


def test_forward_empty_migration_preserves_foundations(migration_db):
    engine, config, actor_id, session_id = prepare(migration_db)
    command.downgrade(config, "0016_designations")
    with Session(engine) as db:
        existing = designations.create(db, identity(db, actor_id, session_id),
                                       DesignationFields(name="Preserved", shortName="PR", level=1, status="active"))
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.get(Designation, existing["id"]).name == "Preserved"
        assert db.get(User, actor_id).is_protected_system_admin
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "designation_create"))
        assert db.scalar(select(func.count()).select_from(Headquarter)) == 0
        actor = identity(db, actor_id, session_id)
        row = headquarters.create(db, actor, HeadquarterFields(name="History", status="active"))
        for sql in ("UPDATE headquarters SET version=0", "UPDATE headquarters SET status='unknown'",
                    "UPDATE headquarters SET name=' '", "UPDATE headquarters SET state_code='lower'",
                    "UPDATE headquarters SET state_code=''", "UPDATE headquarters SET state_code=repeat('A',17)",
                    "UPDATE headquarters SET deleted_at=now()"):
            with pytest.raises((IntegrityError, DataError)):
                with db.begin_nested():
                    db.execute(text(sql))
        headquarters.mutate(db, actor, row["id"], HeadquarterVersion(expected_version=1), "delete")
    with Session(engine) as db:
        deleted = db.get(Headquarter, row["id"])
        assert deleted.deleted_by == actor_id and deleted.deleted_at is not None and deleted.version == 2
        assert deleted.updated_at == deleted.deleted_at and deleted.created_by == actor_id


def test_duplicate_create_and_stale_status_delete_race(migration_db):
    engine, _, actor_id, session_id = prepare(migration_db)
    barrier = Barrier(2)
    def create(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return headquarters.create(db, actor, HeadquarterFields(name="North City" if index else " north   CITY ", status="inactive"))
            except headquarters.HeadquarterError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert "headquarter_duplicate" in results
    row = next(result for result in results if isinstance(result, dict))
    barrier = Barrier(2)
    def change(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return headquarters.mutate(db, actor, row["id"],
                    HeadquarterStatus(status="active", expected_version=1) if index else HeadquarterVersion(expected_version=1),
                    "status" if index else "delete")
            except headquarters.HeadquarterError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "headquarter_stale" in results or "not_found" in results


def test_concurrent_imports_and_transactional_rollback(migration_db, monkeypatch):
    engine, _, actor_id, session_id = prepare(migration_db)
    data = b"HQ Name,State Code,Status\nRace one,,active\nRace two,CUSTOM,inactive"
    barrier = Barrier(2)
    def run(_):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            review = headquarter_transfer.transfer(db, actor, data, "race.csv")
            barrier.wait(timeout=10)
            try:
                return headquarter_transfer.transfer(db, actor, data, "race.csv", True, review["digest"])
            except headquarters.HeadquarterError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "headquarter_import_conflict" in results or "headquarter_duplicate" in results
    original = headquarters.insert
    data = b"HQ Name,State Code,Status\nFirst,,active\nSecond,,inactive"
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        review = headquarter_transfer.transfer(db, actor, data, "batch.csv")
        calls = 0
        def conflict(db, actor, body):
            nonlocal calls
            calls += 1
            return original(db, actor, body if calls == 1 else HeadquarterFields(name=" first ", status="active"))
        monkeypatch.setattr(headquarters, "insert", conflict)
        with pytest.raises(headquarters.HeadquarterError):
            headquarter_transfer.transfer(db, actor, data, "batch.csv", True, review["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Headquarter)) == 2
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "headquarter_create")) == 2


def test_service_commit_and_export_revalidate_revoked_session(migration_db):
    engine, _, actor_id, session_id = prepare(migration_db)
    data = b"HQ Name,State Code,Status\nBound,,active"
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        report = headquarter_transfer.transfer(db, actor, data, "hq.csv")
        with Session(engine) as other:
            other.execute(text("UPDATE auth_sessions SET status='REVOKED',revoked_at=now() WHERE id=:id"), {"id": session_id})
            other.commit()
        with pytest.raises(AuthError):
            headquarter_transfer.transfer(db, actor, data, "hq.csv", True, report["digest"])
        with pytest.raises(AuthError):
            headquarter_transfer.export(db, actor, "", "all", "csv")
        assert db.scalar(select(func.count()).select_from(Headquarter)) == 0
