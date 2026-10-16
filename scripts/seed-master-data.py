"""Trusted local development operator command; never expose as an API/startup hook.

Uses existing business validators, enrollment, encryption and per-record audits.
No web login is fabricated or reused. The existing protected administrator is
the explicit ownership/attribution anchor, NOT a claimed authenticated session.
The additional operator event and request marker distinguish these seed writes.
"""
import argparse
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
import json
from pathlib import Path
import secrets
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "artifacts/api-server/backend"))

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import AuditEvent, MRProfile, Patient, User
from app.db.session import session_factory
from app.db.zone_models import Zone
from app.db.location_models import StorageLocation
from app.db.product_category_models import ProductCategory
from app.db.allergen_models import AllergenProduct
from app.db.headquarter_models import Headquarter
from app.db.designation_models import Designation
from app.db.mr_models import MRDirectory
from app.db.doctor_models import DoctorDirectory as Doctor
from app.db.patient_models import PatientDirectory
from app.schemas.zones import ZoneFields
from app.schemas.locations import LocationFields
from app.schemas.product_categories import ProductCategoryFields
from app.schemas.allergens import AllergenFields
from app.schemas.headquarters import HeadquarterFields
from app.schemas.designations import DesignationFields
from app.schemas.mrs import MRCreate
from app.schemas.doctors import DoctorFields
from app.schemas.patients import PatientFields
from app.services import zones, locations, product_categories, allergens, headquarters, designations, mrs, doctors, patients
from app.services import account_crypto, directory_runtime
from app.services.zone_policy import lock_policy
import master_demo_data as fixtures

FINGERPRINT_SQL = """
SELECT md5(current_database() || ':' ||
 (SELECT oid::text FROM pg_database WHERE datname=current_database()) || ':' ||
 (SELECT id::text FROM users WHERE is_protected_system_admin))
"""
CATALOGUE = {
    "zones": (Zone, ZoneFields, zones),
    "locations": (StorageLocation, LocationFields, locations),
    "categories": (ProductCategory, ProductCategoryFields, product_categories),
    "headquarters": (Headquarter, HeadquarterFields, headquarters),
    "designations": (Designation, DesignationFields, designations),
}
DIRECTORIES = {"mrs": MRDirectory, "doctors": Doctor, "patients": PatientDirectory}
MARKER = "development-master-demo-seed"


class Blocked(Exception):
    pass


@dataclass(frozen=True)
class OperatorOwnership:
    """Ownership context for internal enrollment, not an auth.Identity/session."""
    user: User
    session_id: None = None
    role: str = "super_admin"
    permissions: frozenset = frozenset({"admin.access", "domain.provision"})
    staff: None = None


def normalize(value):
    return " ".join(value.split()).lower()


def same(actual, expected):
    if isinstance(actual, Decimal):
        return actual == Decimal(expected)
    return actual == expected


def require_matching(row, body, extra=None):
    if row.deleted_at or row.status != "active":
        raise Blocked("A matching demo record is deleted or inactive; nothing will be restored or changed.")
    values = body.model_dump(exclude={"initialPassword", "userId"})
    values.update(extra or {})
    if any(not same(getattr(row, field), value) for field, value in values.items()):
        raise Blocked("A matching demo record has different saved values; review it manually. No overwrite is allowed.")


def candidates(db, model, name):
    column = model.name
    normalized = func.lower(func.btrim(func.regexp_replace(column, r"\s+", " ", "g")))
    rows = list(db.scalars(select(model).where(normalized == normalize(name)).limit(2)))
    if len(rows) > 1:
        raise Blocked("Multiple records match a demo name, including deleted history.")
    return rows[0] if rows else None


class Seed:
    def __init__(self, db, actor):
        self.db, self.actor = db, actor
        self.counts = defaultdict(lambda: {"inserted": 0, "skipped": 0})
        self.saved = []
        # Encrypted names are not SQL-searchable. Bound all history scans and
        # refuse rather than silently miss a collision outside the first page.
        self.names = {}
        for kind, model in DIRECTORIES.items():
            rows = list(db.scalars(select(model).order_by(model.id).limit(10001)))
            if len(rows) > 10000:
                raise Blocked("Directory exceeds the 10,000-record safe seed preflight bound.")
            index = defaultdict(list)
            for row in rows:
                index[normalize(row.name)].append(row)
            self.names[kind] = index

    def remember(self, kind, row, body, created, extra=None):
        self.counts[kind]["inserted" if created else "skipped"] += 1
        self.saved.append((kind, type(row), row.id, body, extra))
        return row

    def catalogue(self, kind, values):
        model, schema, service = CATALOGUE[kind]
        body = schema(**values)
        row = candidates(self.db, model, body.name)
        created = row is None
        if row:
            require_matching(row, body)
        else:
            row = service.insert(self.db, self.actor, body)
        return self.remember(kind, row, body, created)

    def directory_match(self, kind, body, identifier, column):
        named = self.names[kind].get(normalize(body.name), [])
        keyed = list(self.db.scalars(select(DIRECTORIES[kind]).where(column == identifier).limit(2)))
        if len(named) > 1 or len(keyed) > 1 or ({r.id for r in named} != {r.id for r in keyed}):
            raise Blocked("A demo name or unique identifier conflicts with existing directory history.")
        return keyed[0] if keyed else None

    def run(self, prepared):
        collected = defaultdict(list)
        for kind, values in fixtures.catalogue():
            collected[kind].append(self.catalogue(kind, values))
        for values in fixtures.products(collected["categories"], collected["locations"]):
            body = AllergenFields(**values)
            row = candidates(self.db, AllergenProduct, body.name)
            created = row is None
            if row:
                require_matching(row, body, allergens.validate_references(self.db, body))
            else:
                row = allergens.insert(self.db, self.actor, body)
            self.remember("allergens", row, body, created, allergens.validate_references(self.db, body))
        for index, values in enumerate(fixtures.representatives(
                collected["zones"], collected["headquarters"], collected["designations"][0])):
            body = MRCreate(**values)
            row = self.directory_match("mrs", body, body.employeeCode, MRDirectory.employeeCode)
            created = row is None
            mrs.validate_assignments(self.db, body)
            if row:
                require_matching(row, body)
                profile = self.db.get(MRProfile, row.id)
                user = self.db.get(User, profile.user_id) if profile else None
                if (not profile or not profile.is_active or not user or not user.is_active
                        or user.system_role != "mr" or user.is_protected_system_admin
                        or user.username != body.userId or user.email != body.email):
                    raise Blocked("Existing demo MR account linkage differs; no identity will be changed.")
                mrs.identifiers_available(self.db, body, exclude_user=user.id, exclude_record=row.id)
            else:
                mrs.identifiers_available(self.db, body)
                row = mrs.insert(self.db, self.actor, body, prepared[index])
            collected["mrs"].append(self.remember("mrs", row, body, created))
        for values in fixtures.physicians(collected["mrs"]):
            body = DoctorFields(**values)
            row = self.directory_match("doctors", body, body.registrationNumber, Doctor.registrationNumber)
            created = row is None
            doctors.assignment(self.db, body.mrId)
            if row:
                require_matching(row, body)
            else:
                doctors.unique(self.db, body.registrationNumber)
                row = doctors.insert(self.db, self.actor, body)
            collected["doctors"].append(self.remember("doctors", row, body, created))
        for code, values in fixtures.patients(collected["doctors"]):
            body = PatientFields(**values)
            row = self.directory_match("patients", body, code, PatientDirectory.code)
            created = row is None
            if row:
                require_matching(row, body, {"code": code})
                owner = self.db.get(Patient, row.id)
                doctor = self.db.get(Doctor, body.doctorId)
                if not owner or not owner.is_active or owner.assigned_mr_id != doctor.mrId:
                    raise Blocked("Existing demo patient ownership differs; no ownership will be changed.")
                patients.unique(self.db, body, code, except_id=row.id)
            else:
                patients.unique(self.db, body, code)
                row = patients.insert(self.db, self.actor, body, code)
            self.remember("patients", row, body, created, {"code": code})
        return dict(self.counts)


def main():
    parser = argparse.ArgumentParser(description="Seed only fictional development masters; never migrates or resets.")
    parser.add_argument("--development-database-fingerprint", required=True,
                        help="Fingerprint confirmed separately against the intended development database.")
    args = parser.parse_args()
    if get_settings().app_env != "development":
        raise Blocked("APP_ENV is not development.")
    factory = session_factory()
    with factory() as db:
        if db.scalar(text(FINGERPRINT_SQL)) != args.development_database_fingerprint:
            raise Blocked("Database fingerprint differs from the confirmed development target.")
        revisions = list(db.scalars(text("SELECT version_num FROM alembic_version")))
        if revisions not in (["0037_domain_admission"], ["0038_purchase_orders"]):
            raise Blocked("Master schema is not a supported ready revision; no migrations will be run.")
        # Check the complete installed mapped shape without selecting any rows.
        for model in (*[v[0] for v in CATALOGUE.values()], *DIRECTORIES.values(), AllergenProduct, MRProfile, Patient):
            db.execute(select(model).limit(0))
        admins = list(db.scalars(select(User).where(User.is_protected_system_admin.is_(True))))
        if len(admins) != 1 or not admins[0].is_active or admins[0].system_role != "super_admin":
            raise Blocked("Exactly one existing active protected administrator is required.")
        account_crypto.ready(db)
        directory_runtime.ready(db)
    # Random initial credentials are never printed, stored in files or reset on
    # rerun. Admin's existing MR reset action can issue credentials if needed.
    prepared = []
    for _ in range(3):
        secret = secrets.token_urlsafe(32)
        prepared.append((secret, hash_password(secret)))
    with factory() as db, db.begin():
        db.info["request_id"] = MARKER
        db.execute(text("SET LOCAL lock_timeout='5s'"))
        db.execute(text("SET LOCAL statement_timeout='10s'"))
        lock_policy(db)
        admin = db.scalar(select(User).where(User.is_protected_system_admin.is_(True)).with_for_update())
        if (not admin or not admin.is_active or admin.system_role != "super_admin"
                or db.scalar(text(FINGERPRINT_SQL)) != args.development_database_fingerprint):
            raise Blocked("Development ownership anchor changed during preflight.")
        account_crypto.ready(db)
        directory_runtime.ready(db)
        mrs.graph_lock(db)
        # Block concurrent directory/catalogue writers during name/identifier
        # preflight and insertion; normal reads continue. Lock timeout rolls back.
        db.execute(text("LOCK TABLE zones,storage_locations,product_categories,allergen_products,"
                        "headquarters,designations,mr_directory,doctor_directory,patient_directory,"
                        "users,mr_profiles,patients,account_identifier_reservations IN SHARE ROW EXCLUSIVE MODE"))
        seed = Seed(db, OperatorOwnership(admin))
        counts = seed.run(prepared)
        if any(value["inserted"] for value in counts.values()):
            db.add(AuditEvent(actor_id=None, action="operator_master_demo_seed",
                              resource_type="development_masters", outcome="success", request_id=MARKER))
        db.flush()
    # Independent, bounded persistence reads, not tests or browser automation.
    # After commit any failure explicitly reports that rows may already exist.
    try:
        with factory() as db:
            account_crypto.ready(db)
            directory_runtime.ready(db)
            for _, model, record_id, body, extra in seed.saved:
                row = db.get(model, record_id)
                if row is None:
                    raise Blocked("A committed master record could not be read.")
                require_matching(row, body, extra)
            print(json.dumps({"target": "confirmed development database", "prefix": fixtures.PREFIX,
                              "persisted_records": len(seed.saved), "counts": counts}, indent=2))
    except Exception:
        raise Blocked("Seed transaction committed, but persistence confirmation failed. Rerun safely; do not reset.") from None
    print("Rerun: python scripts/seed-master-data.py --development-database-fingerprint "
          + args.development_database_fingerprint)
    print("No tests, builds, migrations, purchases or stock writes were run.")


if __name__ == "__main__":
    try:
        main()
    except Blocked as exc:
        print("BLOCKED: " + str(exc), file=sys.stderr)
        sys.exit(1)
    except IntegrityError as exc:
        diagnostic = getattr(exc.orig, "diag", None)
        # Names only, never DETAIL (which can contain row values or secrets).
        print("BLOCKED: database integrity constraint: "
              + str(getattr(diagnostic, "constraint_name", None))
              + "; table: " + str(getattr(diagnostic, "table_name", None))
              + ". Seed transaction rolled back.", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        # Do not leak driver/validation exceptions containing submitted fields,
        # SQL parameters, credentials or ciphertext.
        print(f"BLOCKED: {type(exc).__name__}; seed did not finish. "
              "Any uncommitted seed writes were rolled back. Details suppressed.", file=sys.stderr)
        sys.exit(1)
