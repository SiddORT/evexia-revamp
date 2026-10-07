"""Operator rotation/recovery regressions on private disposable PostgreSQL."""
import base64
import json
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor
from alembic import command

import pytest
from pydantic import SecretStr
from sqlalchemy import event, select, text
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import get_settings
from app.db.models import AuditEvent, User
from app.db.staff_models import StaffProfile
from app.schemas.staff import StaffFields, StaffStatus
from app.services import staff
from app.services import staff_rotation
from app.services.staff_crypto import StaffCrypto, StaffError
from app.services.staff_rotation import RotationError, _columns, rotate
from test_migration_0006 import migration_db
from test_migration_staff import identity, prepare
from test_staff import BODY


def setup(migration_db):
    engine, config, admin, session, _ = prepare(migration_db)
    command.upgrade(config, "head")
    settings = get_settings().model_copy(update={
        "staff_encryption_keys": SecretStr(json.dumps({
            "primary": base64.b64encode(b"A" * 32).decode(),
            "next": base64.b64encode(b"C" * 32).decode(),
        }))
    })
    with Session(engine) as db:
        for number in range(2):
            staff.create(db, identity(db, admin, session),
                         StaffFields(**{**BODY, "email": f"fictional{number}@example.com"}), settings)
    return engine, settings, admin, session


def snapshot(engine):
    with Session(engine) as db:
        return {row.id: _columns(row) for row in db.scalars(select(StaffProfile))}


def approved(plan):
    return dict(execute=True, approval=plan["approval"], backup_ref=str(uuid.uuid4()),
                operator_ref=str(uuid.uuid4()), writes_paused=True, recovery_verified=True)


def test_atomic_rotation_dry_run_versions_privacy_and_repeat(migration_db):
    engine, settings, admin, session = setup(migration_db)
    before = snapshot(engine)
    with Session(engine) as db:
        users = {u.id: _columns(u) for u in db.scalars(select(User))}
        db.rollback()
        plan = rotate(db, settings, target_key_id="next")
        assert plan["status"] == "dry-run" and plan["records"] == 2
        assert plan["key_usage"] == {"primary": 6}
        assert snapshot(engine) == before
        result = rotate(db, settings, target_key_id="next", **approved(plan))
        assert result["changed"] == 2 and result["content_digest"] == plan["content_digest"]
        assert result["key_usage"] == {"next": 6}
        assert {u.id: _columns(u) for u in db.scalars(select(User))} == users
        events = list(db.scalars(select(AuditEvent).where(AuditEvent.resource_type == "staff_maintenance")))
        assert len(events) == 1 and events[0].actor_id is None and events[0].request_id == plan["approval"]
        assert BODY["name"] not in str(events[0].__dict__)
        db.rollback()
        check = rotate(db, settings, target_key_id="next",
                       expected_content_digest=plan["content_digest"])
        assert rotate(db, settings, target_key_id="next", **approved(check))["changed"] == 0
    after = snapshot(engine)
    for row_id, row in after.items():
        assert row["version"] == before[row_id]["version"] + 1
        for field in ("email_index", "updated_at", "updated_by", "created_at", "user_id"):
            assert row[field] == before[row_id][field]
    with Session(engine) as db:
        with pytest.raises(StaffError, match="Staff record changed"):
            staff.edit(db, identity(db, admin, session), settings, next(iter(after)),
                       StaffStatus(status="inactive", expected_version=1), True)


@pytest.mark.parametrize("problem", ["missing-key", "wrong-key", "wrong-index", "field-swap", "version",
                                   "record-swap", "approval", "backup", "pause", "recovery", "production"])
def test_fail_closed_inputs_and_approvals_leave_data_unchanged(migration_db, problem):
    engine, settings, _, _ = setup(migration_db)
    with Session(engine) as db:
        plan = rotate(db, settings, target_key_id="next")
    args = approved(plan)
    if problem in {"missing-key", "wrong-key"}:
        keys = {"next": base64.b64encode(b"C" * 32).decode()}
        if problem == "wrong-key":
            keys["primary"] = base64.b64encode(b"D" * 32).decode()
        settings = settings.model_copy(update={"staff_encryption_keys": SecretStr(json.dumps(keys)),
                                              "staff_encryption_key_id": "next"})
    elif problem == "wrong-index":
        settings = settings.model_copy(update={"staff_email_index_key": SecretStr(base64.b64encode(b"D" * 32).decode())})
    elif problem in {"field-swap", "record-swap", "version"}:
        with Session(engine) as db:
            rows = list(db.scalars(select(StaffProfile).order_by(StaffProfile.id)))
            if problem == "field-swap":
                rows[0].name_ciphertext, rows[0].phone_ciphertext = rows[0].phone_ciphertext, rows[0].name_ciphertext
            elif problem == "record-swap":
                rows[0].name_ciphertext = rows[1].name_ciphertext
            else:
                rows[0].version += 1
            db.commit()
    elif problem == "approval":
        args["approval"] = "0" * 64
    elif problem == "backup":
        args["backup_ref"] = None
    elif problem == "pause":
        args["writes_paused"] = False
    elif problem == "recovery":
        args["recovery_verified"] = False
    else:
        settings = settings.model_copy(update={"app_env": "production"})
    before = snapshot(engine)
    with Session(engine) as db, pytest.raises(RotationError):
        rotate(db, settings, target_key_id="next", **args)
    assert snapshot(engine) == before


def test_interruption_rolls_back_all_rows_and_resumes_without_checkpoint(migration_db, monkeypatch):
    engine, settings, _, _ = setup(migration_db)
    before = snapshot(engine)
    with Session(engine) as db:
        plan = rotate(db, settings, target_key_id="next")
        encrypt, calls = StaffCrypto.encrypt, []
        def interrupted(self, *args):
            calls.append(1)
            if len(calls) == 4:
                raise RuntimeError("synthetic interruption after first record")
            return encrypt(self, *args)
        with monkeypatch.context() as patch:
            patch.setattr(StaffCrypto, "encrypt", interrupted)
            with pytest.raises(RotationError):
                rotate(db, settings, target_key_id="next", **approved(plan))
        assert snapshot(engine) == before
        assert rotate(db, settings, target_key_id="next")["approval"] == plan["approval"]
        assert rotate(db, settings, target_key_id="next", **approved(plan))["changed"] == 2
        # Reviewed reverse rotation retains content and invalidates stale versions.
        reverse = rotate(db, settings, target_key_id="primary")
        rotate(db, settings, target_key_id="primary", **approved(reverse))
        assert rotate(db, settings, target_key_id="next",
                      expected_content_digest=plan["content_digest"])["content_digest"] == plan["content_digest"]


def test_database_failure_after_flush_has_no_partial_commit(migration_db):
    engine, settings, _, _ = setup(migration_db)
    before = snapshot(engine)
    with Session(engine) as db:
        plan = rotate(db, settings, target_key_id="next")
        def fail_commit(_session):
            raise RuntimeError("synthetic interrupted commit")
        event.listen(db, "before_commit", fail_commit)
        with pytest.raises(RotationError):
            rotate(db, settings, target_key_id="next", **approved(plan))
    assert snapshot(engine) == before


def test_database_lock_excludes_uncooperative_writer_and_operator(migration_db):
    engine, settings, _, _ = setup(migration_db)
    with Session(engine) as db:
        plan = rotate(db, settings, target_key_id="next")
    with engine.connect() as writer:
        writer.execute(text("UPDATE staff_profiles SET version=version+1"))
        with Session(engine) as db, pytest.raises(RotationError):
            rotate(db, settings, target_key_id="next", **approved(plan))
        writer.rollback()
    with engine.connect() as operator:
        operator.execute(text("LOCK TABLE staff_profiles IN ACCESS EXCLUSIVE MODE NOWAIT"))
        def write():
            with engine.begin() as connection:
                connection.execute(text("SET LOCAL lock_timeout = '100ms'"))
                connection.execute(text("UPDATE staff_profiles SET version=version+1"))
        with ThreadPoolExecutor() as pool:
            with pytest.raises(Exception):
                pool.submit(write).result(timeout=5)
        operator.rollback()


def test_atomic_email_rekey_and_coordinated_backup_recovery(migration_db):
    engine, settings, _, _ = setup(migration_db)
    next_key = SecretStr(base64.b64encode(b"D" * 32).decode())
    before = snapshot(engine)
    with Session(engine) as db:
        plan = rotate(db, settings, operation="email-index", next_index_key=next_key)
        rotate(db, settings, operation="email-index", next_index_key=next_key, **approved(plan))
        next_settings = settings.model_copy(update={"staff_email_index_key": next_key})
        with pytest.raises(RotationError):
            rotate(db, settings, target_key_id="primary")
        check = rotate(db, next_settings, target_key_id="primary")
        assert check["content_digest"] == plan["content_digest"]
        assert all(snapshot(engine)[k]["email_index"] != v["email_index"] for k, v in before.items())
        # An isolated coordinated restore: exact profile snapshot + original
        # keys. Never a partial live rollback while normal writes are enabled.
        for row_id, values in before.items():
            row = db.get(StaffProfile, row_id)
            for key, value in values.items():
                setattr(row, key, value)
            flag_modified(row, "updated_at")
        db.commit()
        restored = rotate(db, settings, target_key_id="primary",
                          expected_content_digest=plan["content_digest"])
        assert restored["approval"] == rotate(db, settings, target_key_id="primary")["approval"]
        with pytest.raises(RotationError):
            rotate(db, next_settings, target_key_id="primary")
        with pytest.raises(RotationError, match="Recovered"):
            rotate(db, settings, target_key_id="primary", expected_content_digest="0" * 64)


def test_target_duplicate_index_aborts_before_any_commit(migration_db, monkeypatch):
    engine, settings, _, _ = setup(migration_db)
    next_key = SecretStr(base64.b64encode(b"D" * 32).decode())
    before = snapshot(engine)
    with Session(engine) as db:
        plan = rotate(db, settings, operation="email-index", next_index_key=next_key)
        original = StaffCrypto.email_index
        def collision(self, value):
            return "0" * 64 if self.index_key == b"D" * 32 else original(self, value)
        monkeypatch.setattr(StaffCrypto, "email_index", collision)
        with pytest.raises(RotationError, match="Duplicate"):
            rotate(db, settings, operation="email-index", next_index_key=next_key, **approved(plan))
        with pytest.raises(RotationError, match="Duplicate"):
            rotate(db, settings, operation="email-index", next_index_key=next_key)
    assert snapshot(engine) == before


def test_mixed_historical_fields_keep_completed_ciphertext_and_verify_replacements(migration_db, monkeypatch):
    engine, settings, _, _ = setup(migration_db)
    crypto = StaffCrypto(settings.model_copy(update={"staff_encryption_key_id": "next"}))
    with Session(engine) as db:
        row = db.scalar(select(StaffProfile).order_by(StaffProfile.id))
        row_id = row.id
        row.name_ciphertext = crypto.encrypt(row.id, "name", BODY["name"])
        completed = row.name_ciphertext
        db.commit()
        plan = rotate(db, settings, target_key_id="next")
        assert plan["key_usage"] == {"next": 1, "primary": 5}
        with monkeypatch.context() as patch:
            original = StaffCrypto.encrypt
            patch.setattr(StaffCrypto, "encrypt",
                          lambda self, record, field, value: original(self, record, field, value + "altered"))
            with pytest.raises(RotationError, match="integrity"):
                rotate(db, settings, target_key_id="next", **approved(plan))
        rotate(db, settings, target_key_id="next", **approved(plan))
        assert db.get(StaffProfile, row_id).name_ciphertext == completed


def test_operator_cli_defaults_to_dry_run_and_requires_exact_approval(migration_db, monkeypatch, capsys):
    engine, settings, _, _ = setup(migration_db)
    before = snapshot(engine)
    monkeypatch.setattr(staff_rotation, "OperatorSettings", lambda: settings)
    monkeypatch.setattr(staff_rotation, "session_factory", lambda: lambda: Session(engine))
    assert staff_rotation.main(["encrypt", "--target-key-id", "next"]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["status"] == "dry-run" and snapshot(engine) == before
    assert staff_rotation.main(["encrypt", "--target-key-id", "next", "--execute"]) == 1
    failed = capsys.readouterr()
    assert failed.out == "" and "no success is confirmed" in failed.err
    assert snapshot(engine) == before
    assert staff_rotation.main(["encrypt", "--target-key-id", "next", "--execute",
                               "--approval", plan["approval"], "--backup-ref", str(uuid.uuid4()),
                               "--operator-ref", str(uuid.uuid4()), "--writes-paused",
                               "--recovery-verified"]) == 0
    output = capsys.readouterr().out
    assert json.loads(output)["changed"] == 2 and BODY["name"] not in output


def test_full_database_schema_backup_restores_credentials_history_and_keys(migration_db, tmp_path):
    engine, settings, _, _ = setup(migration_db)
    with Session(engine) as db:
        schema = db.scalar(text("SELECT current_schema()"))
        db.rollback()
        plan = rotate(db, settings, target_key_id="next")
        users = list(db.execute(text("SELECT id,password_hash FROM users ORDER BY id")))
        audits = db.scalar(text("SELECT count(*) FROM audit_events"))
    # Only the private socket test database is ever passed to backup utilities.
    url = engine.url.set(drivername="postgresql")
    backup = tmp_path / "coordinated.sql"
    dumped = subprocess.run(["pg_dump", "--dbname", url.render_as_string(hide_password=False),
                             "--schema", schema, "--file", str(backup)],
                            capture_output=True)
    assert dumped.returncode == 0, "Synthetic backup failed"
    backup.chmod(0o600)
    with Session(engine) as db:
        rotate(db, settings, target_key_id="next", **approved(plan))
    engine.dispose()
    with engine.begin() as connection:
        # Schema name is fixture-generated, never user input.
        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    restored = subprocess.run(["psql", "--dbname", url.render_as_string(hide_password=False),
                               "--set", "ON_ERROR_STOP=1", "--file", str(backup)],
                              capture_output=True)
    assert restored.returncode == 0, "Synthetic restore failed"
    with Session(engine) as db:
        result = rotate(db, settings, target_key_id="next",
                        expected_content_digest=plan["content_digest"])
        assert result["approval"] == plan["approval"] and result["key_usage"] == {"primary": 6}
        assert list(db.execute(text("SELECT id,password_hash FROM users ORDER BY id"))) == users
        assert db.scalar(text("SELECT count(*) FROM audit_events")) == audits
