"""Migration preservation, independent committed races, service-boundary denial."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, DataError
from sqlalchemy.orm import Session
from app.db.models import User, AuthSession, AuditEvent
from app.db.product_category_models import ProductCategory
from app.db.designation_models import Designation
from app.db.headquarter_models import Headquarter
from app.schemas.headquarters import HeadquarterFields
from app.schemas.designations import DesignationFields
from app.schemas.product_categories import ProductCategoryFields, ProductCategoryStatus, ProductCategoryVersion
from app.services import product_categories, product_category_transfer, designations
from app.services import headquarters
from app.services.auth import AuthError
from test_migration_0006 import migration_db
from test_migration_zones import prepare, identity


def test_forward_empty_migration_preserves_foundations(migration_db):
    engine, config, actor_id, session_id = prepare(migration_db)
    command.downgrade(config, "0017_headquarters")
    with Session(engine) as db:
        existing = designations.create(db, identity(db, actor_id, session_id),
                                       DesignationFields(name="Preserved", shortName="PR", level=1, status="active"))
        hq = headquarters.create(db, identity(db, actor_id, session_id), HeadquarterFields(name="Preserved HQ", status="active"))
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.get(Designation, existing["id"]).name == "Preserved"
        assert db.get(Headquarter, hq["id"]).name == "Preserved HQ"
        assert db.get(User, actor_id).is_protected_system_admin
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "designation_create"))
        assert db.scalar(select(func.count()).select_from(ProductCategory)) == 0
        actor = identity(db, actor_id, session_id)
        row = product_categories.create(db, actor, ProductCategoryFields(unit_price="0", name="History", status="active"))
        for sql in ("UPDATE product_categories SET version=0", "UPDATE product_categories SET status='unknown'",
                    "UPDATE product_categories SET name=' '", "UPDATE product_categories SET unit_price=-1",
                    "UPDATE product_categories SET unit_price='NaN'", "UPDATE product_categories SET description=repeat('A',2001)",
                    "UPDATE product_categories SET deleted_at=now()"):
            with pytest.raises((IntegrityError, DataError)):
                with db.begin_nested():
                    db.execute(text(sql))
        product_categories.mutate(db, actor, row["id"], ProductCategoryVersion(expected_version=1), "delete")
    with Session(engine) as db:
        deleted = db.get(ProductCategory, row["id"])
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
                return product_categories.create(db, actor, ProductCategoryFields(unit_price="0", name="North City" if index else " north   CITY ", status="inactive"))
            except product_categories.ProductCategoryError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert "product_category_duplicate" in results
    row = next(result for result in results if isinstance(result, dict))
    barrier = Barrier(2)
    def change(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return product_categories.mutate(db, actor, row["id"],
                    ProductCategoryStatus(status="active", expected_version=1) if index else ProductCategoryVersion(expected_version=1),
                    "status" if index else "delete")
            except product_categories.ProductCategoryError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "product_category_stale" in results or "not_found" in results


def test_concurrent_imports_and_transactional_rollback(migration_db, monkeypatch):
    engine, _, actor_id, session_id = prepare(migration_db)
    data = b"Product Category Name,Description,Unit Price,Status\nRace one,,0,active\nRace two,CUSTOM,125.5,inactive"
    barrier = Barrier(2)
    def run(_):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            review = product_category_transfer.transfer(db, actor, data, "race.csv")
            barrier.wait(timeout=10)
            try:
                return product_category_transfer.transfer(db, actor, data, "race.csv", True, review["digest"])
            except product_categories.ProductCategoryError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "product_category_import_conflict" in results or "product_category_duplicate" in results
    original = product_categories.insert
    data = b"Product Category Name,Description,Unit Price,Status\nFirst,,0,active\nSecond,,0,inactive"
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        review = product_category_transfer.transfer(db, actor, data, "batch.csv")
        calls = 0
        def conflict(db, actor, body):
            nonlocal calls
            calls += 1
            return original(db, actor, body if calls == 1 else ProductCategoryFields(unit_price="0", name=" first ", status="active"))
        monkeypatch.setattr(product_categories, "insert", conflict)
        with pytest.raises(product_categories.ProductCategoryError):
            product_category_transfer.transfer(db, actor, data, "batch.csv", True, review["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(ProductCategory)) == 2
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "product_category_create")) == 2


def test_service_commit_and_export_revalidate_revoked_session(migration_db):
    engine, _, actor_id, session_id = prepare(migration_db)
    data = b"Product Category Name,Description,Unit Price,Status\nBound,,0,active"
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        report = product_category_transfer.transfer(db, actor, data, "hq.csv")
        with Session(engine) as other:
            other.execute(text("UPDATE auth_sessions SET status='REVOKED',revoked_at=now() WHERE id=:id"), {"id": session_id})
            other.commit()
        with pytest.raises(AuthError):
            product_category_transfer.transfer(db, actor, data, "hq.csv", True, report["digest"])
        with pytest.raises(AuthError):
            product_category_transfer.export(db, actor, "", "all", "csv")
        assert db.scalar(select(func.count()).select_from(ProductCategory)) == 0
