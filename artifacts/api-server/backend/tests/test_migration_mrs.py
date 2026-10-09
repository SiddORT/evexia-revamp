"""Actual migration, committed races and identity/session/history preservation."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.security import hash_password
from app.db.models import User, MRProfile, Patient, AuthSession, AuditEvent
from app.db.mr_models import MRDirectory
from app.schemas.mrs import MRCreate, MREdit, MRVersion, MRStatus
from app.schemas.zones import ZoneFields
from app.schemas.headquarters import HeadquarterFields
from app.services import mrs, zones, headquarters, mr_transfer
from app.services.auth import AuthError
from test_migration_0006 import migration_db
from test_migration_zones import prepare, identity
from test_mrs import fields, csv_data, seed_designation


def setup(fixture):
    engine, config, actor_id, session_id = prepare(fixture)
    with Session(engine) as db:
        actor = identity(db, actor_id, session_id)
        seed_designation(db, actor_id)
        hq = headquarters.create(db, actor, HeadquarterFields(name="HQ for MRs", status="active"))["id"]
        zone = zones.create(db, actor, ZoneFields(name="Zone for MRs", status="active"))["id"]
    return engine, config, actor_id, session_id, hq, zone


def test_empty_migration_preserves_identity_patient_and_session_history(migration_db):
    engine, config, actor_id, session_id = prepare(migration_db)
    command.downgrade(config, "0017_headquarters")
    with Session(engine) as db:
        user = User(email="identity-only@example.com", username="identity.only", password_hash=hash_password("Synthetic previous password"),
                    system_role="mr", identity_version=1)
        db.add(user)
        db.flush()
        profile = MRProfile(user_id=user.id, is_active=True)
        db.add(profile)
        db.flush()
        patient = Patient(assigned_mr_id=profile.id, is_active=True)
        db.add(patient)
        db.commit()
        ids = user.id, profile.id, patient.id
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.get(User, ids[0]).username == "identity.only"
        assert db.get(MRProfile, ids[1]).is_active
        assert db.get(Patient, ids[2]).assigned_mr_id == ids[1]
        assert db.get(AuthSession, session_id).status == "ACTIVE"
        assert db.scalar(select(func.count()).select_from(MRDirectory)) == 0
        assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "before_zone_migration"))
        with pytest.raises(IntegrityError):
            db.execute(text("UPDATE users SET email=NULL WHERE id=:id"), {"id": ids[0]})
            db.commit()
        db.rollback()


def test_case_insensitive_account_and_employee_races(migration_db):
    engine, _, actor_id, session_id, hq, zone = setup(migration_db)
    barrier = Barrier(2)
    def run(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return mrs.create(db, actor, MRCreate(**fields(hq, zone, code="Dupe" if index else "DUPE",
                                                             username="first.mr" if index else "other.mr")))
            except mrs.MRError as exc:
                return exc.status
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1 and 409 in results
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(MRDirectory)) == 1
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "mr_directory_create")) == 1


def test_competing_manager_updates_cannot_create_cycle(migration_db):
    engine, _, actor_id, session_id, hq, zone = setup(migration_db)
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        a = mrs.create(db, actor, MRCreate(**fields(hq, zone)))["record"]
        b = mrs.create(db, actor, MRCreate(**fields(hq, zone, code="MR-02", username="second.mr")))["record"]
    barrier = Barrier(2)
    def change(index):
        record, target = (a, b) if index else (b, a)
        body = {**fields(hq, zone, code=record["employeeCode"], username=record["userId"]),
                "reportingManagerId": target["id"], "expected_version": 1}
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return mrs.mutate(db, actor, record["id"], MREdit(**body), "edit")
            except mrs.MRError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1 and "mr_manager_cycle" in results


def test_import_conflict_provisioning_failure_rolls_back_whole_batch(migration_db, monkeypatch):
    engine, _, actor_id, session_id, hq, zone = setup(migration_db)
    data = csv_data([fields(hq, zone), fields(hq, zone, code="MR-02", username="second.mr")])
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        review = mr_transfer.transfer(db, actor, data, "mrs.csv")
        original, calls = mrs.insert, 0
        def fail(db, actor, body, password, record_id):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise mrs.MRError("Synthetic provisioning failure")
            return original(db, actor, body, password, record_id)
        monkeypatch.setattr(mrs, "insert", fail)
        with pytest.raises(mrs.MRError):
            mr_transfer.transfer(db, actor, data, "mrs.csv", True, review["digest"])
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(MRDirectory)) == 0
        assert db.scalar(select(func.count()).select_from(MRProfile)) == 0
        assert db.scalar(select(func.count()).select_from(User)) == 1
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "mr_directory_create")) == 0


def test_namespace_reserves_old_identifiers_and_prevents_cross_field_races(migration_db):
    engine, _, actor_id, session_id, hq, zone = setup(migration_db)
    with Session(engine, expire_on_commit=False) as db:
        actor = identity(db, actor_id, session_id)
        row = mrs.create(db, actor, MRCreate(**fields(hq, zone)))["record"]
        mrs.mutate(db, actor, row["id"], MREdit(**fields(hq, zone, username="changed.mr"), expected_version=1), "edit")
        with pytest.raises(mrs.MRError):
            mrs.create(db, actor, MRCreate(**fields(hq, zone, code="MR-02")))
        # SQL writes from other account services use the same DB namespace guard.
        with pytest.raises(IntegrityError):
            db.add(User(email="other@example.com", username="SYNTHETIC.MR", password_hash=hash_password("Synthetic password"),
                        system_role=None, is_active=False))
            db.commit()
        db.rollback()
        profile = db.get(MRProfile, row["id"])
        patient = Patient(assigned_mr_id=profile.id, is_active=True)
        db.add(patient)
        db.commit()
        patient_id = patient.id
        mrs.mutate(db, actor, row["id"], MRVersion(expected_version=2), "delete")
        assert db.get(Patient, patient_id).assigned_mr_id == row["id"]
        assert db.get(User, profile.user_id) is not None and not db.get(MRProfile, row["id"]).is_active
    with pytest.raises(RuntimeError):
        command.downgrade(migration_db[1], "0017_headquarters")


def test_hashing_revalidates_revoked_actor_before_create(migration_db, monkeypatch):
    engine, _, actor_id, session_id, hq, zone = setup(migration_db)
    original = mrs.prepare_passwords
    def prepare_then_revoke(db, actor, passwords):
        prepared = original(db, actor, passwords)
        with Session(engine) as other:
            other.execute(text("UPDATE auth_sessions SET status='REVOKED',revoked_at=now() WHERE id=:id"), {"id": session_id})
            other.commit()
        return prepared
    monkeypatch.setattr(mrs, "prepare_passwords", prepare_then_revoke)
    with Session(engine) as db:
        with pytest.raises(AuthError):
            mrs.create(db, identity(db, actor_id, session_id), MRCreate(**fields(hq, zone)))
        assert db.scalar(select(func.count()).select_from(MRDirectory)) == 0


def test_maximum_exports_bulk_queries_exact_rows_caps_and_revocation(migration_db, record_property, monkeypatch):
    import csv
    import io
    from openpyxl import load_workbook
    from mr_projection_fixture import seed_directory, measured_queries
    engine, _, actor_id, session_id, _, _ = setup(migration_db)
    with Session(engine) as db:
        ids = seed_directory(db, actor_id, 5000)
    for format in ("csv", "xlsx"):
        # Fresh connection and session for every measurement; no identity-map cache.
        with engine.connect() as connection, Session(connection) as db:
            actor = identity(db, actor_id, session_id)
            with measured_queries(connection) as metric:
                data = mr_transfer.export(db, actor, "Bulk MR", "all", None, None, format)
            record_property(f"mr_{format}_queries", len(metric["statements"]))
            record_property(f"mr_{format}_seconds", metric["seconds"])
            assert len(metric["statements"]) <= 48
            assert max(metric["bind_counts"]) <= 500
            assert metric["seconds"] < (6 if format == "csv" else 12)
            if format == "csv":
                exported = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
                assert exported[0] == mr_transfer.HEADERS
            else:
                book = load_workbook(io.BytesIO(data), read_only=True)
                exported = list(book.active.values)
                book.close()
                assert list(exported[0]) == mr_transfer.HEADERS + mr_transfer.AUDIT
            assert len(exported) == 5001  # Complete, not a silently truncated page.
            # Compare every exported business field, order and optional audit field.
            rows = list(db.scalars(select(MRDirectory).where(MRDirectory.id.in_(ids)).order_by(
                MRDirectory.created_at.desc(), MRDirectory.id.desc())))
            for record, cells in zip(rows, exported[1:]):
                index = int(record.employeeCode.removeprefix("FIX-"))
                values = {key: getattr(record, key) for key, _ in mr_transfer.COLUMNS if key != "userId"}
                values.update(designation_id=f"Fixture designations {index % 110}", userId=f"fixture.mr.{index}", hq=f"Fixture headquarters {index % 110}",
                              zoneId=f"Fixture zones {index % 110}",
                              reportingManagerId=f"user:fixture.mr.{index - 1 if index else 5000}",
                              createdBy="Super Admin", updatedBy="Backend user",
                              createdAt=record.created_at, updatedAt=record.updated_at)
                expected = [str(values[key]) for key, _ in mr_transfer.COLUMNS]
                if format == "xlsx":
                    expected += [str(values[key]) for key in ("createdBy", "createdAt", "updatedBy", "updatedAt")]
                    expected = [value if value else None for value in expected]
                assert list(cells) == expected
            assert "inert-fixture-not-a-password-hash" not in str(exported)
            assert exported[-1][mr_transfer.HEADERS.index("Reporting Manager")] == "user:fixture.mr.5000"
    # Make the saved tombstone live: one over the real cap must fail, not truncate.
    with Session(engine) as db:
        db.execute(text("UPDATE mr_directory SET deleted_at=NULL, deleted_by=NULL WHERE deleted_at IS NOT NULL"))
        db.commit()
        with pytest.raises(mrs.MRError) as error:
            mr_transfer.export(db, identity(db, actor_id, session_id), "", "all", None, None, "csv")
        assert error.value.code == "mr_export_limit"
        # Simulate growth between count and read under READ COMMITTED: the
        # sentinel row check must independently reject, rather than lose a row.
        original_scalar = db.scalar
        def earlier_count(statement, *args, **kwargs):
            value = original_scalar(statement, *args, **kwargs)
            return 5000 if "count(" in str(statement) and "mr_directory" in str(statement) else value
        with monkeypatch.context() as patch:
            patch.setattr(db, "scalar", earlier_count)
            with pytest.raises(mrs.MRError) as error:
                mr_transfer.export(db, identity(db, actor_id, session_id), "", "all", None, None, "xlsx")
            assert error.value.code == "mr_export_limit"
        actor = identity(db, actor_id, session_id)
        db.execute(text("UPDATE auth_sessions SET status='REVOKED',revoked_at=now() WHERE id=:id"), {"id": session_id})
        db.commit()
        for read in (lambda: mrs.listing(db, actor), lambda: mr_transfer.export(db, actor, "", "all", None, None, "csv")):
            with pytest.raises(AuthError):
                read()
