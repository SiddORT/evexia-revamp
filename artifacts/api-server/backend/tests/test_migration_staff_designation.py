"""Historical SQL fixtures only, private disposable databases."""
import json
import subprocess
import sys
import uuid
from types import SimpleNamespace

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from app.services.staff_designation_mapping import MappingError, load_overrides, reconcile
from test_migration_0006 import migration_db
from test_migration_staff import prepare


def historical(migration_db, labels):
    engine, config, actor, _session, _legacy = prepare(migration_db)
    command.upgrade(config, "0028_directory_soft_delete")
    keys = [uuid.uuid4() for _ in range(3)]
    with engine.begin() as db:
        for key, name, status, deleted in zip(keys, ["Executive", "Historical", "Manual target"],
                                             ["active", "inactive", "active"], [False, True, False]):
            db.execute(text("""
                INSERT INTO designations(id,name,"shortName",status,version,created_by,updated_by,deleted_at,deleted_by)
                VALUES (:id,:name,'EX',:status,9,:actor,:actor,
                        CASE WHEN :deleted THEN now() ELSE NULL END,
                        CASE WHEN :deleted THEN CAST(:actor AS uuid) ELSE NULL END)
            """), dict(id=key, name=name, status=status, actor=actor, deleted=deleted))
        role = uuid.uuid4()
        db.execute(text("INSERT INTO custom_roles(id,name,description,permissions,version) VALUES (:id,'Retained role','original',ARRAY['zone.add'],7)"), dict(id=role))
        for index, label in enumerate(labels):
            profile_id, user_id = uuid.uuid4(), uuid.uuid4()
            db.execute(text("""
                INSERT INTO users(id,email,username,password_hash,is_active,token_version,identity_version,is_protected_system_admin)
                VALUES (:id,NULL,:username,'preserved-argon-hash',true,4,2,false)
            """), dict(id=user_id, username=f"historical_staff_{index}"))
            db.execute(text("""
                INSERT INTO staff_profiles(id,user_id,name_ciphertext,email_ciphertext,phone_ciphertext,
                    email_index,dial_country,role,designation,joining_date,status,version,
                    created_by,updated_by,custom_role_id,workspace_login_enabled,created_at,updated_at)
                VALUES (:id,:user,'unchanged-name-cipher','unchanged-email-cipher','unchanged-phone-cipher',
                    :index,'IN','Manager',:label,'2020-01-01','inactive',17,:actor,:actor,:role,true,
                    '2020-01-01T01:00:00Z','2021-01-01T01:00:00Z')
            """), dict(id=profile_id, user=user_id, index=str(index).zfill(64), label=label, actor=actor, role=role))
        before = [dict(row) for row in db.execute(text("SELECT * FROM staff_profiles ORDER BY id")).mappings()]
        users = db.execute(text("SELECT * FROM users ORDER BY id")).all()
    return engine, config, keys, before, users


def test_exact_normalized_inactive_deleted_mapping_preserves_every_other_column(migration_db):
    engine, config, keys, before, users = historical(migration_db, ["Executive", "  eXeCuTiVe  ", "Historical"])
    with engine.connect() as db:
        resolved, unresolved = reconcile(db)
        assert unresolved == []
        assert resolved == {"Executive": str(keys[0]), "  eXeCuTiVe  ": str(keys[0]), "Historical": str(keys[1])}
    command.upgrade(config, "0028_staff_designation_lifecycle")
    with engine.begin() as db:
        after = [dict(row) for row in db.execute(text("SELECT * FROM staff_profiles ORDER BY id")).mappings()]
        for old, new in zip(before, after):
            label = old.pop("designation")
            assert new.pop("designation_id") == (keys[1] if label == "Historical" else keys[0])
            assert new.pop("deleted_at") is None and new.pop("deleted_by") is None
            assert old == new
        assert db.execute(text("SELECT * FROM users ORDER BY id")).all() == users
        assert "designation" not in {col["name"] for col in inspect(db).get_columns("staff_profiles")}
        for statement, params in [
            ("UPDATE staff_profiles SET designation_id=NULL", {}),
            ("UPDATE staff_profiles SET designation_id=:id", dict(id=uuid.uuid4())),
            ("DELETE FROM designations WHERE id=:id", dict(id=keys[0])),
            ("UPDATE staff_profiles SET deleted_by=:id", dict(id=uuid.uuid4())),
        ]:
            with pytest.raises(IntegrityError), db.begin_nested():
                db.execute(text(statement), params)
    with pytest.raises(RuntimeError, match="Populated Staff downgrade"):
        command.downgrade(config, "0027_mr_designation_identity")


def test_every_unresolved_value_and_reused_name_candidates_are_reported_atomically(migration_db, tmp_path):
    engine, config, keys, before, _ = historical(migration_db, ["Executive", "Historical", "Unknown", "Unknown"])
    with engine.begin() as db:
        db.execute(text("""
            INSERT INTO designations(id,name,"shortName",status,version,created_by,updated_by)
            SELECT :id,'HISTORICAL','H','active',1,created_by,updated_by FROM designations WHERE id=:old
        """), dict(id=uuid.uuid4(), old=keys[1]))
        resolved, errors = reconcile(db)
        assert resolved == {"Executive": str(keys[0])}
        assert [(row["legacy_value"], row["reason"], row["affected"]) for row in errors] == [
            ("Historical", "ambiguous", 1), ("Unknown", "unmatched", 2)]
        assert len(errors[0]["candidates"]) == 2
        assert all(set(candidate) == {"id", "name", "status", "deleted"} for candidate in errors[0]["candidates"])
        assert not any(word in json.dumps(errors) for word in ["cipher", "password", "email", "phone"])
        for overrides in ({"Typo": str(keys[0])}, {"Unknown": str(uuid.uuid4())}):
            with pytest.raises(MappingError):
                reconcile(db, overrides)
    with pytest.raises(RuntimeError, match="reconciliation required"):
        command.upgrade(config, "0028_staff_designation_lifecycle")
    with engine.connect() as db:
        assert [dict(row) for row in db.execute(text("SELECT * FROM staff_profiles ORDER BY id")).mappings()] == before
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0028_directory_soft_delete"
    mapping = tmp_path / "reviewed.json"
    mapping.write_text(json.dumps({"Historical": str(keys[1]), "Unknown": str(keys[2])}))
    config.cmd_opts = SimpleNamespace(x=[f"staff_designation_map={mapping}"])
    command.upgrade(config, "0028_staff_designation_lifecycle")
    with engine.connect() as db:
        assert db.scalar(text("SELECT count(*) FROM staff_profiles WHERE designation_id=:id"), dict(id=keys[2])) == 2
        assert db.scalar(text("SELECT count(*) FROM designations")) == 4


def test_invalid_override_file_and_targets_abort_without_ddl(migration_db, tmp_path):
    engine, config, keys, before, _ = historical(migration_db, ["Unknown"])
    mapping = tmp_path / "invalid.json"
    config.cmd_opts = SimpleNamespace(x=[f"staff_designation_map={mapping}"])
    for data in ({"Unknown": str(uuid.uuid4())}, {"Unknown": "not-uuid"}, {"Typo": str(keys[0])}):
        mapping.write_text(json.dumps(data))
        with pytest.raises(MappingError):
            command.upgrade(config, "0028_staff_designation_lifecycle")
        with engine.connect() as db:
            assert [dict(row) for row in db.execute(text("SELECT * FROM staff_profiles ORDER BY id")).mappings()] == before
            assert "designation_id" not in {col["name"] for col in inspect(db).get_columns("staff_profiles")}
    mapping.write_text('{"Unknown":"%s","Unknown":"%s"}' % (keys[0], keys[1]))
    with pytest.raises(MappingError):
        load_overrides(mapping)


def test_readonly_preflight_pages_all_unresolved_and_missing_values_cannot_be_guessed(migration_db):
    engine, config, keys, before, _ = historical(migration_db, ["", " ", "Unknown"])
    with engine.connect() as db:
        resolved, errors = reconcile(db, {"": str(keys[0]), " ": str(keys[0])})
        assert resolved == {}
        assert [row["reason"] for row in errors] == ["missing_value", "missing_value", "unmatched"]
    for offset, expected in enumerate(["", " ", "Unknown"]):
        result = subprocess.run([sys.executable, "-m", "app.staff_designation_preflight",
                                 "--offset", str(offset), "--limit", "1"], capture_output=True, text=True)
        assert result.returncode == 1, result.stdout
        page = json.loads(result.stdout)
        assert page["items"][0]["legacy_value"] == expected
        assert page["unresolved_values"] == 3 and page["affected"] == 3
        assert page["has_more"] == (offset < 2)
        assert not result.stderr
    with pytest.raises(RuntimeError, match="reconciliation required"):
        command.upgrade(config, "0028_staff_designation_lifecycle")
    with engine.connect() as db:
        assert [dict(row) for row in db.execute(text("SELECT * FROM staff_profiles ORDER BY id")).mappings()] == before
