"""Forward defaults and real transaction ordering, on independent test connections."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event, Barrier

import pytest
from alembic import command
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import utcnow
from app.db.models import AuthSession, User
from app.db.role_models import CustomRole
from app.db.staff_models import StaffProfile
from app.schemas.roles import RoleFields, RolePermissions, RoleVersion
from app.schemas.staff import StaffAccess, StaffFields
from app.schemas.zones import ZoneFields
from app.services import auth, roles, staff, zones, downloads
from app.services.zone_policy import lock_policy
from test_migration_0006 import migration_db
from test_migration_staff import prepare, identity
from test_staff import BODY, seed_designation


def fixture(migration_db):
    engine, config, admin_id, session_id, _ = prepare(migration_db)
    command.upgrade(config, "head")
    settings = get_settings()
    with Session(engine, expire_on_commit=False) as db:
        seed_designation(db, admin_id)
        actor = identity(db, admin_id, session_id)
        role = roles.mutate(db, actor, RoleFields(name="Restricted role"))
        role = roles.mutate(db, actor, RolePermissions(permissions=["zone.add", "zone.export"],
                            expected_version=role["version"]), role["id"], permissions=True)
        created = staff.create(db, actor, StaffFields(**BODY), settings)["record"]
        record = staff.access(db, actor, settings, created["id"],
                              StaffAccess(custom_role_id=role["id"], workspace_login_enabled=True,
                                          expected_version=created["version"]))
        profile = db.get(StaffProfile, record["id"])
        user = db.get(User, profile.user_id)
        session = AuthSession(user_id=user.id, expires_at=utcnow() + timedelta(hours=1),
                              token_version=user.token_version, identity_version=user.identity_version)
        db.add(session)
        db.commit()
        return engine, config, admin_id, session_id, role, record, user.id, session.id


def test_forward_existing_role_staff_defaults_preserve_identity(migration_db):
    engine, config, admin_id, session_id, legacy = prepare(migration_db)
    command.upgrade(config, "0013_download_logs")
    staff_id, user_id, role_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(text("""INSERT INTO custom_roles(id,name,description,version)
            VALUES (:id,'Super Admin','Existing label',7)"""), {"id": role_id})
        connection.execute(text("""INSERT INTO users(id,email,username,password_hash,is_active,
            token_version,system_role,identity_version,is_protected_system_admin)
            VALUES (:id,NULL,'st_preserved','existing-staff-hash',true,3,NULL,0,false)"""), {"id": user_id})
        connection.execute(text("""INSERT INTO staff_profiles
            (id,user_id,name_ciphertext,email_ciphertext,phone_ciphertext,email_index,dial_country,
             role,designation,joining_date,status,version,created_by,updated_by)
            VALUES (:id,:user,'preserved','preserved','preserved','unique','IN',
            'Super Admin','Director','2025-01-01','active',5,:admin,:admin)"""),
            {"id": staff_id, "user": user_id, "admin": admin_id})
    command.upgrade(config, "0027_mr_designation_identity")
    with Session(engine) as db:
        seed_designation(db, admin_id, "Director")
    command.upgrade(config, "head")
    with Session(engine) as db:
        profile = db.get(StaffProfile, staff_id)
        assert profile.custom_role_id is None and profile.workspace_login_enabled is False
        assert profile.role == "Super Admin" and profile.version == 5 and profile.name_ciphertext == "preserved"
        role = db.get(CustomRole, role_id)
        assert role.permissions == [] and role.version == 7
        assert db.get(User, user_id).password_hash == "existing-staff-hash"
        assert db.get(User, legacy).password_hash == "existing-hash"
        assert db.get(User, admin_id).is_protected_system_admin
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        with pytest.raises(auth.AuthError):
            auth._load_identity(db, db.get(User, user_id))
        for grants in (["admin.access"], ["zone.restore"], ["zone.add", None]):
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(text("UPDATE custom_roles SET permissions=:grants WHERE id=:id"),
                               {"id": role_id, "grants": grants})


@pytest.mark.parametrize("revoke", ["grants", "assignment", "disable"])
def test_queued_action_and_file_release_recheck_revoked_policy(migration_db, revoke):
    engine, _, admin_id, admin_sid, role, record, user_id, staff_sid = fixture(migration_db)
    settings = get_settings()
    ready, attempted = Event(), Event()
    with Session(engine, expire_on_commit=False) as reader:
        snapshot = auth._load_identity(reader, reader.get(User, user_id))
        actor = auth.Identity(snapshot.user, session_id=staff_sid, staff=snapshot.staff, zone_grants=snapshot.zone_grants)
        reader.commit()
        def revoke_then_unlock():
            with Session(engine, expire_on_commit=False) as db:
                lock_policy(db)
                ready.set()
                assert attempted.wait(10)
                owner = identity(db, admin_id, admin_sid)
                if revoke == "grants":
                    roles.mutate(db, owner, RolePermissions(permissions=[], expected_version=role["version"]),
                                 role["id"], permissions=True)
                else:
                    staff.access(db, owner, settings, record["id"], StaffAccess(
                        custom_role_id=None if revoke == "assignment" else role["id"],
                        workspace_login_enabled=revoke != "disable", expected_version=record["version"]))
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(revoke_then_unlock)
            assert ready.wait(10)
            attempted.set()
            with pytest.raises((zones.ZoneError, auth.AuthError)) as error:
                zones.create(reader, actor, ZoneFields(name="Must not commit", status="active"))
            if isinstance(error.value, zones.ZoneError):
                assert error.value.status == 403
            future.result(timeout=10)
        with pytest.raises(Exception) as release:
            downloads.server_record(reader, actor, uuid.uuid4(), "zone", "export", "CSV")
        assert getattr(release.value, "status_code", None) in (401, 403)
        reader.rollback()
        owner = identity(reader, admin_id, admin_sid)
        assert zones.listing(reader, owner, "", "all", 10, 0)["total"] == 0


def test_assignment_role_deletion_race_has_no_dangling_links(migration_db):
    engine, _, admin_id, admin_sid, role, record, _, _ = fixture(migration_db)
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, admin_id, admin_sid)
        with pytest.raises(roles.RoleError, match="assigned"):
            roles.mutate(db, actor, RoleVersion(expected_version=role["version"]), role["id"], deleting=True)
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.execute(text("DELETE FROM custom_roles WHERE id=:id"), {"id": role["id"]})
        profile = db.get(StaffProfile, record["id"])
        assert profile.custom_role_id == role["id"] and db.get(CustomRole, role["id"])


def test_concurrent_assignment_or_deletion_has_one_valid_outcome(migration_db):
    engine, _, admin_id, admin_sid, role, record, _, _ = fixture(migration_db)
    settings = get_settings()
    with Session(engine, expire_on_commit=False) as db:
        record = staff.access(db, identity(db, admin_id, admin_sid), settings, record["id"],
                              StaffAccess(custom_role_id=None, workspace_login_enabled=True,
                                          expected_version=record["version"]))
    barrier = Barrier(2)
    def compete(assigning):
        with Session(engine, expire_on_commit=False) as db:
            owner = identity(db, admin_id, admin_sid)
            barrier.wait(timeout=10)
            try:
                if assigning:
                    return staff.access(db, owner, settings, record["id"], StaffAccess(
                        custom_role_id=role["id"], workspace_login_enabled=True,
                        expected_version=record["version"]))
                return roles.mutate(db, owner, RoleVersion(expected_version=role["version"]),
                                    role["id"], deleting=True)
            except (roles.RoleError, staff.StaffError) as error:
                return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(compete, (True, False)))
    assert sum(isinstance(value, dict) for value in outcomes) == 1
    assert any(value in ("role_assigned", "role_deleted") for value in outcomes if isinstance(value, str))
    with Session(engine) as db:
        profile = db.get(StaffProfile, record["id"])
        saved = db.get(CustomRole, role["id"])
        assert (profile.custom_role_id == role["id"] and saved is not None) or (profile.custom_role_id is None and saved is None)
