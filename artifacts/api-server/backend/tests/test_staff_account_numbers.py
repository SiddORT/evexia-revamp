"""Allocation, write-boundary and credential separation on disposable PostgreSQL."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from alembic import command
from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import User
from app.db.staff_models import StaffProfile
from app.services import auth, staff
from app.services.account_crypto import AccountCryptoError
from app.services.staff_account_numbers import allocate, assert_available
from app.services.staff_identifiers import resolve, save_identifiers
from app.services.staff_crypto import StaffCrypto
from staff_number_fixture import numbers_db, seed_admin, seed_staff, body, TARGET, PASSWORD


def setup(engine, config):
    with Session(engine, expire_on_commit=False) as db:
        ids = seed_admin(db)
    command.upgrade(config, TARGET)
    return ids


def test_concurrent_real_creates_are_unique_and_committed(numbers_db):
    engine, config = numbers_db
    admin, designation, role = setup(engine, config)
    with Session(engine) as db:
        # Share one authorized session. Independent admin logins intentionally
        # replace each other and would test session revocation, not allocation.
        actor, _ = auth.login(db, "crm-admin@allergyevexia.in", PASSWORD,
                             get_settings(), False, "concurrent-create", "192.0.2.1",
                             portal="admin")
        session_id = actor.session_id
    barrier = Barrier(4)

    def create(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = auth.Identity(db.get(User, admin), session_id=session_id)
            barrier.wait(timeout=10)
            result = staff.create(db, actor, body(designation, role, str(index)), get_settings())
            profile = db.get(StaffProfile, result["record"]["id"])
            return profile.user_id, db.get(User, profile.user_id).username

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(create, range(4)))
    assert {label for _, label in results} == {"EVX-002", "EVX-003", "EVX-004", "EVX-005"}
    assert len({owner for owner, _ in results}) == 4
    with Session(engine) as db:
        for owner, label in results:
            assert db.get(User, owner).username == label
            assert resolve(db, label.lower()) is None
        assert allocate(db) == "EVX-006"
        db.commit()


def test_rollback_gaps_sequence_expansion_and_retired_reservations(numbers_db):
    engine, config = numbers_db
    admin, designation, role = setup(engine, config)
    with Session(engine, expire_on_commit=False) as db:
        # PostgreSQL sequence values survive a failed caller transaction.
        assert allocate(db) == "EVX-002"
        db.rollback()
    with Session(engine, expire_on_commit=False) as db:
        assert allocate(db) == "EVX-003"
        db.commit()
        owner, _ = seed_staff(db, admin, designation, role, "retired",
                              label="EVX-004", deleted=True)
        with pytest.raises(AccountCryptoError, match="review"):
            allocate(db)  # Fail explicitly, do not silently skip an unexpected collision.
        db.rollback()
        assert allocate(db) == "EVX-005"
        db.commit()
        assert assert_available(db, "evx-004", owner) == "evx-004"
        with pytest.raises(AccountCryptoError):
            assert_available(db, "eVx-004")
        db.rollback()
        db.execute(text("SELECT setval('staff_account_number_seq',998,true)"))
        db.commit()
        assert allocate(db) == "EVX-999"
        db.commit()
        assert allocate(db) == "EVX-1000"
        db.commit()


def test_retained_unstaged_employee_codes_block_allocation(numbers_db):
    engine, config = numbers_db
    with Session(engine, expire_on_commit=False) as db:
        admin, designation, role = seed_admin(db)
        owner, profile_id = seed_staff(db, admin, designation, role, "legacy", deleted=True)
        # Legitimate unresolved legacy code: no current alias/reservation.
        db.get(StaffProfile, profile_id).employee_code = "eVx-020"
        db.get(StaffProfile, profile_id).login_identifiers_ready = False
        db.commit()
    command.upgrade(config, TARGET)
    with Session(engine) as db:
        assert db.get(User, owner).username == "EVX-021"
        with pytest.raises(AccountCryptoError):
            assert_available(db, "EVX-020")


def test_ciphertext_only_mutations_namespace_and_protected_guard(numbers_db):
    engine, config = numbers_db
    admin, designation, role = setup(engine, config)
    with Session(engine, expire_on_commit=False) as db:
        owner, _ = seed_staff(db, admin, designation, role, "owner", label="EVX-002")
        other, _ = seed_staff(db, admin, designation, role, "other", label="EVX-003")
        for sql in ("UPDATE users SET username='EVX-099' WHERE id=:id",):
            with pytest.raises(IntegrityError), db.begin_nested():
                db.execute(text(sql), {"id": owner})
        for target, value in ((other, "EVX-002"), (other, "evx-001"), (admin, "EVX-099")):
            with pytest.raises(IntegrityError), db.begin_nested():
                db.get(User, target).username = value
                db.flush()
        # Core/bulk identifier updates must not bypass encrypted ORM mutation.
        with pytest.raises(AccountCryptoError), db.begin_nested():
            db.execute(update(User).where(User.id == other).values(username_index="f" * 64))
        # An out-of-band valid-shaped digest is detected on decrypt, not by a
        # PostgreSQL HMAC check (the database never holds encryption keys).
        with pytest.raises(AccountCryptoError), db.begin_nested():
            db.execute(text("UPDATE users SET username_index=repeat('f',64) WHERE id=:id"),
                       {"id": owner})
            db.expire_all()
            assert db.get(User, owner).username


def test_staff_labels_are_not_credentials_but_independent_codes_and_admin_email_work(numbers_db):
    engine, config = numbers_db
    admin, designation, role = setup(engine, config)
    with Session(engine, expire_on_commit=False) as db:
        owner, profile_id = seed_staff(db, admin, designation, role, "login", label="EVX-002")
        settings = get_settings()

        def login(identifier):
            return auth.login(db, identifier, PASSWORD, settings, False,
                              "synthetic-number-login", "192.0.2.10", portal="admin")[0]

        assert resolve(db, "evx-002") is None
        with pytest.raises(auth.AuthError):
            login("EVX-002")
        assert login("EMP-login").user.id == owner
        assert login("staff-login@example.com").user.id == owner
        assert login("crm-admin@allergyevexia.in").user.id == admin
        profile = db.get(StaffProfile, profile_id)
        profile.employee_code = "EVX-002"
        with db.no_autoflush:
            save_identifiers(db, profile, "staff-login@example.com", "EVX-002", StaffCrypto(settings))
        db.commit()
        assert resolve(db, "evx-002") == owner
        assert login("EVX-002").user.id == owner
        assert resolve(db, "emp-login") is None  # Retained reservation is not a live alias.
        with pytest.raises(auth.AuthError):
            login("EMP-login")
