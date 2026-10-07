"""MR business directory. All mutations preserve User -> MRProfile lock order."""
import secrets
import time
import uuid
from contextlib import contextmanager
from datetime import timedelta

from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import hash_password, utcnow
from app.bootstrap import SUPER_ADMIN_EMAIL
from app.db.models import User, MRProfile, AuditEvent
from app.db.mr_models import MRDirectory, AccountIdentifierReservation
from app.db.headquarter_models import Headquarter
from app.db.zone_models import Zone
from app.db.designation_models import Designation
from app.repositories.sessions import revoke_user_sessions
from app.schemas.mrs import MRFields
from app.services.auth import revalidate_identity
from app.services.zones import label


class MRError(Exception):
    def __init__(self, message="MR persistence is unavailable. Preserve your draft and retry later.",
                 status=503, code="mr_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        # No application transaction may run indefinitely waiting for another writer.
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
        db.execute(text("SET LOCAL statement_timeout = '10s'"))
        return work()
    except IntegrityError:
        db.rollback()
        raise MRError("An account identifier, employee code or relationship conflicts with current records. Review before retrying.",
                      409, "mr_conflict") from None
    except SQLAlchemyError:
        db.rollback()
        raise MRError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor, provision=False, lock=True):
    current = revalidate_identity(db, actor, lock=lock)
    if (not current.user.is_protected_system_admin or "admin.access" not in current.permissions
            or (provision and "domain.provision" not in current.permissions)):
        raise MRError("Access denied", 403, "access_denied")
    return current


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id,
                      action="mr_directory_" + operation, resource_type="mr", resource_id=row.id,
                      outcome="success", request_id=db.info.get("request_id")))


def literal(value):
    return value.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def predicates(query="", status="all", zone_id=None, hq_id=None):
    clauses = [MRDirectory.deleted_at.is_(None)]
    if query.strip():
        pattern = "%" + literal(query) + "%"
        clauses.append(or_(*[field.ilike(pattern, escape="\\") for field in (
            MRDirectory.name, MRDirectory.employeeCode, MRDirectory.email, MRDirectory.phone,
            MRDirectory.designation, MRDirectory.city,
        )], MRDirectory.id.in_(select(MRProfile.id).join(User, User.id == MRProfile.user_id).where(
            User.username.ilike(pattern, escape="\\")))))
    if status != "all":
        clauses.append(MRDirectory.status == status)
    if zone_id:
        clauses.append(MRDirectory.zoneId == zone_id)
    if hq_id:
        clauses.append(MRDirectory.hq == hq_id)
    return clauses


def projection(db, row):
    profile = db.get(MRProfile, row.id)
    user = db.get(User, profile.user_id)
    hq, zone = db.get(Headquarter, row.hq), db.get(Zone, row.zoneId)
    manager = db.get(MRDirectory, row.reportingManagerId) if row.reportingManagerId else None
    warnings = []
    for title, assignment in (("Headquarter", hq), ("Zone", zone), ("Reporting manager", manager)):
        if assignment is None:
            continue
        if assignment.deleted_at:
            warnings.append(f"{title} was deleted. Explicitly replace it before saving.")
        elif assignment.status == "inactive":
            warnings.append(f"{title} is inactive. You may retain the saved assignment.")
    values = {key: getattr(row, key) for key in MRFields.model_fields if key != "userId"}
    return dict(**values, userId=user.username, id=row.id, version=row.version,
                hqName=hq.name, zoneName=zone.name,
                reportingManagerName=manager.name if manager else "", assignmentWarnings=warnings,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def listing(db, actor, query="", status="all", zone_id=None, hq_id=None, limit=10, offset=0):
    def work():
        authorize(db, actor, lock=False)
        total = db.scalar(select(func.count()).select_from(MRDirectory).where(MRDirectory.deleted_at.is_(None)))
        clauses = predicates(query, status, zone_id, hq_id)
        filtered = db.scalar(select(func.count()).select_from(MRDirectory).where(*clauses))
        rows = db.scalars(select(MRDirectory).where(*clauses).order_by(
            MRDirectory.created_at.desc(), MRDirectory.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered, limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id, lock=False):
    query = select(MRDirectory).where(MRDirectory.id == record_id, MRDirectory.deleted_at.is_(None)).execution_options(populate_existing=True)
    row = db.scalar(query.with_for_update() if lock else query)
    if not row:
        raise MRError("MR not found or deleted. Review the current directory.", 404, "not_found")
    return row


def detail(db, actor, record_id):
    def work():
        authorize(db, actor, lock=False)
        result = projection(db, find(db, record_id))
        db.commit()
        return result
    return transaction(db, work)


def resolve_account(db, actor, username):
    """Exact authoritative reconciliation after uncertain account-producing writes."""
    def work():
        authorize(db, actor, lock=False)
        row = db.scalar(select(MRDirectory).join(MRProfile, MRProfile.id == MRDirectory.id)
                        .join(User, User.id == MRProfile.user_id).where(
                            func.lower(User.username) == username.strip().lower(), MRDirectory.deleted_at.is_(None)))
        if row is None:
            raise MRError("No live MR directory account has this username.", 404, "not_found")
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)


def references(db, actor, kind, query, limit, offset, include_saved=None):
    def work():
        authorize(db, actor, lock=False)
        model = {"zones": Zone, "headquarters": Headquarter, "managers": MRDirectory, "designations": Designation}[kind]
        # All nondeleted entries paginate explicitly; inactive entries are visible,
        # but the assignment validator permits only new active relationships.
        clauses = [model.deleted_at.is_(None)]
        if query.strip():
            clauses.append(model.name.ilike("%" + literal(query) + "%", escape="\\"))
        total = db.scalar(select(func.count()).select_from(model).where(*clauses))
        choices = list(db.scalars(select(model).where(*clauses).order_by(func.lower(model.name), model.id).limit(limit).offset(offset)))
        saved = db.get(model, include_saved) if include_saved else None
        if saved and all(row.id != saved.id for row in choices):
            choices.append(saved)
        result = dict(items=[dict(id=row.id, name=row.name, status=row.status, deleted=bool(row.deleted_at))
                             for row in choices], total=total, limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def username(db, actor):
    def work():
        authorize(db, actor, provision=True, lock=False)
        for _ in range(8):
            candidate = "mr." + secrets.token_hex(8)
            if not db.get(AccountIdentifierReservation, candidate):
                break
        else:
            raise MRError("No available username could be generated. Try again.", 503, "mr_unavailable")
        db.commit()
        return {"userId": candidate}
    return transaction(db, work)


def graph_lock(db):
    db.execute(text("SELECT pg_advisory_xact_lock(73182452)"))


def validate_assignments(db, body, existing=None, batch=None):
    for field, model, title in (("hq", Headquarter, "Headquarter"), ("zoneId", Zone, "Zone")):
        target = db.get(model, getattr(body, field))
        if not target or target.deleted_at:
            raise MRError(f"{title} is missing or deleted. Set up an active {title.lower()} and explicitly select it.", 409, "mr_assignment")
        if target.status != "active" and (existing is None or getattr(existing, field) != target.id):
            raise MRError(f"New {title.lower()} assignments must be active.", 409, "mr_assignment")
    if body.reportingManagerId:
        manager = (batch or {}).get(body.reportingManagerId) or db.get(MRDirectory, body.reportingManagerId)
        if not manager or getattr(manager, "deleted_at", None):
            raise MRError("Reporting manager is missing or deleted. Reassign to a saved server MR.", 409, "mr_assignment")
        if manager.status != "active" and (existing is None or existing.reportingManagerId != body.reportingManagerId):
            raise MRError("New reporting managers must be active.", 409, "mr_assignment")
        seen = {existing.id} if existing is not None else set()
        cursor = body.reportingManagerId
        while cursor:
            if cursor in seen:
                raise MRError("Reporting manager assignments cannot contain cycles.", 409, "mr_manager_cycle")
            seen.add(cursor)
            entry = (batch or {}).get(cursor) or db.get(MRDirectory, cursor)
            if entry is None or getattr(entry, "deleted_at", None):
                raise MRError("Reporting manager chain is unavailable.", 409, "mr_assignment")
            cursor = entry.reportingManagerId


def identifiers_available(db, body, exclude_user=None, exclude_record=None):
    values = [body.userId, body.email] if body.email else [body.userId]
    if SUPER_ADMIN_EMAIL in values or body.userId in ("admin", "superadmin", "super-admin", "administrator", "root"):
        raise MRError("This identifier is reserved.", 409, "mr_identifier_reserved")
    clauses = [or_(func.lower(User.username).in_(values), func.lower(User.email).in_(values))]
    if exclude_user:
        clauses.append(User.id != exclude_user)
    if db.scalar(select(User.id).where(*clauses)):
        raise MRError("Username or email is reserved by another account, including deleted identities.", 409, "mr_identifier_reserved")
    reserved = db.execute(text(
        "SELECT 1 FROM account_identifier_reservations WHERE identifier = ANY(:identifiers) "
        "AND (CAST(:owner AS uuid) IS NULL OR user_id <> CAST(:owner AS uuid)) LIMIT 1"
    ), {"identifiers": values, "owner": str(exclude_user) if exclude_user else None}).first()
    if reserved:
        raise MRError("This identifier belongs to protected account history. Choose another identifier.",
                      409, "mr_identifier_reserved")
    query = select(MRDirectory.id).where(func.lower(MRDirectory.employeeCode) == body.employeeCode.lower())
    if exclude_record:
        query = query.where(MRDirectory.id != exclude_record)
    if db.scalar(query):
        raise MRError("Employee code is already reserved. Choose a different code.", 409, "mr_employee_duplicate")


@contextmanager
def hash_slot(db, actor):
    """Two global hashing slots; no User/profile/relationship locks during Argon2."""
    def reserve():
        current = authorize(db, actor, provision=True)
        count = db.scalar(select(func.count()).select_from(AuditEvent).where(
            AuditEvent.actor_id == current.user.id, AuditEvent.action == "mr_hash_budget",
            AuditEvent.created_at > utcnow() - timedelta(hours=1)))
        if count >= 10:
            raise MRError("MR credential budget reached. Retry after an hour.", 429, "mr_hash_rate")
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id, action="mr_hash_budget",
                          resource_type="mr", outcome="success", request_id=db.info.get("request_id")))
        db.commit()
    transaction(db, reserve)
    # Dedicated connection holds only a session advisory lease, not a row transaction.
    connection = db.get_bind().engine.connect()
    slot = None
    try:
        for key in (73182453, 73182454):
            if connection.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": key}):
                slot = key
                break
        connection.commit()
        if slot is None:
            raise MRError("Credential processing is busy. Retry later.", 429, "mr_hash_busy")
        yield
    finally:
        if slot is not None:
            connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": slot})
            connection.commit()
        connection.close()


def prepare_passwords(db, actor, passwords):
    result, start = [], time.monotonic()
    with hash_slot(db, actor):
        for supplied in passwords:
            if time.monotonic() - start > 120:
                raise MRError("Credential processing exceeded 120 seconds. Split the file into smaller batches; nothing was imported.",
                              408, "mr_hash_timeout")
            secret = supplied if supplied is not None else secrets.token_urlsafe(32)
            result.append((secret, hash_password(secret)))
    return result


def insert(db, actor, body, prepared, profile_id=None):
    active = body.status == "active"
    user = User(email=body.email or None, username=body.userId, password_hash=prepared[1],
                system_role="mr", is_active=active, identity_version=1, token_version=0)
    db.add(user)
    db.flush()
    profile = MRProfile(id=profile_id or uuid.uuid4(), user_id=user.id, is_active=active)
    db.add(profile)
    db.flush()
    values = body.model_dump(exclude={"userId", "initialPassword", "expected_version"})
    now = utcnow()
    row = MRDirectory(id=profile.id, **values, created_by=actor.user.id, updated_by=actor.user.id,
                      created_at=now, updated_at=now, version=1)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    # Fail fast before expensive hashing, then revalidate all conflicts afterwards.
    def preflight():
        authorize(db, actor, provision=True)
        validate_assignments(db, body)
        identifiers_available(db, body)
        db.commit()
    transaction(db, preflight)
    prepared = prepare_passwords(db, actor, [body.initialPassword])[0]
    def work():
        current = authorize(db, actor, provision=True)
        graph_lock(db)
        validate_assignments(db, body)
        identifiers_available(db, body)
        row = insert(db, current, body, prepared)
        result = dict(record=projection(db, row), credentials=dict(userId=body.userId, password=prepared[0]))
        db.commit()
        return result
    return transaction(db, work)


def mutate(db, actor, record_id, body, operation):
    if operation == "reset":
        def preflight():
            authorize(db, actor, provision=True)
            row = find(db, record_id)
            if row.version != body.expected_version:
                raise MRError("MR changed. Review before resetting.", 409, "mr_stale")
            db.commit()
        transaction(db, preflight)
    prepared = prepare_passwords(db, actor, [None])[0] if operation == "reset" else None
    def work():
        current = authorize(db, actor, provision=operation == "reset")
        graph_lock(db)
        snapshot = find(db, record_id)
        profile = db.get(MRProfile, snapshot.id)
        user = db.scalar(select(User).where(User.id == profile.user_id).execution_options(populate_existing=True).with_for_update())
        profile = db.scalar(select(MRProfile).where(MRProfile.id == snapshot.id).execution_options(populate_existing=True).with_for_update())
        row = find(db, record_id, lock=True)
        if row.version != body.expected_version:
            raise MRError("MR changed. Your draft was not saved. Review the latest version before retrying.", 409, "mr_stale")
        revoke = False
        now = utcnow()
        if operation == "edit":
            validate_assignments(db, body, row)
            identifiers_available(db, body, user.id, row.id)
            revoke = user.username != body.userId or (user.email or "") != body.email or row.status != body.status
            for key, value in body.model_dump(exclude={"expected_version", "userId"}).items():
                setattr(row, key, value)
            user.username, user.email = body.userId, body.email or None
        elif operation == "status":
            revoke = row.status != body.status
            row.status = body.status
        elif operation == "contact":
            if body.contactRequirement == "required" and (not row.phone or not row.email):
                raise MRError("Edit the MR to add valid phone and email before requiring both.", 422, "mr_contact_required")
            row.contactRequirement = body.contactRequirement
        elif operation == "delete":
            if db.scalar(select(MRDirectory.id).where(MRDirectory.reportingManagerId == row.id, MRDirectory.deleted_at.is_(None))):
                raise MRError("Another live MR uses this reporting manager. Reassign those MRs before deletion.", 409, "mr_manager_in_use")
            row.deleted_at, row.deleted_by = now, current.user.id
            row.status = "inactive"
            revoke = True
        elif operation == "reset":
            user.password_hash = prepared[1]
            revoke = True
        else:
            raise MRError("Unsupported operation", 422, "invalid_request")
        user.is_active = profile.is_active = row.status == "active" and row.deleted_at is None
        if revoke:
            user.token_version += 1
            user.identity_version += 1
            revoke_user_sessions(db, user.id, "password_change" if operation == "reset" else "identity_change",
                                 db.info.get("request_id"))
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        if prepared:
            result = dict(record=result, credentials=dict(userId=user.username, password=prepared[0]))
        db.commit()
        return result
    return transaction(db, work)
