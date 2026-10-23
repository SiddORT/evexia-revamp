"""Real PostgreSQL migration proofs for encrypted EVX labels."""
import uuid
from datetime import timedelta

import pytest
from alembic import command
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.bootstrap import bootstrap_super_admin
from app.core.security import utcnow
from app.db.models import AuditEvent, AuthSession, MRProfile, RefreshSession, User
from app.services.account_crypto import AccountCryptoError, ready, read
from app.services.staff_account_numbers import allocate
from pydantic import SecretStr
from staff_number_fixture import (
    numbers_db, seed_admin, seed_staff, snapshot, TARGET, PREVIOUS, STAMP, PASSWORD,
)


def rerun(engine, config):
    migration = ScriptDirectory.from_config(config).get_revision(TARGET).module
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()


def test_populated_backfill_order_ciphertext_history_and_reruns(numbers_db):
    engine, config = numbers_db
    with Session(engine, expire_on_commit=False) as db:
        admin, designation, role = seed_admin(db)
        # Insert in reverse UUID order, with tied timestamps: order must be
        # created_at then profile UUID, not insert order or user UUID.
        later = seed_staff(db, admin, designation, role, "later", created_at=STAMP + timedelta(days=1))
        second = seed_staff(db, admin, designation, role, "second", deleted=True,
                            profile_id=uuid.UUID(int=20))
        first = seed_staff(db, admin, designation, role, "first", profile_id=uuid.UUID(int=10))
        retained = seed_staff(db, admin, designation, role, "retained", label="evx-0007")
        # A previous alias stays reserved even after being replaced.
        # A retained historical reservation can exist without a current alias.
        current = ready(db)
        db.execute(text("""
            INSERT INTO account_identifier_reservations(identifier_index,identifier,user_id,field)
            VALUES (:digest,:ciphertext,:owner,'username')
        """), {"digest": current.lookup_index("evx-015"),
               "ciphertext": current.encrypt(retained[0], "username", "EVX-015"),
               "owner": retained[0]})
        db.commit()
        already = seed_staff(db, admin, designation, role, "already", label="evx-0004")
        mr = User(email="unrelated@example.com", username="unrelated.mr",
                  password_hash="synthetic-inert-hash", system_role="mr")
        db.add(mr)
        db.flush()
        db.add(MRProfile(user_id=mr.id, is_active=True))
        session = AuthSession(user_id=admin, token_version=7, identity_version=3,
                              expires_at=utcnow() + timedelta(days=1))
        db.add(session)
        db.flush()
        db.add(RefreshSession(user_id=admin, session_id=session.id,
                              token_hash="a" * 64, family_id=session.family_id,
                              identity_version=3, expires_at=session.expires_at,
                              family_expires_at=session.expires_at))
        db.add(AuditEvent(actor_id=admin, session_id=session.id,
                          action="synthetic_retained_history", outcome="success"))
        db.commit()
    tables = ("staff_profiles", "auth_sessions", "refresh_sessions", "audit_events", "mr_profiles",
              "staff_login_identifiers")
    before = {table: snapshot(engine, table) for table in tables}
    users = snapshot(engine, "users")
    reservations = snapshot(engine, "account_identifier_reservations")
    with engine.connect() as db:
        guards = {name: db.scalar(text(f"SELECT pg_get_functiondef('{name}()'::regprocedure)"))
                  for name in ("evexia_protect_super_admin", "evexia_staff_immutable_identity")}
    command.upgrade(config, TARGET)
    expected = {admin: "EVX-001", first[0]: "EVX-016", second[0]: "EVX-017",
                retained[0]: "EVX-007", later[0]: "EVX-018", already[0]: "EVX-004"}
    with Session(engine) as db:
        for owner, value in expected.items():
            assert db.get(User, owner).username == value
        assert db.get(User, mr.id).username == "unrelated.mr"
    for table in tables:
        assert snapshot(engine, table) == before[table], table
    ignored = {"username", "username_index"}
    assert [{k: v for k, v in row.items() if k not in ignored} for row in snapshot(engine, "users")] == [
        {k: v for k, v in row.items() if k not in ignored} for row in users]
    after_reservations = snapshot(engine, "account_identifier_reservations")
    assert all(row in after_reservations for row in reservations)
    for row in snapshot(engine, "users"):
        for field in ("username", "email"):
            assert row[field] is None or row[field].startswith("v1:")
    for row in after_reservations:
        assert row["identifier"].startswith("v1:")
        assert read(row["user_id"], row["field"], row["identifier"], row["identifier_index"])
    stable = {table: snapshot(engine, table) for table in (*tables, "users", "account_identifier_reservations")}
    command.upgrade(config, TARGET)  # Normal Alembic retry is a no-op.
    rerun(engine, config)  # The backfill itself must also be idempotent.
    assert {table: snapshot(engine, table) for table in stable} == stable
    with Session(engine) as db:
        assert allocate(db) == "EVX-019"
        db.commit()
    rerun(engine, config)
    with Session(engine) as db:
        assert allocate(db) == "EVX-020"  # Rerun must not reset an advanced allocator.
        db.commit()
    with engine.connect() as db:
        for name, original in guards.items():
            assert db.scalar(text(f"SELECT pg_get_functiondef('{name}()'::regprocedure)")) == original
    with pytest.raises(RuntimeError, match="forward recovery"):
        command.downgrade(config, PREVIOUS)


def test_empty_install_reserves_admin_and_bootstrap_is_idempotent(numbers_db):
    engine, config = numbers_db
    command.upgrade(config, TARGET)
    assert snapshot(engine, "users") == []
    with Session(engine, expire_on_commit=False) as db:
        assert allocate(db) == "EVX-002"
        db.commit()
        created = bootstrap_super_admin(db, SecretStr(PASSWORD))
        admin = db.get(User, created.user_id)
        assert admin.username == "EVX-001" and admin.email == "crm-admin@allergyevexia.in"
        original = snapshot(engine, "users")
        assert not bootstrap_super_admin(db, None).created
        assert snapshot(engine, "users") == original
        assert allocate(db) == "EVX-003"
        db.commit()


@pytest.mark.parametrize("conflict", ["admin", "numeric_owners", "zero", "overflow"])
def test_conflicts_abort_without_partial_renaming_or_guard_changes(numbers_db, conflict):
    engine, config = numbers_db
    with Session(engine, expire_on_commit=False) as db:
        admin, designation, role = seed_admin(db)
        seed_staff(db, admin, designation, role, "first")
        label = {"admin": "EVX-001", "numeric_owners": "EVX-009",
                 "zero": "EVX-000", "overflow": "EVX-9223372036854775807"}[conflict]
        seed_staff(db, admin, designation, role, "conflict", label=label)
        if conflict == "numeric_owners":
            seed_staff(db, admin, designation, role, "other", code="evx-0009")
    before = {table: snapshot(engine, table) for table in (
        "users", "staff_profiles", "account_identifier_reservations", "staff_login_identifiers")}
    with engine.connect() as db:
        guard = db.scalar(text("SELECT pg_get_functiondef('evexia_protect_super_admin()'::regprocedure)"))
    with pytest.raises(AccountCryptoError, match="review"):
        command.upgrade(config, TARGET)
    assert {table: snapshot(engine, table) for table in before} == before
    with engine.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == PREVIOUS
        assert db.scalar(text("SELECT pg_get_functiondef('evexia_protect_super_admin()'::regprocedure)")) == guard
        assert db.scalar(text("SELECT to_regclass('staff_account_number_seq')")) is None


def test_late_failure_restores_both_guards_accounts_and_reservations(numbers_db, monkeypatch):
    """A failure after Admin and the first Staff rename rolls back everything."""
    from app.services import staff_account_numbers
    engine, config = numbers_db
    with Session(engine, expire_on_commit=False) as db:
        admin, designation, role = seed_admin(db)
        seed_staff(db, admin, designation, role, "first")
        seed_staff(db, admin, designation, role, "second")
    tables = ("users", "staff_profiles", "account_identifier_reservations", "staff_login_identifiers")
    before = {table: snapshot(engine, table) for table in tables}
    names = ("evexia_protect_super_admin", "evexia_staff_immutable_identity")
    with engine.connect() as db:
        guards = {name: db.scalar(text(f"SELECT pg_get_functiondef('{name}()'::regprocedure)"))
                  for name in names}
    original = staff_account_numbers.allocate
    calls = []

    def fail_second(db):
        calls.append(1)
        if len(calls) == 2:
            # Prove the test fails AFTER actual changes, not at preflight.
            assert db.get(User, admin).username == "EVX-001"
            assert "EVX-002" in [user.username for user in db.query(User).all()]
            raise AccountCryptoError("Synthetic late failure requires operator review.")
        return original(db)

    monkeypatch.setattr(staff_account_numbers, "allocate", fail_second)
    with pytest.raises(AccountCryptoError, match="Synthetic late failure"):
        command.upgrade(config, TARGET)
    assert len(calls) == 2
    assert {table: snapshot(engine, table) for table in tables} == before
    with engine.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == PREVIOUS
        for name, definition in guards.items():
            assert db.scalar(text(f"SELECT pg_get_functiondef('{name}()'::regprocedure)")) == definition
    monkeypatch.setattr(staff_account_numbers, "allocate", original)
    command.upgrade(config, TARGET)


def test_unreviewed_staff_guard_is_rejected_without_overwriting_it(numbers_db):
    engine, config = numbers_db
    with Session(engine) as db:
        seed_admin(db)
    with engine.begin() as db:
        original = db.scalar(text(
            "SELECT pg_get_functiondef('evexia_staff_immutable_identity()'::regprocedure)"))
        # Semantically identical but not the reviewed source fragment.
        changed = original.replace("OR NEW.username IS DISTINCT FROM OLD.username",
                                   "OR (NEW.username IS DISTINCT FROM OLD.username)")
        assert changed != original
        db.execute(text(changed))
    before = snapshot(engine, "users")
    with pytest.raises(AccountCryptoError, match="Staff identity guard differs"):
        command.upgrade(config, TARGET)
    assert snapshot(engine, "users") == before
    with engine.connect() as db:
        assert db.scalar(text(
            "SELECT pg_get_functiondef('evexia_staff_immutable_identity()'::regprocedure)")) == changed
