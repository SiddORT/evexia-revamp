"""Forward preservation and concurrency; never connects to the managed database."""
import uuid
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
from test_migration_0006 import migration_db, upgrade_with_retirement_recovery
from test_migration_zone_permissions import fixture
from test_migration_staff import identity, prepare
from test_staff import seed_designation


def test_forward_preserves_grants_versions_assignments_and_empty_defaults(migration_db, tmp_path):
    # Seed the historical contract directly; populated lifecycle downgrade is
    # deliberately unavailable and current ORM fields do not exist at 0020.
    engine, config, admin_id, session_id, _ = prepare(migration_db)
    command.upgrade(config, "0020_patient_directory")
    role_id, user_id, profile_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    role = {"id": role_id}
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO custom_roles(id,name,description,permissions,version) VALUES (:id,'Existing','Retained',ARRAY['zone.add'],3)"), dict(id=role_id))
        conn.execute(text("INSERT INTO users(id,email,username,password_hash,is_active,token_version,identity_version,is_protected_system_admin) VALUES (:id,NULL,'historical_granted_staff','retained-hash',true,0,0,false)"), dict(id=user_id))
        conn.execute(text("""
            INSERT INTO staff_profiles(id,user_id,name_ciphertext,email_ciphertext,phone_ciphertext,email_index,
                dial_country,role,designation,joining_date,status,version,created_by,updated_by,custom_role_id,workspace_login_enabled)
            VALUES (:id,:user,'retained-name','retained-email','retained-phone','retained-index','IN',
                'Staff','Director','2020-01-01','active',3,:actor,:actor,:role,true)
        """), dict(id=profile_id, user=user_id, actor=admin_id, role=role_id))
    with engine.connect() as conn:
        before = conn.execute(text("SELECT id, permissions, version, updated_at FROM custom_roles")).all()
        staff_before = conn.execute(text("SELECT id, custom_role_id, workspace_login_enabled, version FROM staff_profiles")).all()
    command.upgrade(config, "0027_mr_designation_identity")
    with Session(engine) as db:
        seed_designation(db, admin_id, "Director")
    from test_migration_role_lifecycle import reviewed_fixture_mapping
    reviewed_fixture_mapping(config, tmp_path, role_id, admin_id)
    upgrade_with_retirement_recovery(engine, config)
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
    with pytest.raises(Exception, match="Populated role downgrade"):
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
