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
from test_mrs import fields, csv_data


def setup(fixture):
    engine, config, actor_id, session_id = prepare(fixture)
    with Session(engine) as db:
        actor = identity(db, actor_id, session_id)
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
