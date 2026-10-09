"""Forward migration and real connection races for business-only roles."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import User, AuthSession, AuditEvent
from app.db.role_models import CustomRole
from app.schemas.roles import RoleFields, RoleEdit, RoleVersion
from app.services import roles
from test_migration_0006 import migration_db
from test_migration_staff import prepare, identity


def test_migration_empty_preserves_identity_and_db_normalization(migration_db):
    engine, config, admin_id, session_id, legacy_id = prepare(migration_db)
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(CustomRole)) == 0
        assert db.get(User, admin_id).is_protected_system_admin
        assert db.get(User, legacy_id).password_hash == "existing-hash"
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "legacy_history")) == 1
        row_id = uuid.uuid4()
        db.execute(text("INSERT INTO custom_roles(id,name,description,version,created_by,updated_by) VALUES (:id,' Mixed Case ','',1,:actor,:actor)"), {"id": row_id, "actor": admin_id})
        db.commit()
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.execute(text("INSERT INTO custom_roles(id,name,description,version,created_by,updated_by) VALUES (:id,'mixed case','',1,:actor,:actor)"), {"id": uuid.uuid4(), "actor": admin_id})
    with pytest.raises(RuntimeError, match="Populated role downgrade"):
        command.downgrade(config, "0009_staff")


def test_concurrent_duplicate_edits_and_deletes_commit_atomically(migration_db):
    engine, config, admin_id, session_id, _ = prepare(migration_db)
    command.upgrade(config, "head")
    def race(operation):
        barrier = Barrier(2)
        def run(index):
            with Session(engine, expire_on_commit=False) as db:
                actor = identity(db, admin_id, session_id)
                barrier.wait(timeout=10)
                try:
                    return operation(db, actor, index)
                except roles.RoleError as error:
                    return error.code
        with ThreadPoolExecutor(max_workers=2) as executor:
            return list(executor.map(run, range(2)))
    results = race(lambda db, actor, n: roles.mutate(db, actor, RoleFields(name="Reviewer" if n else " reviewer ")))
    assert sum(isinstance(r, dict) for r in results) == 1 and "role_duplicate" in results
    row = next(r for r in results if isinstance(r, dict))
    results = race(lambda db, actor, n: roles.mutate(db, actor, RoleEdit(name=f"Revised {n}", expected_version=1), row["id"]))
    assert sum(isinstance(r, dict) for r in results) == 1 and "role_stale" in results
    results = race(lambda db, actor, n: roles.mutate(db, actor, RoleVersion(expected_version=2), row["id"], deleting=True))
    assert sum(isinstance(r, dict) for r in results) == 1 and "role_deleted" in results
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(CustomRole)) == 1
        retained = db.get(CustomRole, row["id"])
        assert retained.deleted_at == retained.updated_at and retained.deleted_by == admin_id
        assert retained.created_by == admin_id and retained.updated_by == admin_id and retained.version == 3
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.resource_type == "custom_role")) == 3
