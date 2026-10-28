"""Focused upgrade/rollback rehearsal in the guarded disposable PG fixture."""
from unittest.mock import patch
import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.orm import Session
from staff_number_fixture import numbers_db, seed_admin, seed_staff
from app.db.models import User
from app.db.staff_models import StaffProfile
from app.services.staff_identifiers import resolve
from app.services.staff_employee_numbers import allocate
from app.services.account_crypto import ready


def seed_predecessor(engine, config):
    command.upgrade(config, "0073_order_decisions")
    with Session(engine) as db:
        admin, designation, role = seed_admin(db)
        owner, profile = seed_staff(db, admin, designation, role, "numbers",
                                    label="EVX-009", code="LEGACY-EMPLOYEE")
        before = db.get(User, owner)
        protected = db.get(User, admin)
        return admin, owner, profile, before.password_hash, protected.password_hash


def test_upgrade_preserves_accounts_and_reserves_retired_aliases(numbers_db):
    engine, config = numbers_db
    admin, owner, profile_id, password, admin_password = seed_predecessor(engine, config)
    command.upgrade(config, "0074_business_numbers")
    with Session(engine) as db:
        profile, user = db.get(StaffProfile, profile_id), db.get(User, owner)
        assert profile.employee_code == "ST-001"
        assert profile.workspace_login_enabled and profile.login_identifiers_ready
        assert user.username == "EVX-009" and user.password_hash == password
        assert user.identity_version == 5 and user.token_version == 2
        protected = db.get(User, admin)
        assert protected.is_protected_system_admin and protected.password_hash == admin_password
        assert protected.identity_version == 3 and protected.token_version == 7
        assert resolve(db, "ST-001") == owner
        assert resolve(db, "LEGACY-EMPLOYEE") is None
        keys = ready(db)
        assert db.scalar(text(
            "SELECT user_id FROM account_identifier_reservations WHERE identifier_index=:digest"),
            {"digest": keys.lookup_index("legacy-employee")}) == owner
        assert allocate(db) == "ST-002"
        assert db.scalar(text("SELECT nextval('allergen_number_seq')")) == 1
        assert db.scalar(text(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_schema=current_schema() AND table_name='allergen_products' AND column_name='code'"
        )) == "NO"


def test_failure_rolls_back_schema_and_account_changes(numbers_db):
    engine, config = numbers_db
    admin, owner, profile_id, password, _ = seed_predecessor(engine, config)
    with patch("app.services.staff_employee_numbers.allocate",
               side_effect=RuntimeError("Synthetic allocation failure")):
        with pytest.raises(RuntimeError, match="Synthetic allocation failure"):
            command.upgrade(config, "0074_business_numbers")
    with Session(engine) as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0073_order_decisions"
        assert db.get(StaffProfile, profile_id).employee_code == "LEGACY-EMPLOYEE"
        assert db.get(User, owner).password_hash == password
        assert db.get(User, owner).identity_version == 4
        assert db.scalar(text(
            "SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() "
            "AND table_name='allergen_products' AND column_name='code'")) == 0
