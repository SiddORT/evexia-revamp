"""Exercise the real 0059 -> 0060 backfill in a disposable historical schema."""
from datetime import date
from pathlib import Path
import tempfile
import uuid

from alembic import command
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.designation_models import Designation
from app.db.models import User
from app.db.staff_models import StaffProfile
from app.services import account_crypto
from app.services.staff_crypto import StaffCrypto
from app.core.config import get_settings
from test_migration_0006 import migration_db, upgrade_with_retirement_recovery
from test_reference_privacy_migration import evidence, approve


def prepare(migration_db):
    engine, config = migration_db
    upgrade_with_retirement_recovery(engine, config)
    with tempfile.TemporaryDirectory(prefix="evexia-staff-number-test-") as folder:
        approve(config, evidence(engine, Path(folder) / "backup.dump"))
        command.upgrade(config, "0059_staff_unified_access")
    with Session(engine) as db:
        # Historical bootstrap uses the same transaction-local gate as the
        # supported bootstrap entry point, before 0060 reserves EVX-001.
        db.execute(text("SELECT set_config('evexia.bootstrap_super_admin', 'on', true)"))
        admin = User(email="crm-admin@allergyevexia.in", username="original-admin",
                     password_hash="retained-admin-hash", system_role="super_admin",
                     is_active=True, is_protected_system_admin=True)
        db.add(admin)
        db.flush()
        designation = Designation(id=uuid.uuid4(), name="Synthetic designation",
                                  shortName="SYN", status="active",
                                  created_by=admin.id, updated_by=admin.id)
        db.add(designation)
        db.flush()
        user = User(username="legacy-staff-label", password_hash="retained-staff-hash",
                    is_active=False, token_version=3, identity_version=4)
        db.add(user)
        db.flush()
        key = uuid.uuid4()
        crypto = StaffCrypto(get_settings())
        profile = StaffProfile(
            id=key, user_id=user.id, designation_id=designation.id,
            name_ciphertext=crypto.encrypt(key, "name", "Synthetic staff"),
            email_ciphertext=crypto.encrypt(key, "email", "staff@example.test"),
            phone_ciphertext=crypto.encrypt(key, "phone", "9876543210"),
            email_index=crypto.email_index("staff@example.test"), dial_country="IN",
            role="Synthetic role", employee_code="UNCHANGED-CODE",
            joining_date=date(2025, 1, 1), status="inactive",
            created_by=admin.id, updated_by=admin.id)
        db.add(profile)
        db.commit()
        identifiers = admin.id, user.id, profile.id
    return engine, config, identifiers


def guards(db):
    return tuple(db.scalar(text(f"SELECT pg_get_functiondef('{name}()'::regprocedure)"))
                 for name in ("evexia_protect_super_admin", "evexia_staff_immutable_identity"))


def test_populated_upgrade_preserves_credentials_reservations_and_guards(migration_db):
    engine, config, (admin_id, staff_id, profile_id) = prepare(migration_db)
    with Session(engine) as db:
        before_guards = guards(db)
        user = db.get(User, staff_id)
        before = (user.password_hash, user.token_version, user.identity_version,
                  user.updated_at, user.is_active)
        aliases = db.execute(text("SELECT * FROM staff_login_identifiers")).all()
    command.upgrade(config, "0060_staff_account_numbers")
    with Session(engine) as db:
        assert guards(db) == before_guards
        user = db.get(User, staff_id)
        assert user.username == "EVX-002"
        assert db.get(User, admin_id).username == "EVX-001"
        assert before == (user.password_hash, user.token_version, user.identity_version,
                          user.updated_at, user.is_active)
        assert db.get(StaffProfile, profile_id).employee_code == "UNCHANGED-CODE"
        assert db.execute(text("SELECT * FROM staff_login_identifiers")).all() == aliases
        rows = db.execute(text(
            "SELECT user_id,field,identifier,identifier_index "
            "FROM account_identifier_reservations WHERE user_id=:id"),
            {"id": staff_id}).mappings()
        assert {account_crypto.read(r["user_id"], r["field"], r["identifier"], r["identifier_index"])
                for r in rows} >= {"legacy-staff-label", "EVX-002"}
        with pytest.raises(IntegrityError, match="immutable staff credentials identity"):
            with db.begin_nested():
                user.username = "forbidden-rename"
                db.flush()
        with pytest.raises(IntegrityError, match="immutable staff identity"):
            with db.begin_nested():
                db.execute(text("UPDATE staff_profiles SET created_at=created_at+interval '1 second' WHERE id=:id"),
                           {"id": profile_id})
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.execute(text("UPDATE users SET is_active=false WHERE id=:id"), {"id": admin_id})


def test_failed_backfill_rolls_back_identity_guards_and_labels(migration_db, monkeypatch):
    engine, config, (admin_id, staff_id, _) = prepare(migration_db)
    from app.services import staff_account_numbers
    with engine.connect() as db:
        before = guards(db)

    def fail_after_admin(*args):
        raise RuntimeError("synthetic failure after Admin rename")

    monkeypatch.setattr(staff_account_numbers, "allocate", fail_after_admin)
    with pytest.raises(RuntimeError, match="synthetic failure"):
        command.upgrade(config, "0060_staff_account_numbers")
    with Session(engine) as db:
        assert guards(db) == before
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0059_staff_unified_access"
        assert db.get(User, admin_id).username == "original-admin"
        assert db.get(User, staff_id).username == "legacy-staff-label"
        assert not db.scalar(text(
            "SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname=current_schema() AND c.relname='staff_account_number_seq')"))


def test_unexpected_staff_guard_stops_before_any_account_rename(migration_db):
    engine, config, (admin_id, staff_id, _) = prepare(migration_db)
    with engine.begin() as db:
        original = guards(db)[1]
        # Equivalent but unreviewed definition must not be silently replaced.
        db.execute(text(original.replace(
            " OR NEW.username IS DISTINCT FROM OLD.username",
            " OR (NEW.username IS DISTINCT FROM OLD.username)")))
        before = guards(db)
    with pytest.raises(account_crypto.AccountCryptoError, match="Staff identity guard differs"):
        command.upgrade(config, "0060_staff_account_numbers")
    with Session(engine) as db:
        assert guards(db) == before
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0059_staff_unified_access"
        assert db.get(User, admin_id).username == "original-admin"
        assert db.get(User, staff_id).username == "legacy-staff-label"
