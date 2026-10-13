"""Real PostgreSQL retirement/recovery and fail-closed authentication evidence."""
import hashlib
import json
import os
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from contextlib import contextmanager
from types import SimpleNamespace
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import token_digest
from app.db.base import Base
from app.services import auth
from app.services import organization_retirement as retirement


# PREVIOUS is the recovery-file/preparation revision, not a rollback target.
# Its sibling retirement branch survives a downgrade to 0031_role_hostnames.
# Cross the actual retirement boundary without reversing directory encryption.
RESTORE_TARGET = "0030_directory_crypto_retirement"
RETIREMENT_REVISION = "0031_remove_organizations"
RETIREMENT_RELEASE = "0034_shared_phone_countries"


def restore_retirement(config):
    scripts = ScriptDirectory.from_config(config)
    steps = scripts._downgrade_revs(RESTORE_TARGET, RETIREMENT_RELEASE)
    revisions = [step.revision.revision for step in steps]
    assert scripts.get_revision(RETIREMENT_REVISION).down_revision == RESTORE_TARGET
    assert RETIREMENT_REVISION in revisions
    assert RESTORE_TARGET not in revisions
    command.downgrade(config, RESTORE_TARGET)


def test_restoration_target_crosses_retirement_not_the_sibling():
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    scripts = ScriptDirectory.from_config(config)
    # This suite verifies retirement recovery, not a later irreversible
    # account-encryption release with its own backup/approval requirements.
    head = RETIREMENT_RELEASE
    sibling_steps = scripts._downgrade_revs(retirement.PREVIOUS, head)
    assert RETIREMENT_REVISION not in [step.revision.revision for step in sibling_steps]
    restore_steps = scripts._downgrade_revs(RESTORE_TARGET, head)
    assert [step.revision.revision for step in restore_steps] == [
        "0034_shared_phone_countries", "0033_merge_directory_branches",
        RETIREMENT_REVISION, "0031_role_hostnames",
    ]


@pytest.fixture
def retired_db(monkeypatch):
    url = make_url(os.environ["TEST_DATABASE_URL"])
    assert "test" in url.database and url.drivername.startswith("postgresql")
    schema = "retirement_" + uuid.uuid4().hex
    admin = sa.create_engine(url, hide_parameters=True)
    with admin.begin() as connection:
        connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
    isolated = url.set(query={**url.query, "options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", isolated.render_as_string(hide_password=False))
    get_settings.cache_clear()
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    engine = sa.create_engine(isolated, hide_parameters=True)
    try:
        command.upgrade(config, retirement.PREVIOUS)
        yield engine, config
    finally:
        engine.dispose()
        get_settings.cache_clear()
        with admin.begin() as connection:
            connection.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def seed(engine):
    ids = {k: uuid.uuid4() for k in ("user", "org", "member", "refresh", "family", "audit")}
    ids["session"] = "synthetic-retired-session-000000000000000"
    with engine.begin() as db:
        db.execute(sa.text("""
          INSERT INTO users(id,email,password_hash,is_active,token_version,system_role,
            identity_version,is_protected_system_admin)
          VALUES (:user,'retired@example.com','synthetic-unusable-hash',true,0,NULL,0,false)
        """), ids)
        db.execute(sa.text("INSERT INTO organizations(id,name) VALUES (:org,'Synthetic legacy')"), ids)
        db.execute(sa.text("""
          INSERT INTO memberships(id,user_id,organization_id,role,is_active)
          VALUES (:member,:user,:org,'owner',true)
        """), ids)
        db.execute(sa.text("""
          INSERT INTO auth_sessions(id,user_id,family_id,status,token_version,identity_version,
            expires_at,persistent) VALUES (:session,:user,:family,'ACTIVE',0,0,now()+interval '1 day',false)
        """), ids)
        db.execute(sa.text("""
          INSERT INTO refresh_sessions(id,token_hash,user_id,session_id,organization_id,identity_version,
            family_id,expires_at,family_expires_at,persistent)
          VALUES (:refresh,:hash,:user,:session,:org,0,:family,
            now()+interval '1 day',now()+interval '1 day',false)
        """), {**ids, "hash": token_digest("synthetic-legacy-refresh")})
        db.execute(sa.text("""
          INSERT INTO audit_events(id,actor_id,organization_id,action,resource_type,resource_id,outcome)
          VALUES (:audit,:user,:dangling,'legacy_test','organization',:org,'success')
        """), {**ids, "dangling": uuid.uuid4()})
    return ids


def backup(engine, config, tmp_path):
    # pytest directories live outside the workspace; restrict the immediate parent.
    tmp_path.chmod(0o700)
    path = tmp_path / "retired.json"
    with engine.connect() as db, db.begin():
        db.execute(sa.text("SET TRANSACTION READ ONLY"))
        sha = retirement.save_backup(db, path)
    config.cmd_opts = SimpleNamespace(x=[
        "organization_backup=" + str(path), "organization_backup_sha256=" + sha,
        "organization_restore_verified=" + sha, "organization_retention_resolved=yes",
    ])
    return path, sha


def retained(engine):
    result = {}
    with engine.connect() as db:
        for table in ("users", "auth_sessions", "refresh_sessions", "audit_events"):
            result[table] = [
                {k: v for k, v in row.items() if k != "organization_id"}
                for row in db.execute(sa.text(f"SELECT * FROM {table} ORDER BY id")).mappings()
            ]
    return result


def test_fresh_upgrade_downgrade_reupgrade_and_head_schema(retired_db, tmp_path):
    engine, config = retired_db
    with engine.connect() as db:
        report = retirement.preflight(db)
        assert report["unexpected_dependencies"] == []
        assert report["counts"]["organizations"] == 0
    backup(engine, config, tmp_path)
    command.upgrade(config, RETIREMENT_RELEASE)
    with engine.connect() as db:
        inspector = sa.inspect(db)
        assert not set(retirement.TABLES) & set(inspector.get_table_names())
        for table in ("refresh_sessions", "audit_events"):
            assert "organization_id" not in {c["name"] for c in inspector.get_columns(table)}
        # The pre-existing crypto phase registry is migration-only infrastructure.
        expected_models = set(Base.metadata.tables) - {"account_crypto_state"}
        assert set(inspector.get_table_names()) - {"alembic_version", "directory_crypto_stage"} == expected_models
        for name in expected_models:
            columns = set(Base.metadata.tables[name].c.keys())
            if name == "users":
                columns -= {"email_index", "username_index"}
            if name == "account_identifier_reservations":
                columns = {"identifier", "user_id"}
            assert {c["name"] for c in inspector.get_columns(name)} == columns
    restore_retirement(config)
    with engine.connect() as db:
        assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == RESTORE_TARGET
        assert retirement.catalog(db) == []
    command.upgrade(config, RETIREMENT_RELEASE)


@contextmanager
def current_auth_copy(engine, config):
    """Current auth runs only on a genuinely restored, separately upgraded copy.

    Leave the source at the historical retirement release so its independent
    restoration/downgrade protections are still actually exercised.
    """
    from account_migration_fixture import rehearsed_account_approval
    from unittest.mock import patch
    with rehearsed_account_approval(engine, expose_restore=True) as (arguments, restored):
        cloned = Config(config.config_file_name)
        cloned.set_main_option("sqlalchemy.url", restored.url.render_as_string(hide_password=False).replace("%", "%%"))
        arguments = [value for value in arguments if not value.startswith("account_expected_database=")]
        arguments.append("account_expected_database=" + restored.url.database)
        cloned.cmd_opts = SimpleNamespace(x=arguments)
        # env.py intentionally takes DATABASE_URL from Settings rather than
        # sqlalchemy.url; bind both to the restored copy, never the source.
        with patch.dict(os.environ, {"DATABASE_URL": restored.url.render_as_string(hide_password=False)}):
            get_settings.cache_clear()
            try:
                command.upgrade(cloned, "0035_account_identifiers")
                with Session(restored) as db:
                    yield db
            finally:
                get_settings.cache_clear()


def test_populated_upgrade_exact_recovery_and_security_markers(retired_db, tmp_path):
    engine, config = retired_db
    ids = seed(engine)
    before = retained(engine)
    with engine.connect() as db:
        report = retirement.preflight(db, limit=1)
        assert report["counts"]["organizations"] == report["counts"]["memberships"] == 1
        assert report["counts"]["dangling_audit_correlations"] == 1
        assert report["eligibility_counts"] == {"unmapped": 1}
        assert "password_hash" not in str(report) and "example.com" not in str(report)
        source = retirement.snapshot(db)
    path, sha = backup(engine, config, tmp_path)
    assert stat_private(path)
    assert "token_hash" not in path.read_text() and "password_hash" not in path.read_text()
    command.upgrade(config, RETIREMENT_RELEASE)
    after = retained(engine)
    for table in ("users", "auth_sessions", "refresh_sessions"):
        assert before[table] == after[table]
    assert all(row in after["audit_events"] for row in before["audit_events"])
    assert len(after["audit_events"]) == len(before["audit_events"]) + 1
    with current_auth_copy(engine, config) as db:
        # Previously scope-invalid credentials remain rejected even for an
        # otherwise eligible account, and cannot be called "session replaced".
        with pytest.raises(auth.AuthError) as failure:
            auth.rotate_refresh(db, "synthetic-legacy-refresh", get_settings(), "retired-check")
        assert not isinstance(failure.value, auth.SessionReplaced)
        # Rejection is independently attributable on the upgraded copy;
        # do not invent that event on the historical recovery source.
        assert db.scalar(sa.text("SELECT count(*) FROM audit_events WHERE reason='legacy_scope_retired'")) == 2
    restore_retirement(config)
    with engine.connect() as db:
        assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == RESTORE_TARGET
        assert retirement.snapshot(db) == source
        assert retirement.catalog(db) == []
        assert db.scalar(sa.text("SELECT count(*) FROM audit_events WHERE reason='legacy_scope_retired'")) == 1
    command.upgrade(config, RETIREMENT_RELEASE)
    with engine.connect() as db:
        # Migration marker does not duplicate on re-upgrade. Rejected attempts
        # were independently verified on the upgraded restored copy above.
        assert db.scalar(sa.text("""
          SELECT count(*) FROM audit_events WHERE resource_type='refresh_credential'
            AND resource_id=:id AND reason='legacy_scope_retired'
        """), {"id": ids["refresh"]}) == 1


def stat_private(path):
    return path.stat().st_mode & 0o077 == 0


@pytest.mark.parametrize("problem", [
    "missing_backup", "corrupt_backup", "retention_unresolved", "restore_unverified",
    "stale_backup", "target_mismatch", "extra_index", "extra_constraint", "view",
    "logical_function", "incoming_foreign_key", "audit_column_dependency",
])
def test_upgrade_blocks_and_rolls_back_everything(retired_db, tmp_path, problem):
    engine, config = retired_db
    seed(engine)
    path, sha = backup(engine, config, tmp_path)
    if problem == "missing_backup":
        config.cmd_opts.x = []
    elif problem == "corrupt_backup":
        path.write_text(path.read_text() + " ")
    elif problem in ("retention_unresolved", "restore_unverified"):
        prefix = "organization_retention_resolved=" if problem == "retention_unresolved" else "organization_restore_verified="
        config.cmd_opts.x = [v for v in config.cmd_opts.x if not v.startswith(prefix)]
    elif problem == "target_mismatch":
        value = json.loads(path.read_text())
        value["database"] = "other_test"
        path.write_bytes(retirement.canonical(value))
        new_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        config.cmd_opts.x = [v.replace(sha, new_sha) for v in config.cmd_opts.x]
    else:
        sql = {
            "stale_backup": "UPDATE organizations SET name='Changed'",
            "extra_index": "CREATE INDEX unexpected_org_name ON organizations(name)",
            "extra_constraint": "ALTER TABLE memberships ADD CONSTRAINT unexpected CHECK(is_active)",
            "view": "CREATE VIEW unexpected_legacy AS SELECT id FROM organizations",
            "logical_function": """CREATE FUNCTION unexpected_legacy() RETURNS integer LANGUAGE sql
                AS 'SELECT count(*)::integer FROM memberships'""",
            "incoming_foreign_key": "CREATE TABLE unexpected_link(id uuid REFERENCES organizations(id))",
            "audit_column_dependency": "CREATE INDEX unexpected_audit_org ON audit_events(organization_id)",
        }[problem]
        with engine.begin() as db:
            db.execute(sa.text(sql))
    before = retained(engine)
    with pytest.raises(retirement.RetirementBlocked):
        command.upgrade(config, RETIREMENT_RELEASE)
    assert retained(engine) == before
    with engine.connect() as db:
        assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == retirement.PREVIOUS
        assert db.scalar(sa.text("SELECT count(*) FROM memberships")) == 1


@pytest.mark.parametrize("problem", ["missing", "changed_credential", "changed_user", "missing_audit"])
def test_populated_downgrade_refuses_unsafe_recovery(retired_db, tmp_path, problem):
    engine, config = retired_db
    ids = seed(engine)
    backup(engine, config, tmp_path)
    command.upgrade(config, RETIREMENT_RELEASE)
    if problem == "missing":
        config.cmd_opts.x = []
    else:
        sql = {
            "changed_credential": "UPDATE refresh_sessions SET revoked_at=now() WHERE id=:refresh",
            "changed_user": "UPDATE users SET identity_version=1 WHERE id=:user",
            "missing_audit": "DELETE FROM audit_events WHERE id=:audit",
        }[problem]
        with engine.begin() as db:
            db.execute(sa.text(sql), ids)
    before = retained(engine)
    with pytest.raises(retirement.RetirementBlocked):
        restore_retirement(config)
    assert retained(engine) == before
    with engine.connect() as db:
        assert not set(retirement.TABLES) & set(sa.inspect(db).get_table_names())
        assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == RETIREMENT_RELEASE


def test_ddl_failure_is_atomic(retired_db, tmp_path, monkeypatch):
    engine, config = retired_db
    seed(engine)
    backup(engine, config, tmp_path)
    before = retained(engine)
    from alembic.operations import Operations
    original = Operations.drop_table

    def fail_second_drop(self, name, **kwargs):
        if name == "organizations":
            raise RuntimeError("synthetic injected DDL failure")
        return original(self, name, **kwargs)

    monkeypatch.setattr(Operations, "drop_table", fail_second_drop)
    with pytest.raises(RuntimeError, match="synthetic injected"):
        command.upgrade(config, RETIREMENT_RELEASE)
    assert retained(engine) == before
    with engine.connect() as db:
        assert retirement.catalog(db) == []


def test_scope_rejection_suppresses_false_replacement_for_eligible_mr(retired_db, tmp_path):
    engine, config = retired_db
    ids = seed(engine)
    with engine.begin() as db:
        db.execute(sa.text("UPDATE users SET system_role='mr' WHERE id=:user"), ids)
        db.execute(sa.text("INSERT INTO mr_profiles(id,user_id,is_active) VALUES (:id,:user,true)"),
                   {**ids, "id": uuid.uuid4()})
        db.execute(sa.text("UPDATE auth_sessions SET status='REVOKED',revoked_at=now() WHERE id=:session"), ids)
        db.execute(sa.text("UPDATE refresh_sessions SET revoked_at=now() WHERE id=:refresh"), ids)
        db.execute(sa.text("""
          INSERT INTO audit_events(id,actor_id,session_id,action,reason,outcome)
          VALUES (:id,:user,:session,'session_revoked','new_login','success')
        """), {**ids, "id": uuid.uuid4()})
    backup(engine, config, tmp_path)
    command.upgrade(config, RETIREMENT_RELEASE)
    with current_auth_copy(engine, config) as db:
        with pytest.raises(auth.AuthError) as failure:
            auth.rotate_refresh(db, "synthetic-legacy-refresh", get_settings(), "retired-check")
        assert not isinstance(failure.value, auth.SessionReplaced)


def test_bare_operator_url_and_report_failure_are_sanitized(monkeypatch, capsys):
    from app import organization_preflight
    assert retirement.connection_url("postgresql://test@/test") == "postgresql+psycopg://test@/test"
    monkeypatch.setattr("sys.argv", ["organization_preflight"])
    monkeypatch.setattr(organization_preflight, "get_settings",
                        lambda: SimpleNamespace(database_url="not-a-url-with-sensitive-values"))
    assert organization_preflight.main() == 2
    output = capsys.readouterr().out
    assert "sensitive-values" not in output
    assert json.loads(output)["status"] == "blocked"


def test_writer_lock_contention_blocks_without_changes(retired_db):
    engine, config = retired_db
    with engine.connect() as writer, writer.begin():
        writer.execute(sa.text("LOCK TABLE organizations IN ROW EXCLUSIVE MODE"))
        with pytest.raises(sa.exc.DBAPIError) as failure:
            command.upgrade(config, RETIREMENT_RELEASE)
        assert failure.value.orig.sqlstate == "55P03"
    with engine.connect() as db:
        assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == retirement.PREVIOUS
        assert retirement.preflight(db)["unexpected_dependencies"] == []


def test_predecessor_runtime_refuses_unmarked_legacy_scope_without_replacement(retired_db):
    engine, _ = retired_db
    ids = seed(engine)
    with engine.begin() as db:
        db.execute(sa.text("UPDATE users SET system_role='mr' WHERE id=:id"), {"id": ids["user"]})
        db.execute(sa.text("INSERT INTO mr_profiles(id,user_id,is_active) VALUES (:profile,:user,true)"),
                   {"profile": uuid.uuid4(), "user": ids["user"]})
    with Session(engine) as db, pytest.raises(auth.AuthError) as failure:
        auth.rotate_refresh(db, "synthetic-legacy-refresh", get_settings(), "synthetic-skew")
    assert not isinstance(failure.value, auth.SessionReplaced)
    with engine.connect() as db:
        assert db.scalar(sa.text("SELECT consumed_at FROM refresh_sessions WHERE id=:id"),
                         {"id": ids["refresh"]}) is None
        assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == retirement.PREVIOUS


def test_no_retained_rows_cannot_prove_organization_only_recovery_is_empty(retired_db, tmp_path):
    engine, config = retired_db
    with engine.begin() as db:
        db.execute(sa.text("INSERT INTO organizations (id,name) VALUES (:id,'Synthetic scope')"),
                   {"id": uuid.uuid4()})
    backup(engine, config, tmp_path)
    command.upgrade(config, RETIREMENT_RELEASE)
    config.cmd_opts = SimpleNamespace(x=[])
    with pytest.raises(retirement.RetirementBlocked):
        restore_retirement(config)
    with engine.connect() as db:
        assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == RETIREMENT_RELEASE
        assert "organizations" not in sa.inspect(db).get_table_names()
