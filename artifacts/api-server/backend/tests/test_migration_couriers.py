"""Courier migration preservation, constraints and committed-connection races."""
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
from app.db.courier_models import CourierPartner
from app.db.role_models import CustomRole
from app.schemas.couriers import CourierFields, CourierStatus, CourierVersion
from app.schemas.zones import ZoneFields
from app.services import couriers, courier_transfer, zones
from test_migration_0006 import migration_db
from test_migration_zones import prepare, identity


def test_actual_courier_migration_preserves_zone_identity_history(migration_db, tmp_path):
    engine, config, actor_id, session_id = prepare(migration_db)
    command.downgrade(config, "0010_custom_roles")
    with Session(engine) as db:
        zone = zones.create(db, identity(db, actor_id, session_id), ZoneFields(name="Preserved Zone", status="active"))
        # Historical schemas predate current ORM fields; preserve the old row
        # using its actual contract before upgrading to the current model.
        role_id = uuid.uuid4()
        db.execute(text("INSERT INTO custom_roles(id,name,description,version) VALUES (:id,'Preserved Role','Existing business metadata',1)"),
                   {"id": role_id})
        db.commit()
    from test_migration_role_lifecycle import reviewed_fixture_mapping
    reviewed_fixture_mapping(config, tmp_path, role_id, actor_id)
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.get(CustomRole, role_id).description == "Existing business metadata"
        assert db.get(Zone, zone["id"]).name == "Preserved Zone"
        assert db.get(User, actor_id).is_protected_system_admin
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "zone_create"))
        assert db.scalar(select(func.count()).select_from(CourierPartner)) == 0
        actor = identity(db, actor_id, session_id)
        row = couriers.create(db, actor, CourierFields(name="Retained", status="active"))
        for sql in ("UPDATE courier_partners SET version=0", "UPDATE courier_partners SET status='unknown'",
                    "UPDATE courier_partners SET name=' '", "UPDATE courier_partners SET deleted_at=now()"):
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(text(sql))
        couriers.mutate(db, actor, row["id"], CourierVersion(expected_version=1), "delete")
    with Session(engine) as db:
        deleted = db.get(CourierPartner, row["id"])
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
                return couriers.create(db, actor, CourierFields(name=("City Dispatch" if index else " city   DISPATCH "), status="inactive"))
            except couriers.CourierError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert "courier_duplicate" in results
    row = next(result for result in results if isinstance(result, dict))
    barrier = Barrier(2)
    def change(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return couriers.mutate(db, actor, row["id"], CourierStatus(status="active", expected_version=1)
                                       if index else CourierVersion(expected_version=1), "status" if index else "delete")
            except couriers.CourierError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "courier_stale" in results or "not_found" in results


def test_constraint_conflict_rolls_back_batch_and_audit(migration_db, monkeypatch):
    engine, _, actor_id, session_id = prepare(migration_db)
    original = couriers.insert
    data = b"Courier Partner Name,Status\nFirst,active\nSecond,inactive"
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        report = courier_transfer.transfer(db, actor, data, "couriers.csv")
        calls = 0
        def conflict(db, actor, body):
            nonlocal calls
            calls += 1
            return original(db, actor, body if calls == 1 else CourierFields(name=" first ", status="active"))
        monkeypatch.setattr(couriers, "insert", conflict)
        with pytest.raises(couriers.CourierError, match="already uses"):
            courier_transfer.transfer(db, actor, data, "couriers.csv", True, report["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(CourierPartner)) == 0
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "courier_create")) == 0
