"""Independent committed transactions verify rollout, races and reference locks."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from decimal import Decimal
import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, DataError
from sqlalchemy.orm import Session
from app.db.models import AuditEvent, User, AuthSession
from app.db.allergen_models import AllergenProduct
from app.db.product_category_models import ProductCategory
from app.db.location_models import StorageLocation
from app.schemas.allergens import AllergenFields, AllergenStatus, AllergenVersion
from app.services import allergens, allergen_transfer
from app.services.auth import AuthError
from test_migration_0006 import migration_db
from test_migration_zones import prepare, identity


def setup_refs(engine, actor_id):
    with Session(engine) as db:
        c = ProductCategory(name="Shared category", unit_price=Decimal("0"), status="active",
                            created_by=actor_id, updated_by=actor_id)
        l = StorageLocation(name="Shared location", address="Lab", status="active",
                            created_by=actor_id, updated_by=actor_id)
        db.add_all([c, l]); db.flush()
        ids = c.id, l.id
        db.commit()
        return ids


def fields(c, l, name="Reagent"):
    return AllergenFields(name=name, category_id=c, storage_location_id=l, selling_price="999999999999.999999",
                          gst="0", concentration="1:10", threshold_limit=None, mix=True, status="active")


def test_forward_empty_rollout_preserves_categories_locations_and_accounts(migration_db):
    engine, config, actor_id, sid = prepare(migration_db)
    command.downgrade(config, "0021_master_permissions")
    c, l = setup_refs(engine, actor_id)
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.get(User, actor_id).is_protected_system_admin and db.get(AuthSession, sid).status == "ACTIVE"
        assert db.get(ProductCategory, c).name == "Shared category" and db.get(StorageLocation, l).name == "Shared location"
        assert db.scalar(select(func.count()).select_from(AllergenProduct)) == 0
        row = allergens.create(db, identity(db, actor_id, sid), fields(c, l))
        for sql in ("UPDATE allergen_products SET name=' '", "UPDATE allergen_products SET concentration=''",
                    "UPDATE allergen_products SET version=0", "UPDATE allergen_products SET status='unknown'",
                    "UPDATE allergen_products SET selling_price=-1", "UPDATE allergen_products SET selling_price='NaN'",
                    "UPDATE allergen_products SET gst=101", "UPDATE allergen_products SET threshold_limit=-1",
                    "UPDATE allergen_products SET deleted_at=now()"):
            with pytest.raises((IntegrityError, DataError)):
                with db.begin_nested():
                    db.execute(text(sql))
        allergens.mutate(db, identity(db, actor_id, sid), row["id"], AllergenVersion(expected_version=1), "delete")
    with Session(engine) as db:
        deleted = db.get(AllergenProduct, row["id"])
        assert deleted.deleted_by == actor_id and deleted.version == 2 and deleted.created_by == actor_id


def test_concurrent_duplicate_and_stale_status_delete(migration_db):
    engine, _, actor_id, sid = prepare(migration_db)
    c, l = setup_refs(engine, actor_id)
    barrier = Barrier(2)
    def create(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(timeout=10)
            try:
                return allergens.create(db, actor, fields(c, l, "Reagent" if index else "  REAGENT "))
            except allergens.AllergenError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert "allergen_duplicate" in results
    row = next(result for result in results if isinstance(result, dict))
    barrier = Barrier(2)
    def change(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, sid)
            barrier.wait(timeout=10)
            try:
                return allergens.mutate(db, actor, row["id"],
                    AllergenStatus(status="inactive", expected_version=1) if index else AllergenVersion(expected_version=1),
                    "status" if index else "delete")
            except allergens.AllergenError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "allergen_stale" in results or "not_found" in results


def test_concurrent_imports_and_revoked_session(migration_db):
    engine, _, actor_id, sid = prepare(migration_db)
    setup_refs(engine, actor_id)
    data = allergen_transfer.encode([allergen_transfer.HEADERS[:9],
        ["Batch", "Shared category", "", "0", "Shared location", "1:10", "", "active", "Mix"]], "csv")
    barrier = Barrier(2)
    def run(_):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, sid)
            report = allergen_transfer.transfer(db, actor, data, "batch.csv")
            barrier.wait(timeout=10)
            try:
                return allergen_transfer.transfer(db, actor, data, "batch.csv", True, report["digest"])
            except allergens.AllergenError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "allergen_import_conflict" in results or "allergen_duplicate" in results
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, sid)
        with Session(engine) as other:
            other.execute(text("UPDATE auth_sessions SET status='REVOKED',revoked_at=now() WHERE id=:id"), {"id": sid})
            other.commit()
        for operation in (lambda: allergens.listing(db, actor), lambda: allergen_transfer.transfer(db, actor, data, "batch.csv"),
                          lambda: allergen_transfer.export(db, actor)):
            with pytest.raises(AuthError):
                operation()
        assert db.scalar(select(func.count()).select_from(AllergenProduct)) == 1
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "allergen_create")) == 1


def test_reference_change_waits_for_catalogue_transaction(migration_db, monkeypatch):
    engine, _, actor_id, sid = prepare(migration_db)
    c, l = setup_refs(engine, actor_id)
    locked, release, started, changed = Event(), Event(), Event(), Event()
    original = allergens.validate_references
    def hold(db, body, existing=None):
        original(db, body, existing)
        locked.set()
        assert release.wait(10)
    monkeypatch.setattr(allergens, "validate_references", hold)
    def save():
        with Session(engine) as db:
            return allergens.create(db, identity(db, actor_id, sid), fields(c, l))
    def deactivate():
        with Session(engine) as db:
            started.set()
            db.execute(text("UPDATE product_categories SET status='inactive',version=version+1 WHERE id=:id"), {"id": c})
            db.commit()
            changed.set()
    with ThreadPoolExecutor(max_workers=2) as pool:
        product = pool.submit(save)
        assert locked.wait(10)
        update = pool.submit(deactivate)
        assert started.wait(10)
        assert not changed.wait(.2)
        release.set()
        row = product.result(timeout=10)
        update.result(timeout=10)
    with Session(engine) as db:
        assert db.get(AllergenProduct, row["id"]).category_id == c and db.get(ProductCategory, c).status == "inactive"
