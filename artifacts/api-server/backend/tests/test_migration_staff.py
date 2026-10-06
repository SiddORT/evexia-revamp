"""Forward migration and independent-connection races on isolated schemas."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from alembic import command
from pydantic import SecretStr
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.bootstrap import bootstrap_super_admin
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.models import AuditEvent, AuthSession, MRProfile, User
from app.db.staff_models import StaffProfile
from app.schemas.staff import StaffFields, StaffStatus
from app.services.auth import Identity
from app.services import staff
from app.services.staff_crypto import StaffError
from test_migration_0006 import migration_db
from test_staff import BODY


def prepare(migration_db):
    engine, config = migration_db
    command.upgrade(config, "0008_activity_search")
    with Session(engine, expire_on_commit=False) as db:
        admin_id = bootstrap_super_admin(db, SecretStr("Synthetic disposable staff migration password")).user_id
        user = db.get(User, admin_id)
        session = AuthSession(user_id=user.id, expires_at=utcnow() + timedelta(hours=1),
                              token_version=user.token_version, identity_version=user.identity_version)
        db.add(session)
        db.add(AuditEvent(actor_id=admin_id, action="legacy_history", outcome="success"))
        legacy_id = uuid.uuid4()
        db.add(User(id=legacy_id, email="legacy@example.com", password_hash="existing-hash", system_role=None))
        mr_user = User(id=uuid.uuid4(), email="existing-mr@example.com", password_hash="existing-mr-hash", system_role="mr")
        db.add(mr_user)
        db.flush()
        db.add(MRProfile(id=uuid.uuid4(), user_id=mr_user.id, is_active=True))
        db.commit()
        session_id = session.id
    command.upgrade(config, "head")
    return engine, config, admin_id, session_id, legacy_id


def identity(db, user_id, session_id):
    return Identity(db.get(User, user_id), session_id=session_id)


def test_forward_staff_migration_preserves_accounts_sessions_history_and_constraints(migration_db):
    engine, config, admin_id, session_id, legacy_id = prepare(migration_db)
    with Session(engine, expire_on_commit=False) as db:
        assert db.scalar(select(func.count()).select_from(StaffProfile)) == 0
        assert db.get(User, legacy_id).password_hash == "existing-hash"
        assert db.get(User, admin_id).is_protected_system_admin
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        existing_mr = db.scalar(select(User).where(User.email == "existing-mr@example.com"))
        assert existing_mr.password_hash == "existing-mr-hash" and existing_mr.system_role == "mr"
        assert db.scalar(select(MRProfile).where(MRProfile.user_id == existing_mr.id)).is_active
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "legacy_history")) == 1
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.add(User(id=uuid.uuid4(), email=None, password_hash="invalid", username="unlinked"))
                db.flush()
                db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        result = staff.create(db, identity(db, admin_id, session_id), StaffFields(**BODY), get_settings())
        row_id = uuid.UUID(str(result["record"]["id"]))
        user_id = db.get(StaffProfile, row_id).user_id
        for sql, params in [
            ("UPDATE users SET system_role='mr' WHERE id=:id", {"id": user_id}),
            ("UPDATE users SET email='plaintext@example.com' WHERE id=:id", {"id": user_id}),
            ("UPDATE users SET username='replacement' WHERE id=:id", {"id": user_id}),
            ("DELETE FROM staff_profiles WHERE id=:id", {"id": row_id}),
        ]:
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(text(sql), params)
                    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    with pytest.raises(RuntimeError, match="Staff records exist"):
        command.downgrade(config, "0008_activity_search")


def test_committed_duplicate_create_race_and_stale_status_use_independent_connections(migration_db):
    engine, _config, admin_id, session_id, _legacy_id = prepare(migration_db)
    settings = get_settings()
    barrier = Barrier(2)
    def create():
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, admin_id, session_id)
            barrier.wait(timeout=10)
            try:
                return staff.create(db, actor, StaffFields(**BODY), settings)
            except StaffError as error:
                return error.code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: create(), range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "staff_duplicate" in results
    row = next(result["record"] for result in results if isinstance(result, dict))
    row_id = row["id"]
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(StaffProfile)) == 1
        assert db.scalar(select(func.count()).select_from(User)) == 4
    barrier = Barrier(2)
    def toggle():
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, admin_id, session_id)
            barrier.wait(timeout=10)
            try:
                return staff.edit(db, actor, settings, row_id, StaffStatus(status="inactive", expected_version=1), True)
            except StaffError as error:
                return error.code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: toggle(), range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "staff_stale" in results
    # New connection simulates restart/reload; committed data and hash persist.
    with Session(engine) as db:
        profile = db.get(StaffProfile, row_id)
        assert profile.status == "inactive" and profile.version == 2
        assert db.get(User, profile.user_id).password_hash.startswith("$argon2id$")
