"""Singleton-only Doctor directory. Reuse MR's graph lock and identity boundary."""
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.doctor_models import DoctorDirectory as Doctor
from app.db.mr_models import MRDirectory
from app.db.zone_models import Zone
from app.db.models import AuditEvent
from app.schemas.doctors import DoctorFields
from app.services import mrs
from app.services.zones import label


class DoctorError(mrs.MRError):
    def __init__(self, message="Doctor service is unavailable. Preserve your draft and retry later.", status=503, code="doctor_unavailable"):
        super().__init__(message, status, code)


def authorize(db, actor, action=None, lock=True):
    from app.services.master_policy import authorize_master
    return authorize_master(db, actor, "doctor", action, lock=lock, error=DoctorError)


def transaction(db, work):
    try:
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
        db.execute(text("SET LOCAL statement_timeout = '10s'"))
        return work()
    except IntegrityError:
        db.rollback()
        raise DoctorError("Registration number or assignment conflicts with saved records. Review before retrying.", 409, "doctor_conflict") from None
    except SQLAlchemyError:
        db.rollback()
        raise DoctorError() from None
    except Exception:
        db.rollback()
        raise


def assignment(db, mr_id, existing=None):
    # MR writers hold this same graph lock. Lock the Zone too so its lifecycle
    # cannot change between validation and commit.
    mr = db.get(MRDirectory, mr_id)
    zone = db.scalar(select(Zone).where(Zone.id == mr.zoneId).with_for_update()) if mr else None
    if not mr or mr.deleted_at or not zone or zone.deleted_at:
        raise DoctorError("Assigned MR or Zone is missing/deleted. Explicitly select an active server MR with a usable Zone.", 409, "doctor_assignment")
    if (mr.status != "active" or zone.status != "active") and (existing is None or existing.mrId != mr_id):
        raise DoctorError("New assignments require an active MR and active Zone.", 409, "doctor_assignment")
    return mr, zone


def assignment_warnings(mr, zone):
    warnings = []
    if not mr or mr.deleted_at:
        warnings.append("Missing/deleted MR. Reassign explicitly.")
    elif mr.status != "active":
        warnings.append("MR is inactive; the unchanged assignment may be retained.")
    if mr and not mr.deleted_at and (not zone or zone.deleted_at):
        warnings.append("Missing/deleted Zone. Correct the MR assignment.")
    elif zone and zone.status != "active":
        warnings.append("Zone is inactive; the unchanged assignment may be retained.")
    return warnings


def projection(db, row):
    mr = db.get(MRDirectory, row.mrId)
    zone = db.get(Zone, mr.zoneId) if mr and not mr.deleted_at else None
    warnings = assignment_warnings(mr, zone)
    return dict(**{key: getattr(row, key) for key in DoctorFields.model_fields},
                id=row.id, version=row.version, verification=row.verification,
                mrName=mr.name if mr and not mr.deleted_at else "",
                zoneId=zone.id if zone and not zone.deleted_at else None,
                 zoneName=zone.name if zone and not zone.deleted_at else "",
                assignmentWarnings=warnings, createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def predicates(query="", status="all", zone_id="", mr_id="", state=""):
    clauses = []
    live_mrs = select(MRDirectory.id).where(MRDirectory.deleted_at.is_(None))
    usable_zone_mrs = live_mrs.where(MRDirectory.zoneId.in_(select(Zone.id).where(Zone.deleted_at.is_(None))))
    if query.strip():
        pattern = "%" + mrs.literal(query) + "%"
        clauses.append(or_(*[getattr(Doctor, key).ilike(pattern, escape="\\") for key in (
            "name", "phone", "alternatePhone", "email", "registrationNumber", "qualification", "clinicName")],
            Doctor.mrId.in_(live_mrs.where(MRDirectory.name.ilike(pattern, escape="\\")))))
    if status != "all":
        clauses.append(Doctor.status == status)
    if mr_id:
        clauses.append(Doctor.mrId.not_in(live_mrs) if mr_id == "missing" else Doctor.mrId == mr_id)
    if zone_id:
        clauses.append(Doctor.mrId.not_in(usable_zone_mrs) if zone_id == "missing"
                       else Doctor.mrId.in_(usable_zone_mrs.where(MRDirectory.zoneId == zone_id)))
    if state:
        clauses.append(Doctor.state == state)
    return clauses


def listing(db, actor, query="", status="all", zone_id="", mr_id="", state="", limit=10, offset=0):
    def work():
        authorize(db, actor, lock=False)
        clauses = predicates(query, status, zone_id, mr_id, state)
        total = db.scalar(select(func.count()).select_from(Doctor))
        filtered = db.scalar(select(func.count()).select_from(Doctor).where(*clauses))
        rows = db.scalars(select(Doctor).where(*clauses).order_by(Doctor.created_at.desc(), Doctor.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered, limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id, lock=False):
    query = select(Doctor).where(Doctor.id == record_id).execution_options(populate_existing=True)
    row = db.scalar(query.with_for_update() if lock else query)
    if not row:
        raise DoctorError("Doctor not found. Return to the directory or refresh.", 404, "not_found")
    return row


def detail(db, actor, record_id):
    def work():
        authorize(db, actor, lock=False)
        result = projection(db, find(db, record_id))
        db.commit()
        return result
    return transaction(db, work)


def choices(db, actor, query="", limit=100, offset=0, include_saved=None):
    def work():
        authorize(db, actor, lock=False)
        clauses = [MRDirectory.deleted_at.is_(None)]
        if query:
            clauses.append(MRDirectory.name.ilike("%" + mrs.literal(query) + "%", escape="\\"))
        total = db.scalar(select(func.count()).select_from(MRDirectory).where(*clauses))
        rows = list(db.scalars(select(MRDirectory).where(*clauses).order_by(func.lower(MRDirectory.name), MRDirectory.id).limit(limit).offset(offset)))
        saved = db.get(MRDirectory, include_saved) if include_saved else None
        if saved and saved not in rows:
            rows.append(saved)
        items = []
        for row in rows:
            zone = db.get(Zone, row.zoneId)
            items.append(dict(id=row.id, name=row.name, status=row.status, deleted=bool(row.deleted_at),
                              zoneId=zone.id if zone and not zone.deleted_at else None,
                              zoneName=zone.name if zone and not zone.deleted_at else "",
                               zoneStatus=zone.status if zone and not zone.deleted_at else None,
                              usable=not row.deleted_at and row.status == "active" and bool(zone and not zone.deleted_at and zone.status == "active")))
        db.commit()
        return dict(items=items, total=total, limit=limit, offset=offset)
    return transaction(db, work)


def filters(db, actor):
    def work():
        authorize(db, actor, lock=False)
        result = dict(states=list(db.scalars(select(Doctor.state).distinct().order_by(Doctor.state))),
                      missingMR=bool(db.scalar(select(Doctor.id).where(*predicates(mr_id="missing")).limit(1))),
                      missingZone=bool(db.scalar(select(Doctor.id).where(*predicates(zone_id="missing")).limit(1))))
        db.commit()
        return result
    return transaction(db, work)


def unique(db, registration, except_id=None):
    query = select(Doctor.id).where(func.lower(func.btrim(Doctor.registrationNumber)) == registration.strip().lower())
    if except_id:
        query = query.where(Doctor.id != except_id)
    if db.scalar(query):
        raise DoctorError("Registration number already belongs to another doctor.", 409, "doctor_registration_duplicate")


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id,
                      action="doctor_directory_" + operation, resource_type="doctor", resource_id=row.id,
                      outcome="success", request_id=db.info.get("request_id")))


def insert(db, actor, body, verification="unverified"):
    now = utcnow()
    row = Doctor(**body.model_dump(), verification=verification, version=1,
                 created_by=actor.user.id, updated_by=actor.user.id, created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    def work():
        current = authorize(db, actor, "add")
        mrs.graph_lock(db)
        assignment(db, body.mrId)
        unique(db, body.registrationNumber)
        result = projection(db, insert(db, current, body))
        db.commit()
        return result
    return transaction(db, work)


def mutate(db, actor, record_id, body, operation):
    def work():
        current = authorize(db, actor, "delete" if operation == "delete" else "edit")
        mrs.graph_lock(db)
        row = find(db, record_id, True)
        if row.version != body.expected_version:
            raise DoctorError("Doctor changed. Your draft was not saved. Refresh to review the latest version.", 409, "doctor_stale")
        if operation == "edit":
            assignment(db, body.mrId, row)
            unique(db, body.registrationNumber, row.id)
            if body.mrId != row.mrId:
                from app.services.patients import shift_doctors
                shift_doctors(db, current, [(row, body.mrId)])
            for key, value in body.model_dump(exclude={"expected_version"}).items():
                setattr(row, key, value)
        elif operation == "status":
            row.status = body.status
        elif operation == "contact":
            if body.contactRequirement == "required" and (not row.phone or not row.email):
                raise DoctorError("Add valid phone and email in Edit before making both required.", 422, "doctor_contact_required")
            row.contactRequirement = body.contactRequirement
        row.version += 1
        row.updated_at, row.updated_by = utcnow(), current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)


def bulk(db, actor, body):
    def work():
        current = authorize(db, actor, "edit")
        mrs.graph_lock(db)
        rows = []
        for selected in sorted(body.selected, key=lambda item: str(item.id)):
            row = find(db, selected.id, True)
            if row.version != selected.expected_version:
                raise DoctorError("A selected doctor changed. Nothing was saved. Refresh and select again.", 409, "doctor_stale")
            assignment(db, body.mrId if body.operation == "shift" else row.mrId,
                       None if body.operation == "shift" else row)
            rows.append(row)
        now = utcnow()
        if body.operation == "shift":
            from app.services.patients import shift_doctors
            shift_doctors(db, current, [(row, body.mrId) for row in rows])
        for row in rows:
            if body.operation == "shift":
                row.mrId = body.mrId
            else:
                row.verification = body.verification
            row.version += 1
            row.updated_at, row.updated_by = now, current.user.id
            audit(db, current, row, body.operation)
        db.flush()
        result = [projection(db, row) for row in rows]
        db.commit()
        return result
    return transaction(db, work)
