"""Forward preservation and concurrency; never connects to the managed database."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from datetime import timedelta

import pytest
from alembic import command
from sqlalchemy import text, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException

from app.db.role_models import CustomRole
from app.services import auth, roles, downloads
from app.schemas.roles import RolePermissions, RoleFields
from app.services.master_policy import MASTERS, MASTER_ACTIONS, authorize_master
from app.services.zone_policy import lock_policy
from test_migration_0006 import migration_db
from test_migration_zone_permissions import fixture
from test_migration_staff import identity


def test_forward_preserves_grants_versions_assignments_and_empty_defaults(migration_db):
    engine, config, admin_id, session_id, role, record, user_id, staff_session = fixture(migration_db)
    command.downgrade(config, "0020_patient_directory")
    with engine.connect() as conn:
        before = conn.execute(text("SELECT id, permissions, version, updated_at FROM custom_roles")).all()
        staff_before = conn.execute(text("SELECT id, custom_role_id, workspace_login_enabled, version FROM staff_profiles")).all()
    command.upgrade(config, "head")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT id, permissions, version, updated_at FROM custom_roles")).all() == before
        assert conn.execute(text("SELECT id, custom_role_id, workspace_login_enabled, version FROM staff_profiles")).all() == staff_before
    with Session(engine) as db:
        actor = identity(db, admin_id, session_id)
        empty = roles.mutate(db, actor, RoleFields(name="Empty"))
        assert empty["permissions"] == []
        row = db.get(CustomRole, role["id"])
        row.permissions = sorted(MASTER_ACTIONS)
        db.commit()
        row.permissions = ["admin.access"]
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        assert db.get(CustomRole, role["id"]).permissions == sorted(MASTER_ACTIONS)
    with pytest.raises(Exception, match="Explicitly remove non-Zone grants"):
        command.downgrade(config, "0020_patient_directory")


@pytest.mark.parametrize("resource", MASTERS)
def test_revocation_serializes_with_all_master_file_release_boundaries(migration_db, resource):
    engine, _, admin_id, session_id, role, _, user_id, staff_session = fixture(migration_db)
    with Session(engine) as db:
        actor = identity(db, admin_id, session_id)
        role = roles.mutate(db, actor, RolePermissions(
            permissions=[f"{resource}.export"], expected_version=role["version"]), role["id"], permissions=True)
    started, allow_revoke = Event(), Event()
    source = "storage_location" if resource == "location" else resource
    def revoke():
        with Session(engine) as db:
            lock_policy(db)
            started.set()
            assert allow_revoke.wait(10)
            actor = identity(db, admin_id, session_id)
            roles.mutate(db, actor, RolePermissions(permissions=[], expected_version=role["version"]),
                         role["id"], permissions=True)
    def release():
        with Session(engine) as db:
            actor = identity(db, user_id, staff_session)
            with pytest.raises(HTTPException) as denied:
                downloads.server_record(db, actor, None, source, "export", "CSV")
            assert denied.value.status_code == 403
            db.rollback()
    with ThreadPoolExecutor(2) as executor:
        mutation = executor.submit(revoke)
        assert started.wait(10)
        file_release = executor.submit(release)
        allow_revoke.set()
        mutation.result(timeout=15)
        file_release.result(timeout=15)
    with Session(engine) as db:
        actor = identity(db, user_id, staff_session)
        with pytest.raises(HTTPException) as denied:
            authorize_master(db, actor, resource, "export")
        assert denied.value.status_code == 403
