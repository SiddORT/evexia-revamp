"""Location migration preservation, constraints and committed-connection races."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.models import User, AuthSession, AuditEvent
from app.db.zone_models import Zone
from app.db.location_models import StorageLocation
from app.db.courier_models import CourierPartner
from app.db.role_models import CustomRole
from app.schemas.locations import LocationFields, LocationStatus, LocationVersion
from app.schemas.zones import ZoneFields
from app.services import locations, location_transfer, zones
from test_migration_0006 import migration_db
from test_migration_zones import prepare, identity


def test_actual_location_migration_preserves_zone_identity_history(migration_db):
    engine, config, actor_id, session_id = prepare(migration_db)
    command.downgrade(config, "0011_courier_partners")
    with Session(engine) as db:
        zone = zones.create(db, identity(db, actor_id, session_id), ZoneFields(name="Preserved Zone", status="active"))
        role = CustomRole(name="Preserved Role", description="Existing business metadata", version=1)
        db.add(role)
        db.commit()
        role_id = role.id
        courier = CourierPartner(name="Preserved courier", status="active", created_by=actor_id, updated_by=actor_id)
        db.add(courier)
        db.commit()
        courier_id = courier.id
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.get(CustomRole, role_id).description == "Existing business metadata"
        assert db.get(CourierPartner, courier_id).name == "Preserved courier"
        assert db.get(Zone, zone["id"]).name == "Preserved Zone"
        assert db.get(User, actor_id).is_protected_system_admin
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "zone_create"))
        assert db.scalar(select(func.count()).select_from(StorageLocation)) == 0
        actor = identity(db, actor_id, session_id)
        row = locations.create(db, actor, LocationFields(name="Retained", address="Building A", status="active"))
        for sql in ("UPDATE storage_locations SET version=0", "UPDATE storage_locations SET status='unknown'",
                    "UPDATE storage_locations SET address=' '",
                    "UPDATE storage_locations SET name=' '", "UPDATE storage_locations SET deleted_at=now()"):
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(text(sql))
        locations.mutate(db, actor, row["id"], LocationVersion(expected_version=1), "delete")
    with Session(engine) as db:
        deleted = db.get(StorageLocation, row["id"])
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
                return locations.create(db, actor, LocationFields(name=("City Dispatch" if index else " city   DISPATCH "), address="Building A", status="inactive"))
            except locations.LocationError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert "location_duplicate" in results
    row = next(result for result in results if isinstance(result, dict))
    barrier = Barrier(2)
    def change(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return locations.mutate(db, actor, row["id"], LocationStatus(status="active", expected_version=1)
                                       if index else LocationVersion(expected_version=1), "status" if index else "delete")
            except locations.LocationError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "location_stale" in results or "not_found" in results


def test_constraint_conflict_rolls_back_batch_and_audit(migration_db, monkeypatch):
    engine, _, actor_id, session_id = prepare(migration_db)
    original = locations.insert
    data = b"Storage Location,Address,Status\nFirst,Building A,active\nSecond,Building A,inactive"
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        report = location_transfer.transfer(db, actor, data, "locations.csv")
        calls = 0
        def conflict(db, actor, body):
            nonlocal calls
            calls += 1
            return original(db, actor, body if calls == 1 else LocationFields(name=" first ", address="Building A", status="active"))
        monkeypatch.setattr(locations, "insert", conflict)
        with pytest.raises(locations.LocationError, match="already uses"):
            location_transfer.transfer(db, actor, data, "locations.csv", True, report["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(StorageLocation)) == 0
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "location_create")) == 0
