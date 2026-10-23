"""Synthetic predecessor fixtures; never connect to the application database."""
import logging
import os
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.designation_models import Designation
from app.db.models import User
from app.db.role_models import CustomRole
from app.db.staff_models import StaffProfile
from app.schemas.staff import StaffFields
from app.services import staff
from app.services.staff_crypto import StaffCrypto
from app.services.staff_identifiers import save_identifiers

PREVIOUS = "0059_staff_unified_access"
TARGET = "0060_staff_account_numbers"
PASSWORD = "Synthetic staff number test password 9!"
STAMP = datetime(2025, 1, 1, tzinfo=timezone.utc)


@pytest.fixture
def numbers_db(monkeypatch):
    url = make_url(os.environ["TEST_DATABASE_URL"])
    assert url.drivername.startswith("postgresql")
    assert "test" in url.database and url.query["host"].startswith("/tmp/evexia-api-test.")
    assert get_settings().app_env == "test"
    disabled = {name: logger.disabled for name, logger in logging.Logger.manager.loggerDict.items()
                if isinstance(logger, logging.Logger)}
    schema = "staff_numbers_" + uuid.uuid4().hex
    admin = create_engine(url, hide_parameters=True)
    with admin.begin() as db:
        db.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated = url.set(query={**url.query, "options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", isolated.render_as_string(hide_password=False))
    get_settings.cache_clear()
    engine = create_engine(isolated, hide_parameters=True)
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    try:
        # Empty historical path needs no invented recovery evidence.
        command.upgrade(config, PREVIOUS)
        yield engine, config
    finally:
        engine.dispose()
        get_settings.cache_clear()
        with admin.begin() as db:
            db.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
        for name, logger in logging.Logger.manager.loggerDict.items():
            if isinstance(logger, logging.Logger):
                logger.disabled = disabled.get(name, False)


def seed_admin(db):
    db.execute(text("SET LOCAL evexia.bootstrap_super_admin='on'"))
    admin = User(email="crm-admin@allergyevexia.in", username=None,
                 password_hash=hash_password(PASSWORD), system_role="super_admin",
                 is_protected_system_admin=True, identity_version=3, token_version=7)
    db.add(admin)
    db.flush()
    designation = Designation(id=uuid.uuid4(), name="Synthetic executive", shortName="EX",
                              status="active", created_by=admin.id, updated_by=admin.id)
    role = CustomRole(id=uuid.uuid4(), name="Synthetic staff role",
                      created_by=admin.id, updated_by=admin.id)
    db.add_all([designation, role])
    db.commit()
    return admin.id, designation.id, role.id


def body(designation, role, suffix):
    return StaffFields(name=f"Synthetic staff {suffix}", email=f"staff-{suffix}@example.com",
                       phone="9876543210", designation_id=designation, custom_role_id=role,
                       dateOfJoining=date(2025, 1, 1), status="active",
                       employeeCode=f"EMP-{suffix}")


def seed_staff(db, admin, designation, role, suffix, *, label=None, code=None,
               deleted=False, created_at=STAMP, profile_id=None):
    user = User(id=uuid.uuid4(), email=None, username=label or f"legacy.staff.{suffix}",
                password_hash=hash_password(PASSWORD), token_version=2, identity_version=4)
    db.add(user)
    db.flush()
    profile = StaffProfile(id=profile_id or uuid.uuid4(), user_id=user.id, role="Synthetic staff role",
                           custom_role_id=role, workspace_login_enabled=True,
                           version=5, created_by=admin, updated_by=admin,
                           created_at=created_at, updated_at=STAMP)
    fields = body(designation, role, suffix)
    if code:
        fields.employeeCode = code
    crypto = StaffCrypto(get_settings())
    staff.assign(profile, fields, crypto)
    db.add(profile)
    with db.no_autoflush:
        save_identifiers(db, profile, str(fields.email), fields.employeeCode, crypto)
    if deleted:
        profile.deleted_at, profile.deleted_by, profile.status = STAMP, admin, "inactive"
    db.commit()
    return user.id, profile.id


def snapshot(engine, table):
    with engine.connect() as db:
        return [dict(row) for row in db.execute(text(f"SELECT * FROM {table} ORDER BY 1")).mappings()]
