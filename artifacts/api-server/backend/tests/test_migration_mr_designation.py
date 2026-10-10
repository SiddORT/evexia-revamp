"""Populated historical schema fixtures; never connect to managed databases."""
import uuid
import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.models import User, MRProfile
from app.db.designation_models import Designation
from app.db.headquarter_models import Headquarter
from app.db.zone_models import Zone
from app.core.security import utcnow
from test_migration_0006 import migration_db
from test_migration_zones import prepare
from test_mrs import fields


def historical(fixture, labels, catalogue):
    engine, config, actor, sid = prepare(fixture)
    command.downgrade(config, "0026_designation_target")
    with Session(engine) as db:
        hq = Headquarter(name="Historical HQ", state_code="HH", status="active", created_by=actor, updated_by=actor)
        zone = Zone(name="Historical Zone", status="active", created_by=actor, updated_by=actor)
        db.add_all([hq, zone])
        keys = []
        for name, status, deleted in catalogue:
            row = Designation(name=name, shortName="MR", status=status, created_by=actor, updated_by=actor)
            if deleted:
                row.deleted_by, row.deleted_at = actor, utcnow()
            db.add(row); db.flush()
            keys.append(row.id)
        db.flush()
        ids = []
        for n, label in enumerate(labels):
            user = User(username=f"history.mr.{n}", email=None, password_hash="inert-historical-fixture",
                        system_role="mr", is_active=n == 0)
            db.add(user); db.flush()
            profile = MRProfile(user_id=user.id, is_active=n == 0)
            db.add(profile); db.flush()
            values = fields(hq.id, zone.id, code=f"HIST-{n}", username=user.username)
            # This fixture predates persisted MR phone countries.
            values.pop("dialCountry")
            values.pop("userId"); values.pop("designation_id")
            values.update(id=profile.id, designation=label, created_by=actor, updated_by=actor,
                          version=n + 7, paymentLimit="123.45", doctorDaysLimit=42,
                          dateOfJoining="2020-01-01", status="active" if n == 0 else "inactive")
            if n == 2:
                values.update(deleted_at="2020-01-01T00:00:00Z", deleted_by=actor)
            columns = ", ".join(f'"{k}"' for k in values)
            binds = ", ".join(f":{k}" for k in values)
            db.execute(text(f"INSERT INTO mr_directory ({columns}) VALUES ({binds})"), values)
            ids.append(profile.id)
        db.commit()
        before = [dict(row) for row in db.execute(text("SELECT * FROM mr_directory ORDER BY id")).mappings()]
        accounts = db.execute(text("SELECT * FROM users ORDER BY id")).all()
        profiles = db.execute(text("SELECT * FROM mr_profiles ORDER BY id")).all()
        audits = db.execute(text("SELECT * FROM audit_events ORDER BY id")).all()
    return engine, config, keys, ids, before, (accounts, profiles, audits)


def test_populated_normalized_backfill_all_lifecycles_and_restrict(migration_db):
    fixture = historical(migration_db, ["  MEDICAL   representative ", "Inactive", "Deleted"],
                         [("Medical Representative", "active", False),
                          ("Inactive", "inactive", False), ("Deleted", "inactive", True)])
    engine, config, keys, ids, before, history = fixture
    # This test isolates catalogue reconciliation; later coordinated encryption
    # requires its own populated-source backfill and retirement approval.
    command.upgrade(config, "0027_mr_designation_identity")
    with Session(engine) as db:
        after = [dict(row) for row in db.execute(text("SELECT * FROM mr_directory ORDER BY id")).mappings()]
        for old, new in zip(before, after):
            assert new.pop("designation_id") == keys[ids.index(old["id"])]
            old.pop("designation")
            assert old == new
        assert db.execute(text("SELECT * FROM users ORDER BY id")).all() == history[0]
        assert db.execute(text("SELECT * FROM mr_profiles ORDER BY id")).all() == history[1]
        assert db.execute(text("SELECT * FROM audit_events ORDER BY id")).all() == history[2]
        for sql in ("DELETE FROM designations WHERE id=:id",
                    "UPDATE mr_directory SET designation_id=NULL",
                    "UPDATE mr_directory SET designation_id=:unknown"):
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(text(sql), dict(id=keys[0], unknown=uuid.uuid4()))
    with pytest.raises(RuntimeError, match="original labels"):
        command.downgrade(config, "0026_designation_target")


@pytest.mark.parametrize("labels,catalogue", [
    (["Missing"], [("Other", "active", False)]),
    (["Matching", "Missing", "Missing"], [("Matching", "active", False)]),
    ([" SAME  name "], [("Same Name", "active", False), ("same name", "inactive", True)]),
])
def test_unmatched_ambiguous_inactive_deleted_mrs_rollback(migration_db, labels, catalogue):
    engine, config, _, _, before, _ = historical(migration_db, labels, catalogue)
    with pytest.raises(RuntimeError, match="reconciliation required"):
        command.upgrade(config, "0027_mr_designation_identity")
    with engine.connect() as db:
        assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0026_designation_target"
        assert [dict(row) for row in db.execute(text("SELECT * FROM mr_directory ORDER BY id")).mappings()] == before
        columns = db.scalars(text("SELECT column_name FROM information_schema.columns WHERE table_name='mr_directory' AND table_schema=current_schema()")).all()
        assert "designation" in columns and "designation_id" not in columns
