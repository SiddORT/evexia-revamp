"""Actual migrations and separate committed-connection concurrency."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.models import User, AuthSession, AuditEvent
from app.db.vendor_models import Vendor
from app.db.zone_models import Zone
from app.schemas.vendors import VendorFields, VendorStatus, VendorVersion
from app.schemas.zones import ZoneFields
from app.services import vendors, vendor_transfer, zones
from test_migration_0006 import migration_db
from test_migration_zones import prepare, identity
from test_vendors import FIELDS, HEADER


def test_international_expansion_preserves_records_and_refuses_lossy_downgrade(migration_db):
    engine, config, actor_id, session_id = prepare(migration_db)
    command.downgrade(config, "0024_opening_balances")
    with Session(engine) as db:
        actor = identity(db, actor_id, session_id)
        original = vendors.create(db, actor, VendorFields(**FIELDS))
    command.upgrade(config, "head")
    with Session(engine) as db:
        stored = db.get(Vendor, original["id"])
        assert stored.phoneNo == "9876543210" and stored.version == 1
        assert stored.created_by == actor_id
        actor = identity(db, actor_id, session_id)
        added = vendors.create(db, actor, VendorFields(**{
            **FIELDS, "vendorName": "Brazil expansion", "gstNo": "29EEEEE4444E1Z9",
            "dialCountry": "BR", "phoneNo": "(11) 96123-4567",
        }))
        assert added["phoneNo"] == "11961234567"
        vendors.mutate(db, actor, added["id"], VendorVersion(expected_version=1), "delete")
    with pytest.raises(RuntimeError, match="international vendor history"):
        command.downgrade(config, "0024_opening_balances")
    with Session(engine) as db:
        assert db.get(Vendor, added["id"]).phoneNo == "11961234567"


def test_migration_preserves_prior_masters_accounts_and_constraints(migration_db):
    engine, config, actor_id, session_id = prepare(migration_db)
    command.downgrade(config, "0021_master_permissions")
    with Session(engine) as db:
        row = zones.create(db, identity(db, actor_id, session_id), ZoneFields(name="Preserved", status="active"))
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.get(Zone, row["id"]).name == "Preserved"
        assert db.get(User, actor_id).is_protected_system_admin
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "zone_create"))
        assert db.scalar(select(func.count()).select_from(Vendor)) == 0
        actor = identity(db, actor_id, session_id)
        created = vendors.create(db, actor, VendorFields(**FIELDS))
        for sql in ('UPDATE vendors SET version=0', "UPDATE vendors SET status='unknown'",
                    'UPDATE vendors SET "vendorName"=\' \'', 'UPDATE vendors SET "gstNo"=\'27ddddd3333d1z8\'',
                    'UPDATE vendors SET "dialCountry"=\'ZZ\'', 'UPDATE vendors SET "phoneNo"=\'123\'',
                    "UPDATE vendors SET deleted_at=now()"):
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(text(sql))
        vendors.mutate(db, actor, created["id"], VendorVersion(expected_version=1), "delete")
    with pytest.raises(RuntimeError, match="vendor history"):
        command.downgrade(config, "0021_master_permissions")
    with Session(engine) as db:
        assert db.get(Vendor, created["id"]).deleted_by == actor_id


def test_concurrent_duplicate_and_stale_mutations(migration_db):
    engine, _, actor_id, session_id = prepare(migration_db)
    barrier = Barrier(2)
    def create(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return vendors.create(db, actor, VendorFields(**{**FIELDS, "vendorName": "City" if index else " CITY "}))
            except vendors.VendorError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert "vendor_duplicate" in results
    row = next(r for r in results if isinstance(r, dict))
    barrier = Barrier(2)
    def mutate(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                body = VendorStatus(status="inactive", expected_version=1) if index else VendorVersion(expected_version=1)
                return vendors.mutate(db, actor, row["id"], body, "status" if index else "delete")
            except vendors.VendorError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(mutate, range(2)))
    assert sum(isinstance(r, dict) for r in results) == 1
    assert any(r in ("vendor_stale", "not_found") for r in results if isinstance(r, str))
    with Session(engine) as db:
        assert db.get(Vendor, row["id"]).version == 2
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(
            AuditEvent.action.in_(("vendor_status", "vendor_delete")))) == 1


def test_atomic_constraint_failure_rolls_back_rows_and_audit(migration_db, monkeypatch):
    engine, _, actor_id, session_id = prepare(migration_db)
    data = (HEADER + "First,27DDDDD3333D1Z8,A,C,c@example.test,9876543210,IN,active\n"
                    "Second,29EEEEE4444E1Z9,A,C,c@example.test,9876543210,IN,active").encode()
    original = vendors.insert
    calls = 0
    def conflict(db, actor, body):
        nonlocal calls
        calls += 1
        return original(db, actor, body if calls == 1 else VendorFields(**{**body.model_dump(), "gstNo": FIELDS["gstNo"]}))
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        report = vendor_transfer.transfer(db, actor, data, "vendors.csv")
        monkeypatch.setattr(vendors, "insert", conflict)
        with pytest.raises(vendors.VendorError, match="GST"):
            vendor_transfer.transfer(db, actor, data, "vendors.csv", True, report["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Vendor)) == 0
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "vendor_create")) == 0


def test_concurrent_imports_are_create_only_and_all_or_nothing(migration_db):
    engine, _, actor_id, session_id = prepare(migration_db)
    data = (HEADER + "Race one,27DDDDD3333D1Z8,A,C,c@example.test,9876543210,IN,active\n"
                    "Race two,29EEEEE4444E1Z9,A,C,c@example.test,501234567,AE,inactive").encode()
    barrier = Barrier(2)
    def run(_):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            review = vendor_transfer.transfer(db, actor, data, "race.csv")
            barrier.wait(timeout=10)
            try:
                return vendor_transfer.transfer(db, actor, data, "race.csv", True, review["digest"])
            except vendors.VendorError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sum(isinstance(r, dict) for r in results) == 1
    assert "vendor_import_conflict" in results or "vendor_duplicate" in results
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Vendor)) == 2
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "vendor_create")) == 2
