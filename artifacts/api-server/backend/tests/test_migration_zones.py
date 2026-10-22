"""Forward migration and races use committed independent synthetic connections."""
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
from app.core.security import utcnow, hash_password
from app.db.models import AuditEvent, AuthSession, User
from app.db.zone_models import Zone
from app.schemas.zones import ZoneFields, ZoneStatus, ZoneVersion
from app.services.auth import Identity
from app.services import zones, zone_transfer
from test_migration_0006 import migration_db, upgrade_with_retirement_recovery


def prepare(fixture, *, target_revision=None):
    # Service/ORM scenarios need today's schema. Explicit historical targets
    # retain their original boundary and never acquire a current-model upgrade.
    current_models = target_revision is None
    target_revision = target_revision or "0035_account_identifiers"
    engine, config = fixture
    command.upgrade(config, "0009_staff")
    with Session(engine) as db:
        # Freeze the historical account contract. Current bootstrap/User reads
        # require ciphertext columns that did not exist at revision 0009.
        actor_id = uuid.uuid4()
        db.execute(text("SET LOCAL evexia.bootstrap_super_admin='on'"))
        db.execute(text("""INSERT INTO users
            (id,email,password_hash,is_active,token_version,system_role,
             identity_version,is_protected_system_admin)
            VALUES (:id,'crm-admin@allergyevexia.in',:password,true,0,'super_admin',0,true)"""),
            {"id": actor_id, "password": hash_password("Synthetic isolated zone migration password")})
        session = AuthSession(user_id=actor_id, expires_at=utcnow() + timedelta(hours=1),
                              token_version=0, identity_version=0)
        db.add(session)
        db.add(AuditEvent(actor_id=actor_id, action="before_zone_migration", outcome="success"))
        db.commit()
        session_id = session.id
    if target_revision in ("0034_shared_phone_countries", "0035_account_identifiers"):
        upgrade_with_retirement_recovery(engine, config, target_revision=target_revision,
                                         current_models=current_models)
    else:
        # Only explicitly named pre-retirement boundaries are accepted here.
        from alembic.script import ScriptDirectory
        graph = ScriptDirectory.from_config(config)
        allowed = {revision.revision for revision in graph.walk_revisions(
            "0009_staff", "0029_directory_crypto_additive")}
        if target_revision not in allowed | {"0009_staff"}:
            raise ValueError("Unsupported historical identity target")
        command.upgrade(config, target_revision)
    return engine, config, actor_id, session_id


def identity(db, actor_id, session_id):
    return Identity(db.get(User, actor_id), session_id=session_id)


def historical_zone(db, actor_id, session_id, name):
    """Seed the original zone/audit contract without current auth queries."""
    row = Zone(name=name, status="active", version=1, created_by=actor_id, updated_by=actor_id)
    db.add(row); db.flush()
    db.add(AuditEvent(actor_id=actor_id, session_id=session_id, action="zone_create",
                      outcome="success", resource_type="zone", resource_id=str(row.id)))
    db.commit()
    return {"id": row.id}


def test_migration_preserves_identity_and_enforces_constraints(migration_db):
    engine, config, actor_id, session_id = prepare(migration_db)
    with Session(engine) as db:
        assert db.get(User, actor_id).is_protected_system_admin
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "before_zone_migration"))
        assert db.scalar(select(func.count()).select_from(Zone)) == 0
        actor = identity(db, actor_id, session_id)
        row = zones.create(db, actor, ZoneFields(name="Immutable history", status="active"))
        for sql in ("UPDATE zones SET status='unknown'", "UPDATE zones SET version=0",
                    "UPDATE zones SET name=' '", "UPDATE zones SET deleted_at=now()"):
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(text(sql))
        deleted = zones.mutate(db, actor, row["id"], ZoneVersion(expected_version=1), "delete")
        assert deleted["version"] == 2
    with Session(engine) as db:
        historical = db.get(Zone, row["id"])
        assert historical.deleted_by == actor_id and historical.deleted_at is not None
        assert historical.created_by == actor_id and historical.updated_by == actor_id
        assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "zone_delete"))


def test_duplicate_and_stale_races(migration_db):
    engine, _, actor_id, session_id = prepare(migration_db)
    barrier = Barrier(2)
    def create(_):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return zones.create(db, actor, ZoneFields(name="Concurrent", status="inactive"))
            except zones.ZoneError as error:
                return error.code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(create, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "zone_duplicate" in results
    row = next(result for result in results if isinstance(result, dict))
    barrier = Barrier(2)
    def update(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                body = ZoneStatus(status="active", expected_version=1) if index == 0 else ZoneVersion(expected_version=1)
                return zones.mutate(db, actor, row["id"], body, "status" if index == 0 else "delete")
            except zones.ZoneError as error:
                return error.code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(update, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "zone_stale" in results or "not_found" in results
    with Session(engine) as db:
        assert db.get(Zone, row["id"]).version == 2


def test_import_flush_conflict_rolls_back_complete_batch(migration_db, monkeypatch):
    engine, _, actor_id, session_id = prepare(migration_db)
    data = b"Zone Name,Status\nFirst,active\nSecond,active"
    original = zones.insert
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        review = zone_transfer.transfer(db, actor, data, "zones.csv")
        calls = 0
        def conflict(db, actor, body):
            nonlocal calls
            calls += 1
            return original(db, actor, body if calls == 1 else ZoneFields(name="First", status="active"))
        monkeypatch.setattr(zones, "insert", conflict)
        with pytest.raises(zones.ZoneError, match="already uses"):
            zone_transfer.transfer(db, actor, data, "zones.csv", True, review["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Zone)) == 0
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "zone_create")) == 0


@pytest.mark.parametrize("race", ["restore", "create"])
def test_restore_races_keep_one_live_name_and_atomic_audit(migration_db, race):
    engine, _, actor_id, session_id = prepare(migration_db)
    with Session(engine) as db:
        actor = identity(db, actor_id, session_id)
        row = zones.create(db, actor, ZoneFields(name="Restore race", status="inactive"))
        zones.mutate(db, actor, row["id"], ZoneVersion(expected_version=1), "delete")
    barrier = Barrier(2)
    def compete(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                if index == 1 and race == "create":
                    return zones.create(db, actor, ZoneFields(name="RESTORE RACE", status="active"))
                return zones.restore(db, actor, row["id"], ZoneVersion(expected_version=2))
            except zones.ZoneError as error:
                return error.code
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(compete, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert ("zone_stale" if race == "restore" else "zone_duplicate") in results
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Zone).where(Zone.deleted_at.is_(None))) == 1
        restored = db.get(Zone, row["id"])
        restore_events = db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "zone_restore"))
        assert restore_events == (0 if restored.deleted_at else 1)
        assert restored.version == (2 if restored.deleted_at else 3)
        assert restored.created_by == actor_id
