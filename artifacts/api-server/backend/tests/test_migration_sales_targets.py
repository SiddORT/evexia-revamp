"""Real forward migration, database constraints and committed duplicate races."""
import uuid
from datetime import date
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.models import User, MRProfile, AuditEvent
from app.db.mr_models import MRDirectory
from app.db.zone_models import Zone
from app.db.headquarter_models import Headquarter
from app.db.sales_target_models import SalesTarget
from app.db.designation_models import Designation
from app.schemas.sales_targets import SalesTargetFields, SalesTargetStatus, SalesTargetVersion
from app.services import sales_targets, sales_target_transfer
from test_migration_0006 import migration_db
from test_migration_zones import prepare, identity
from test_sales_targets import fields, HEADER


def seed(db, actor_id, historical=False):
    zone = Zone(name="Migration zone", status="active", created_by=actor_id, updated_by=actor_id)
    hq = Headquarter(name="Migration HQ", state_code="MH", status="active", created_by=actor_id, updated_by=actor_id)
    db.add_all([zone, hq])
    user = User(username="migration.mr", email=None, password_hash="not-a-login", system_role="mr")
    db.add(user)
    db.flush()
    profile = MRProfile(user_id=user.id, is_active=True)
    db.add(profile)
    db.flush()
    designation_id = uuid.uuid4()
    if historical:
        # Explicit pre-cleanup catalogue contract; do not insert current ORM fields.
        db.execute(text("""
            INSERT INTO designations (id,name,"shortName",status,version,created_by,updated_by,
                level,"basicDa",hra,"medicalAllowance","travellingAllowance","specialAllowance","professionalTax")
            VALUES (:id,'MR','MR','active',1,:actor,:actor,1,0,0,0,0,0,0)
        """), dict(id=designation_id, actor=actor_id))
    else:
        db.add(Designation(id=designation_id, name="MR", shortName="MR", status="active",
                           created_by=actor_id, updated_by=actor_id))
        db.flush()
    mr = MRDirectory(id=profile.id, name="Migration MR", phone="", email="", contactRequirement="optional",
                     hq=hq.id, zoneId=zone.id, employeeCode="RACE-MR", dateOfJoining=date(2020, 1, 1),
                     designation_id=designation_id, reportingManagerId=None, paymentLimit=Decimal("0"),
                     doctorDaysLimit=0, status="active", pincode="110001", addressLine1="Synthetic",
                     addressLine2="", landmark="", city="Delhi", state="Delhi", country="India",
                     created_by=actor_id, updated_by=actor_id)
    if historical:
        values = {column.name: getattr(mr, column.name) for column in MRDirectory.__table__.columns
                  if column.name not in ("designation_id", "created_at", "updated_at", "version")}
        values["designation"], values["version"] = "MR", 1
        columns = ", ".join(f'"{key}"' for key in values)
        parameters = ", ".join(f":{key}" for key in values)
        db.execute(text(f"INSERT INTO mr_directory ({columns}) VALUES ({parameters})"), values)
    else:
        db.add(mr)
    db.commit()
    return {"id": str(mr.id)}


def test_empty_migration_preserves_prior_records_rejects_rounding_and_keeps_history(migration_db):
    engine, config, actor_id, session_id = prepare(migration_db)
    command.downgrade(config, "0022_allergen_catalogue")
    with Session(engine) as db:
        mr = seed(db, actor_id, historical=True)
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SalesTarget)) == 0
        assert db.get(User, actor_id).is_protected_system_admin
        assert db.get(MRDirectory, uuid.UUID(mr["id"])).employeeCode == "RACE-MR"
        actor = identity(db, actor_id, session_id)
        row = sales_targets.create(db, actor, SalesTargetFields(**fields(mr)))
        for sql in ("UPDATE sales_targets SET q1=-1", "UPDATE sales_targets SET q2=1.001",
                    "UPDATE sales_targets SET q3=1000000000000", "UPDATE sales_targets SET q4='NaN'",
                    'UPDATE sales_targets SET "endYear"="startYear"+2',
                    'UPDATE sales_targets SET "startYear"=0,"endYear"=1',
                    "UPDATE sales_targets SET version=0", "UPDATE sales_targets SET status='bad'",
                    "UPDATE sales_targets SET deleted_at=now()"):
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.execute(text(sql))
        sales_targets.mutate(db, actor, row["id"], SalesTargetVersion(expected_version=1), "delete")
    with pytest.raises(RuntimeError, match="MR designation downgrade"):
        command.downgrade(config, "0022_allergen_catalogue")
    with Session(engine) as db:
        assert db.get(SalesTarget, row["id"]).deleted_by == actor_id


def test_duplicate_races_inactive_uniqueness_and_stale_mutation(migration_db):
    engine, _, actor_id, session_id = prepare(migration_db)
    with Session(engine) as db:
        mr = seed(db, actor_id)
    barrier = Barrier(2)
    def create(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                return sales_targets.create(db, actor, SalesTargetFields(**fields(mr, status="inactive" if index else "active")))
            except sales_targets.SalesTargetError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1 and "sales_target_duplicate" in results
    row = next(result for result in results if isinstance(result, dict))
    barrier = Barrier(2)
    def mutate(index):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            barrier.wait(timeout=10)
            try:
                body = SalesTargetStatus(expected_version=1, status="inactive") if index else SalesTargetVersion(expected_version=1)
                return sales_targets.mutate(db, actor, row["id"], body, "status" if index else "delete")
            except sales_targets.SalesTargetError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(mutate, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "sales_target_stale" in results or "not_found" in results
    with Session(engine) as db:
        events = db.scalars(select(AuditEvent).where(AuditEvent.action.in_(("sales_target_delete", "sales_target_status")))).all()
        assert len(events) == 1


def test_concurrent_import_conflicts_roll_back_complete_batch(migration_db):
    engine, _, actor_id, session_id = prepare(migration_db)
    with Session(engine) as db:
        seed(db, actor_id)
    data = (HEADER + "RACE-MR,2030,2031,1,2,3,4,active\nRACE-MR,2032,2033,1,2,3,4,inactive").encode()
    barrier = Barrier(2)
    def run(_):
        with Session(engine, expire_on_commit=False) as db:
            actor = identity(db, actor_id, session_id)
            report = sales_target_transfer.transfer(db, actor, data, "race.csv")
            barrier.wait(timeout=10)
            try:
                return sales_target_transfer.transfer(db, actor, data, "race.csv", True, report["digest"])
            except sales_targets.SalesTargetError as exc:
                return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert "sales_target_import_conflict" in results or "sales_target_duplicate" in results
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SalesTarget)) == 2
        assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "sales_target_create")) == 2
