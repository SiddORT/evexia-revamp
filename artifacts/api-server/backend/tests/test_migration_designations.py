"""Designation migration preservation, constraints and committed-connection races."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import uuid
import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.models import User, AuthSession, AuditEvent
from app.db.zone_models import Zone
from app.db.designation_models import Designation
from app.db.courier_models import CourierPartner
from app.db.role_models import CustomRole
from app.schemas.designations import DesignationFields, DesignationStatus, DesignationVersion
from app.schemas.zones import ZoneFields
from app.services import designations, designation_transfer, zones
from test_migration_0006 import migration_db
from test_migration_zones import prepare, identity


def test_actual_designation_migration_preserves_zone_identity_history(migration_db, tmp_path):
    engine, config, actor_id, session_id = prepare(migration_db)
    command.downgrade(config, "0015_zone_permissions")
    with Session(engine) as db:
        zone = zones.create(db, identity(db, actor_id, session_id), ZoneFields(name="Preserved Zone", status="active"))
        role_id = uuid.uuid4()
        db.execute(text("INSERT INTO custom_roles(id,name,description,version) VALUES (:id,'Preserved Role','Existing business metadata',1)"),
                   {"id": role_id})
        db.commit()
        courier = CourierPartner(name="Preserved courier", status="active", created_by=actor_id, updated_by=actor_id)
        db.add(courier)
        db.commit()
        courier_id = courier.id
    from test_migration_role_lifecycle import reviewed_fixture_mapping
    reviewed_fixture_mapping(config, tmp_path, role_id, actor_id)
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.get(CustomRole, role_id).description == "Existing business metadata"
        assert db.get(CourierPartner, courier_id).name == "Preserved courier"
        assert db.get(Zone, zone["id"]).name == "Preserved Zone"
        assert db.get(User, actor_id).is_protected_system_admin
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "zone_create"))
        assert db.scalar(select(func.count()).select_from(Designation)) == 0
        actor = identity(db, actor_id, session_id)
        row = designations.create(db, actor, DesignationFields(name="Retained", shortName="EX", status="active"))
        for sql in ("UPDATE designations SET version=0", "UPDATE designations SET status='unknown'",
                    "UPDATE designations SET name=' '", "UPDATE designations SET deleted_at=now()"):
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(text(sql))
        designations.mutate(db, actor, row["id"], DesignationVersion(expected_version=1), "delete")
    with Session(engine) as db:
        deleted = db.get(Designation, row["id"])
        assert deleted.deleted_by == actor_id and deleted.deleted_at is not None and deleted.version == 2
        assert deleted.updated_at == deleted.deleted_at and deleted.created_by == actor_id


def test_concurrent_duplicates_and_stale_mutations(migration_db):
    engine, _, actor_id, session_id = prepare(migration_db)
    barrier = Barrier(2)
    def create(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return designations.create(db, actor, DesignationFields(name=("City Dispatch" if index else " city   DISPATCH "), shortName="EX", status="inactive"))
            except designations.DesignationError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert "designation_duplicate" in results
    row = next(result for result in results if isinstance(result, dict))
    barrier = Barrier(2)
    def change(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return designations.mutate(db, actor, row["id"], DesignationStatus(status="active", expected_version=1)
                                       if index else DesignationVersion(expected_version=1), "status" if index else "delete")
            except designations.DesignationError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "designation_stale" in results or "not_found" in results


def test_constraint_conflict_rolls_back_batch_and_audit(migration_db, monkeypatch):
    engine, _, actor_id, session_id = prepare(migration_db)
    original = designations.insert
    data = (",".join(designation_transfer.LEGACY_HEADERS[:10]) + "\nFirst,F,1,active,0,0,0,0,0,0\nSecond,S,2,inactive,0,0,0,0,0,0").encode()
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        report = designation_transfer.transfer(db, actor, data, "designations.csv")
        calls = 0
        def conflict(db, actor, body):
            nonlocal calls
            calls += 1
            return original(db, actor, body if calls == 1 else DesignationFields(name=" first ", shortName="EX", status="active"))
        monkeypatch.setattr(designations, "insert", conflict)
        with pytest.raises(designations.DesignationError, match="already uses"):
            designation_transfer.transfer(db, actor, data, "designations.csv", True, report["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Designation)) == 0
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "designation_create")) == 0


def test_concurrent_imports_are_atomic(migration_db):
    engine, _, actor_id, session_id = prepare(migration_db)
    data = (",".join(designation_transfer.LEGACY_HEADERS[:10]) + "\nRace one,EX,1,active,0,0,0,0,0,0\nRace two,EX,1,inactive,0,0,0,0,0,0").encode()
    barrier = Barrier(2)
    def run(_):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            review = designation_transfer.transfer(db, actor, data, "race.csv")
            barrier.wait(timeout=10)
            try:
                return designation_transfer.transfer(db, actor, data, "race.csv", True, review["digest"])
            except designations.DesignationError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "designation_import_conflict" in results or "designation_duplicate" in results
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Designation)) == 2
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "designation_create")) == 2
