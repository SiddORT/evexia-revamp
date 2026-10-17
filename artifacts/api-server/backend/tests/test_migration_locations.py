"""Location migration preservation, constraints and committed-connection races."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import uuid
import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import DataError, IntegrityError
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
from test_migration_zones import prepare, identity, historical_zone


def test_actual_location_migration_preserves_zone_identity_history(migration_db, tmp_path):
    engine, config, actor_id, session_id = prepare(migration_db, target_revision="0011_courier_partners")
    command.downgrade(config, "0011_courier_partners")
    with Session(engine) as db:
        zone = historical_zone(db, actor_id, session_id, "Preserved Zone")
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
    from directory_test_data import approved_historical_upgrade
    approved_historical_upgrade(engine, config)
    command.upgrade(config, "0041_location_geography")
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
    engine, config, actor_id, session_id = prepare(migration_db)
    command.upgrade(config, "0041_location_geography")
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
    engine, config, actor_id, session_id = prepare(migration_db)
    command.upgrade(config, "0041_location_geography")
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


def test_geography_migration_preserves_live_and_deleted_addresses_without_inference(migration_db):
    """Raw historical contract in the disposable schema, not current ORM defaults."""
    engine, config, actor_id, _ = prepare(migration_db)
    command.upgrade(config, "0040_po_tax_basis")
    live_id, deleted_id = uuid.uuid4(), uuid.uuid4()
    with engine.begin() as connection:
        for row_id, deleted in ((live_id, False), (deleted_id, True)):
            connection.execute(text("""
                INSERT INTO storage_locations
                    (id, name, address, status, version, created_by, updated_by, deleted_at, deleted_by)
                VALUES (:id, :name, 'Pune Maharashtra India 411001', 'inactive', 7, :actor, :actor,
                        CASE WHEN :deleted THEN now() ELSE NULL END,
                        CASE WHEN :deleted THEN :actor ELSE NULL END)
            """), dict(id=row_id, name="Historical deleted" if deleted else "Historical live",
                       actor=actor_id, deleted=deleted))
        before = connection.execute(text("SELECT * FROM storage_locations ORDER BY id")).mappings().all()
    command.upgrade(config, "0041_location_geography")
    with engine.connect() as connection:
        after = connection.execute(text("SELECT * FROM storage_locations ORDER BY id")).mappings().all()
        assert len(after) == 2
        for old, current in zip(before, after):
            assert {key: current[key] for key in old} == dict(old)
            assert {key: current[key] for key in ("pincode", "country_code", "state", "city")} == {
                "pincode": "", "country_code": "", "state": "", "city": "",
            }
    with Session(engine) as db:
        for column, value in (("pincode", "x" * 21), ("country_code", "USA"),
                              ("state", "x" * 101), ("city", "x" * 101),
                              ("country_code", "in")):
            with pytest.raises((DataError, IntegrityError)):
                with db.begin_nested():
                    db.execute(text(f"UPDATE storage_locations SET {column}=:value WHERE id=:id"),
                               dict(value=value, id=live_id))
    # Structured data on tombstones also prevents a lossy downgrade.
    with engine.begin() as connection:
        connection.execute(text("UPDATE storage_locations SET country_code='IN', state='Maharashtra' WHERE id=:id"),
                           dict(id=deleted_id))
    with pytest.raises(RuntimeError, match="Archive structured location geography"):
        command.downgrade(config, "0040_po_tax_basis")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0041_location_geography"
        assert connection.scalar(text("SELECT state FROM storage_locations WHERE id=:id"), dict(id=deleted_id)) == "Maharashtra"
