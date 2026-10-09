"""Actual historical-to-head upgrades; no configured database connections."""
import json
import os
import subprocess
import sys
import uuid
from types import SimpleNamespace

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from app.services.role_attribution import AttributionError, coverage, load_mapping, reconcile
from test_migration_0006 import migration_db
from test_migration_staff import prepare


def reviewed_fixture_mapping(config, tmp_path, role_id, actor_id):
    """Explicit fixture-author review, never a production default."""
    path = tmp_path / "role-map.json"
    path.write_text(json.dumps({str(role_id): {"created_by": str(actor_id), "updated_by": str(actor_id)}}))
    existing = getattr(getattr(config, "cmd_opts", None), "x", [])
    config.cmd_opts = SimpleNamespace(x=[*existing, f"role_attribution_map={path}"])


def historical(migration_db, version=1, updated="2020-01-01T00:00:00Z"):
    engine, config, actor, _session, _legacy = prepare(migration_db)
    command.upgrade(config, "0028_staff_designation_lifecycle")
    role = uuid.uuid4()
    with engine.begin() as db:
        db.execute(text("""
            INSERT INTO custom_roles(id,name,description,version,permissions,created_at,updated_at)
            VALUES (:id,'  Retained Name  ','Retained',:version,ARRAY['zone.add','doctor.import'],
                    '2020-01-01T00:00:00Z',:updated)
        """), dict(id=role, version=version, updated=updated))
        before = dict(db.execute(text("SELECT * FROM custom_roles WHERE id=:id"), dict(id=role)).mappings().one())
    return engine, config, actor, role, before


def event(db, role, actor, action, at):
    db.execute(text("""
        INSERT INTO audit_events(id,resource_id,resource_type,actor_id,action,outcome,created_at)
        VALUES (:id,:role,'custom_role',:actor,:action,'success',:at)
    """), dict(id=uuid.uuid4(), role=role, actor=actor, action=action, at=at))


@pytest.mark.parametrize("version", [1, 3])
def test_complete_evidence_preserves_every_legacy_value_and_restricts_users(migration_db, version):
    updated = "2020-01-03T00:00:00Z" if version == 3 else "2020-01-01T00:00:00Z"
    engine, config, actor, role, before = historical(migration_db, version, updated)
    with engine.begin() as db:
        event(db, role, actor, "role_create", "2020-01-01T00:00:00Z")
        if version == 3:
            event(db, role, actor, "role_update", "2020-01-02T00:00:00Z")
            event(db, role, actor, "role_permissions", updated)
        report = reconcile(db)
        assert coverage(report) == dict(roles=1, automatic_fields=2, reviewed_fields=0, unresolved_fields=0, assignment_blockers=0)
    command.upgrade(config, "head")
    with engine.begin() as db:
        after = dict(db.execute(text("SELECT * FROM custom_roles WHERE id=:id"), dict(id=role)).mappings().one())
        assert after.pop("created_by") == actor and after.pop("updated_by") == actor
        assert after.pop("deleted_at") is None and after.pop("deleted_by") is None
        assert before == after
        columns = {c["name"]: c for c in inspect(db).get_columns("custom_roles")}
        assert not columns["created_by"]["nullable"] and not columns["updated_by"]["nullable"]
        assert columns["deleted_at"]["type"].timezone
        for sql in (
            "UPDATE custom_roles SET created_by=NULL",
            "UPDATE custom_roles SET updated_by='00000000-0000-0000-0000-000000000000'",
            "UPDATE custom_roles SET deleted_by='00000000-0000-0000-0000-000000000000'",
        ):
            with pytest.raises(IntegrityError), db.begin_nested():
                db.execute(text(sql))


@pytest.mark.parametrize("scenario", ["missing", "old_update", "same_time", "conflict", "missing_actor", "proximity"])
def test_unresolved_history_aborts_atomically_and_field_specific_review_repairs(migration_db, tmp_path, scenario):
    engine, config, actor, role, before = historical(migration_db, 3, "2020-01-03T00:00:00Z")
    with engine.begin() as db:
        if scenario != "missing":
            event(db, role, actor if scenario != "missing_actor" else uuid.uuid4(), "role_create", "2020-01-01T00:00:00Z")
            event(db, role, actor, "role_update", "2020-01-02T00:00:00Z")
        if scenario in ("same_time", "conflict", "proximity"):
            event(db, role, actor, "role_create" if scenario == "conflict" else "role_permissions",
                  "2020-01-02T00:00:00Z" if scenario == "same_time" else "2020-01-02T23:59:59Z")
        report = reconcile(db)
        assert report[0]["fields"]["updated_by"]["source"] == "unresolved"
        missing = {field: actor for field, entry in report[0]["fields"].items() if entry["source"] == "unresolved"}
    with pytest.raises(RuntimeError, match=str(role)):
        command.upgrade(config, "head")
    with engine.connect() as db:
        assert dict(db.execute(text("SELECT * FROM custom_roles")).mappings().one()) == before
        assert "created_by" not in {c["name"] for c in inspect(db).get_columns("custom_roles")}
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0028_staff_designation_lifecycle"
        report = reconcile(db, {role: missing})
        assert coverage(report)["unresolved_fields"] == 0
        assert report[0]["fields"]["updated_by"]["source"] == "reviewed_mapping"
    mapping = tmp_path / "reviewed.json"
    mapping.write_text(json.dumps({str(role): {f: str(v) for f, v in missing.items()}}))
    config.cmd_opts = SimpleNamespace(x=[f"role_attribution_map={mapping}"])
    command.upgrade(config, "head")
    with engine.connect() as db:
        after = dict(db.execute(text("SELECT * FROM custom_roles")).mappings().one())
        for field in ("created_by", "updated_by", "deleted_at", "deleted_by"):
            after.pop(field)
        assert after == before


def test_invalid_review_and_read_only_preflight(migration_db, tmp_path):
    engine, config, actor, role, before = historical(migration_db)
    path = tmp_path / "invalid.json"
    config.cmd_opts = SimpleNamespace(x=[f"role_attribution_map={path}"])
    for mapping in (
        {str(role): {"created_by": str(uuid.uuid4())}},
        {str(uuid.uuid4()): {"created_by": str(actor)}},
        {str(role): {"updated_by": "bad"}},
        {str(role): {"created_by": str(actor), "deleted_by": str(actor)}},
    ):
        path.write_text(json.dumps(mapping))
        with pytest.raises(AttributionError):
            command.upgrade(config, "head")
    path.write_text('{"%s":{"created_by":"%s","created_by":"%s"}}' % (role, actor, actor))
    with pytest.raises(AttributionError):
        load_mapping(path)
    result = subprocess.run([sys.executable, "-m", "app.role_attribution_preflight", "--limit", "1"],
                            capture_output=True, text=True)
    assert result.returncode == 1, result.stdout
    report = json.loads(result.stdout)
    assert report["coverage"]["roles"] == 1 and report["coverage"]["unresolved_fields"] == 2
    assert report["items"][0]["role_id"] == str(role) and not result.stderr
    assert not any(word in result.stdout for word in ("email", "ciphertext", "password", "phone"))
    with engine.connect() as db:
        assert dict(db.execute(text("SELECT * FROM custom_roles")).mappings().one()) == before


def test_preflight_inventories_all_staff_states_and_bounded_authorized_references(migration_db, tmp_path):
    engine, config, actor, role, before = historical(migration_db)
    designation = uuid.uuid4()
    ids = []
    with engine.begin() as db:
        db.execute(text("""
            INSERT INTO designations(id,name,"shortName",status,version,created_by,updated_by)
            VALUES (:id,'Synthetic','SY','active',1,:actor,:actor)
        """), dict(id=designation, actor=actor))
        for index, (status, login, deleted) in enumerate([
            ("active", True, False), ("inactive", True, False),
            ("active", False, False), ("active", True, True),
        ]):
            user_id, staff_id = uuid.uuid4(), uuid.uuid4()
            ids.append(str(staff_id))
            db.execute(text("""
                INSERT INTO users(id,username,password_hash,is_active,token_version,identity_version,is_protected_system_admin)
                VALUES (:id,:username,'synthetic-hash',true,0,0,false)
            """), dict(id=user_id, username=f"role_fixture_{index}"))
            db.execute(text("""
                INSERT INTO staff_profiles(id,user_id,name_ciphertext,email_ciphertext,phone_ciphertext,email_index,
                    dial_country,role,designation_id,joining_date,status,version,created_by,updated_by,
                    custom_role_id,workspace_login_enabled,deleted_at,deleted_by)
                VALUES (:id,:user,'private-name','private-email','private-phone',:index,'IN','Staff',:designation,
                    '2020-01-01',:status,1,:actor,:actor,:role,:login,
                    CASE WHEN :deleted THEN now() ELSE NULL END,
                    CASE WHEN :deleted THEN CAST(:actor AS uuid) ELSE NULL END)
            """), dict(id=staff_id, user=user_id, index=str(index).zfill(64), designation=designation,
                       status=status, actor=actor, role=role, login=login, deleted=deleted))
        report = reconcile(db)
        assert report[0]["assignment_count"] == 4
        assert {r["staff_id"] for r in report[0]["assignments"]} == set(ids)
        assert any(r["deleted"] for r in report[0]["assignments"])
        staff_before = db.execute(text("SELECT * FROM staff_profiles ORDER BY id")).all()
        users_before = db.execute(text("SELECT * FROM users ORDER BY id")).all()
    result = subprocess.run([sys.executable, "-m", "app.role_attribution_preflight", "--assignment-offset", "2"],
                            capture_output=True, text=True,
                            env={**os.environ, "DATABASE_URL": os.environ["DATABASE_URL"].replace(
                                "postgresql+psycopg://", "postgresql://", 1)})
    page = json.loads(result.stdout)
    assert result.returncode == 1
    assert page["coverage"]["assignment_blockers"] == 4
    assert len(page["items"][0]["assignments"]) == 2 and not page["items"][0]["has_more_assignments"]
    assert not any(word in result.stdout for word in ("private-name", "cipher", "email", "password", "phone"))
    reviewed_fixture_mapping(config, tmp_path, role, actor)
    command.upgrade(config, "head")
    with engine.connect() as db:
        assert db.execute(text("SELECT * FROM staff_profiles ORDER BY id")).all() == staff_before
        assert db.execute(text("SELECT * FROM users ORDER BY id")).all() == users_before
