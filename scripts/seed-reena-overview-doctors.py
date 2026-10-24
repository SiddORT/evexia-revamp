#!/usr/bin/env python3
"""Targeted development Doctor-only fixtures. Never bootstrap, migrate or enroll."""
import argparse
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "artifacts/api-server/backend"))

from sqlalchemy import func, select, text
from app.core.config import get_settings
from app.db.session import session_factory
from app.db.models import AuditEvent, MRProfile, User
from app.db.doctor_models import DoctorDirectory
from app.db.mr_models import MRDirectory
from app.schemas.doctors import DoctorFields
from app.services import account_crypto, directory_runtime, doctors, mrs
from app.services.zone_policy import lock_policy

FINGERPRINT_SQL = """SELECT md5(current_database() || ':' ||
 (SELECT oid::text FROM pg_database WHERE datname=current_database()) || ':' ||
 (SELECT id::text FROM users WHERE is_protected_system_admin))"""
MARKER = "development-reena-doctor-overview-seed"


class Blocked(Exception):
    pass


@dataclass(frozen=True)
class OperatorOwnership:
    """Privileged local attribution anchor; not an authenticated web session."""
    user: User
    session_id: None = None


def fixtures(mr_id):
    for suffix, city, pin, clinic, line, days, limit in (
        ("Alpha", "Mumbai", "400001", "Harbour Sample Clinic", "11 Fictional Harbour Lane", 30, "50000.00"),
        ("Beta", "Pune", "411001", "Garden Sample Clinic", "22 Fictional Garden Avenue", 45, "125000.50"),
        ("Gamma", "Nagpur", "440001", "Central Sample Clinic", "33 Fictional Central Road", 60, "250000.00"),
        ("Delta", "Nashik", "422001", "Hill Sample Clinic", "44 Fictional Hill Street", 0, "0.00"),
    ):
        yield DoctorFields(
            name=f"Overview Demo Fictional Doctor {suffix}",
            registrationNumber=f"OVERVIEW-FICTIONAL-{suffix.upper()}",
            qualification="MBBS (fictional sample)", clinicName=f"{clinic} (Fictional)",
            email=f"overview.{suffix.lower()}@example.com", phone="", alternatePhone="",
            mrId=mr_id, daysLimit=days, paymentLimit=limit,
            addressLine1=line, addressLine2="Fictional demonstration address",
            landmark="Fictional Sample Landmark", city=city, pincode=pin,
            state="Maharashtra", country="India",
        )


def require_equal(row, body):
    if row.deleted_at or row.status != "active":
        raise Blocked("A fixture is inactive/deleted; no restore or overwrite is allowed.")
    for field, expected in body.model_dump().items():
        actual = getattr(row, field)
        if isinstance(actual, Decimal):
            expected = Decimal(expected)
        if actual != expected:
            raise Blocked("An existing fixture differs from its expected values. No records were changed.")


def identify(db, expected_id):
    rows = list(db.scalars(select(MRDirectory).limit(10001)))
    if len(rows) > 10000:
        raise Blocked("MR identification exceeds the safe 10,000-record bound.")
    matches = [row for row in rows if "reena" in row.name.strip().lower().split()]
    if len(matches) != 1 or matches[0].id != expected_id:
        raise Blocked("Reena does not have one unique matching saved MR identity.")
    row = matches[0]
    profile = db.get(MRProfile, row.id)
    user = db.get(User, profile.user_id) if profile else None
    if (row.deleted_at or row.status != "active" or not profile or not profile.is_active
            or not user or not user.is_active or user.system_role != "mr"
            or user.is_protected_system_admin
            or mrs.account_labels(db, [row.id]).get(row.id) != "MR-004"):
        raise Blocked("Reena's saved directory/profile/account linkage is not the verified active MR-004.")
    doctors.assignment(db, row.id)
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--development-database-fingerprint", required=True)
    parser.add_argument("--expected-mr-id", type=uuid.UUID, required=True)
    args = parser.parse_args()
    if get_settings().app_env != "development":
        raise Blocked("APP_ENV must be development.")
    inserted, reused = [], []
    with session_factory()() as db, db.begin():
        db.info["request_id"] = MARKER
        db.execute(text("SET LOCAL lock_timeout='5s'"))
        db.execute(text("SET LOCAL statement_timeout='10s'"))
        lock_policy(db)
        if db.scalar(text(FINGERPRINT_SQL)) != args.development_database_fingerprint:
            raise Blocked("Connection differs from the independently confirmed development database.")
        admins = list(db.scalars(select(User).where(User.is_protected_system_admin.is_(True)).with_for_update()))
        if len(admins) != 1 or not admins[0].is_active or admins[0].system_role != "super_admin":
            raise Blocked("Exactly one active protected Super Admin attribution anchor is required.")
        account_crypto.ready(db)
        directory_runtime.ready(db)
        mrs.graph_lock(db)
        # Only the identity/Doctor tables needed by this operation. Normal reads
        # continue; concurrent renumbering/assignment/Doctor writes wait briefly.
        db.execute(text("LOCK TABLE users,mr_profiles,mr_directory,doctor_directory IN SHARE ROW EXCLUSIVE MODE"))
        mr = identify(db, args.expected_mr_id)
        actor = OperatorOwnership(admins[0])
        for body in fixtures(mr.id):
            rows = list(db.scalars(select(DoctorDirectory).where(
                func.lower(func.btrim(DoctorDirectory.registrationNumber)) == body.registrationNumber.lower()).limit(2)))
            if len(rows) > 1:
                raise Blocked("Ambiguous fixture registration history.")
            if rows:
                require_equal(rows[0], body)
                reused.append(rows[0].doctorNumber)
            else:
                doctors.unique(db, body.registrationNumber)
                row = doctors.insert(db, actor, body)
                inserted.append(row.doctorNumber)
        if inserted:
            db.add(AuditEvent(actor_id=None, action="operator_reena_doctor_overview_seed",
                             resource_type="doctor", outcome="success", request_id=MARKER))
    print(f"Committed development Doctor-only seed: {len(inserted)} inserted, {len(reused)} reused.")
    print("Inserted Doctor numbers:", ", ".join(inserted) or "none")
    print("Reused Doctor numbers:", ", ".join(reused) or "none")
    # Post-commit read distinguishes a successful write from an unconfirmed one.
    try:
        with session_factory()() as db:
            db.execute(text("SET TRANSACTION READ ONLY"))
            if db.scalar(text(FINGERPRINT_SQL)) != args.development_database_fingerprint:
                raise Blocked("Post-commit target differs.")
            directory_runtime.ready(db)
            for body in fixtures(args.expected_mr_id):
                row = db.scalar(select(DoctorDirectory).where(DoctorDirectory.registrationNumber == body.registrationNumber))
                if not row:
                    raise Blocked("Fixture missing after commit.")
                require_equal(row, body)
        print("Confirmed all four fictional Doctor records and exact configured terms after commit.")
    except Exception:
        raise Blocked("Seed committed, but confirmation failed. Rerun this same targeted command; do not reset records.") from None


if __name__ == "__main__":
    try:
        main()
    except Blocked as exc:
        print(f"BLOCKED: {exc}", file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("BLOCKED: Doctor-only seed failed. No partial transaction was committed; review configuration without exposing credentials.", file=sys.stderr)
        sys.exit(2)
