"""Singleton-only Doctor directory. Reuse MR's graph lock and identity boundary."""
from sqlalchemy import false, func, or_, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.doctor_models import DoctorDirectory as Doctor
from app.db.mr_models import MRDirectory, MRZoneAssignment
from app.db.headquarter_models import Headquarter
from app.db.zone_models import Zone
from app.db.models import AuditEvent
from app.schemas.doctors import DoctorFields
from app.services import mrs
from app.services.zones import label
from app.services import directory_runtime as encrypted


class DoctorError(mrs.MRError):
    def __init__(self, message="Doctor service is unavailable. Preserve your draft and retry later.", status=503, code="doctor_unavailable"):
        super().__init__(message, status, code)


def authorize(db, actor, action=None, lock=True):
    if actor.role == "mr":
        from app.services.auth import revalidate_identity
        from app.services.zone_policy import lock_policy
        lock_policy(db)
        current = revalidate_identity(db, actor, lock=True)
        if current.mr is None or action not in (None, "add", "import", "export"):
            raise DoctorError("Doctor operation is not available to MRs.", 403, "access_denied")
        encrypted.ready(db)
        mrs.graph_lock(db)
        assignment(db, current.mr.id)
        return current
    from app.services.master_policy import authorize_master
    current = authorize_master(db, actor, "doctor", action, lock=True, error=DoctorError)
    encrypted.ready(db)
    return current


def owned_clauses(actor):
    return [Doctor.mrId == actor.mr.id] if actor.role == "mr" else []


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


def projection(db, row, context=None):
    mr = context["mrs"].get(row.mrId) if context is not None else db.get(MRDirectory, row.mrId)
    zone = (context["zones"].get(mr.zoneId) if context is not None else db.get(Zone, mr.zoneId)) if mr and not mr.deleted_at else None
    warnings = assignment_warnings(mr, zone)
    return dict(**{key: getattr(row, key) for key in DoctorFields.model_fields},
                id=row.id, doctorNumber=row.doctorNumber, version=row.version, verification=row.verification,
                mrName=mr.name if mr and not mr.deleted_at else "",
                mrUserId=(context["mrLabels"] if context is not None else mrs.account_labels(db, [mr.id])).get(mr.id, "") if mr and not mr.deleted_at else "",
                zoneId=zone.id if zone and not zone.deleted_at else None,
                 zoneName=zone.name if zone and not zone.deleted_at else "",
                assignmentWarnings=warnings, createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def read_projection(db, actor, row, context=None):
    result = projection(db, row, context)
    if actor.role != "mr":
        return result
    from app.services.person_contacts import person
    result = person(result)
    for field, display in (("phone", "phoneDisplay"), ("alternatePhone", "alternatePhoneDisplay")):
        result[display] = result.pop(field)
    result["emailDisplay"] = result.pop("email")
    return result


def predicates(query="", status="all", zone_id="", mr_id="", state="", *, retained_assignments=False):
    # Only historical relationship queries opt in. Live masters, actions,
    # exports and assignment choices always use the tombstone-excluding default.
    clauses = [] if retained_assignments else [Doctor.deleted_at.is_(None)]
    live_mrs = select(MRDirectory.id).where(MRDirectory.deleted_at.is_(None))
    usable_zone_mrs = live_mrs.where(MRDirectory.zoneId.in_(select(Zone.id).where(Zone.deleted_at.is_(None))))
    if query.strip():
        raise DoctorError("Encrypted search requires a bounded authorized scan.")
    if status != "all":
        clauses.append(Doctor.status == status)
    if mr_id:
        clauses.append(Doctor.mrId.not_in(live_mrs) if mr_id == "missing" else Doctor.mrId == mr_id)
    if zone_id:
        clauses.append(Doctor.mrId.not_in(usable_zone_mrs) if zone_id == "missing"
                       else Doctor.mrId.in_(usable_zone_mrs.where(MRDirectory.zoneId == zone_id)))
    if state:
        clauses.append(Doctor.state_index == encrypted.crypto().doctor_state_index(state))
    return clauses


def search_matcher(db, query, rows):
    from app.services.patients import doctor_context
    context = doctor_context(db, (row.id for row in rows))
    return lambda row: encrypted.match(query, *(getattr(row, field) for field in (
        "name", "phone", "alternatePhone", "email", "doctorNumber", "registrationNumber", "qualification", "clinicName")),
        context["mrs"].get(row.mrId).name if context["mrs"].get(row.mrId) and not context["mrs"][row.mrId].deleted_at else "")


def listing(db, actor, query="", status="all", zone_id="", mr_id="", state="", limit=10, offset=0, cursor=None, headquarter_id=None):
    def work():
        current = authorize(db, actor, lock=False)
        scope = owned_clauses(current)
        # MR filters describe saved assignments, including secondary zones.
        # Keep the shared ownership predicate and writable choices unchanged.
        clauses = predicates("", status, "" if current.role == "mr" else zone_id, mr_id, state) + scope
        if current.role == "mr" and zone_id == "missing":
            clauses.append(false())  # MR filters never offer missing/other assignments.
        elif current.role == "mr" and zone_id:
            members = select(MRZoneAssignment.mr_id).join(Zone, Zone.id == MRZoneAssignment.zone_id).where(
                MRZoneAssignment.zone_id == zone_id, Zone.deleted_at.is_(None))
            clauses.append(Doctor.mrId.in_(members))
        if headquarter_id:
            assigned = select(MRDirectory.id).join(Headquarter, Headquarter.id == MRDirectory.hq).where(
                MRDirectory.deleted_at.is_(None), Headquarter.deleted_at.is_(None), MRDirectory.hq == headquarter_id)
            clauses.append(Doctor.mrId.in_(assigned))
        total = db.scalar(select(func.count()).select_from(Doctor).where(Doctor.deleted_at.is_(None), *scope))
        meta = {}
        if query.strip():
            rows, meta = encrypted.scan(db, Doctor, clauses, None, limit=limit, cursor=cursor,
                                        prepare=lambda rows: search_matcher(db, query, rows))
            filtered = None
        else:
            filtered = db.scalar(select(func.count()).select_from(Doctor).where(*clauses))
            rows = db.scalars(select(Doctor).where(*clauses).order_by(Doctor.created_at.desc(), Doctor.id.desc()).limit(limit).offset(offset))
        from app.services.patients import doctor_context
        rows = list(rows)
        context = doctor_context(db, [row.id for row in rows])
        result = dict(items=[read_projection(db, current, row, context) for row in rows], total=total, filtered=filtered, limit=limit, offset=offset, **meta)
        if current.role == "mr" and rows:
            from app.services.doctor_overview import summaries
            overview = summaries(db, current, [row.id for row in rows])
            for item, row in zip(result["items"], rows):
                item["orderSummary"] = overview[row.id]
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id, lock=False, actor=None):
    query = select(Doctor).where(Doctor.id == record_id, Doctor.deleted_at.is_(None)).execution_options(populate_existing=True)
    if actor is not None:
        query = query.where(*owned_clauses(actor))
    row = db.scalar(query.with_for_update() if lock else query)
    if not row:
        raise DoctorError("Doctor not found. Return to the directory or refresh.", 404, "not_found")
    return row


def detail(db, actor, record_id):
    def work():
        current = authorize(db, actor, lock=False)
        result = read_projection(db, current, find(db, record_id, actor=current))
        # The MR detail has its own bounded order rows; do not decrypt the
        # aggregate price history for a presentation which no longer uses it.
        db.commit()
        return result
    return transaction(db, work)


def choices(db, actor, query="", limit=100, offset=0, include_saved=None, cursor=None):
    def work():
        current = authorize(db, actor, lock=False)
        if current.role == "mr":
            mr, zone = assignment(db, current.mr.id)
            result = dict(items=[dict(id=mr.id, name=mr.name, userId=current.user.username or "",
                status=mr.status, deleted=False, zoneId=zone.id, zoneName=zone.name,
                zoneStatus=zone.status, usable=True)], total=1, limit=limit, offset=0)
            db.commit()
            return result
        clauses = [MRDirectory.deleted_at.is_(None)]
        if query:
            rows, meta = encrypted.scan(db, MRDirectory, clauses, None, limit=limit, cursor=cursor,
                prepare=lambda rows: mrs.identity_matcher(db, query, rows))
            total = None
        else:
            total = db.scalar(select(func.count()).select_from(MRDirectory).where(*clauses))
            rows = list(db.scalars(select(MRDirectory).where(*clauses).order_by(MRDirectory.id).limit(limit).offset(offset)))
            meta = {}
        saved = db.get(MRDirectory, include_saved) if include_saved else None
        if saved and saved not in rows:
            rows.append(saved)
        items = []
        labels = mrs.account_labels(db, [row.id for row in rows])
        for row in rows:
            zone = db.get(Zone, row.zoneId)
            items.append(dict(id=row.id, name=row.name, userId=labels.get(row.id, ""), status=row.status, deleted=bool(row.deleted_at),
                              zoneId=zone.id if zone and not zone.deleted_at else None,
                              zoneName=zone.name if zone and not zone.deleted_at else "",
                               zoneStatus=zone.status if zone and not zone.deleted_at else None,
                              usable=not row.deleted_at and row.status == "active" and bool(zone and not zone.deleted_at and zone.status == "active")))
        db.commit()
        return dict(items=items, total=total, limit=limit, offset=offset, **meta)
    return transaction(db, work)


def filters(db, actor):
    def work():
        current = authorize(db, actor, lock=False)
        scope = owned_clauses(current)
        state_rows = list(db.execute(select(Doctor.id, Doctor.state_ciphertext).where(Doctor.deleted_at.is_(None), *scope).limit(10001)))
        if len(state_rows) > 10000:
            raise DoctorError("Filter choices exceed 10,000 records. Narrow the directory.", 409, "doctor_filter_limit")
        zone_scope = [Zone.id.in_(select(MRZoneAssignment.zone_id).where(
            MRZoneAssignment.mr_id == current.mr.id))] if current.role == "mr" else []
        zones = list(db.scalars(select(Zone).where(Zone.deleted_at.is_(None), *zone_scope).order_by(Zone.name, Zone.id).limit(10001)))
        if len(zones) > 10000:
            raise DoctorError("Zone choices exceed the supported bound.", 409, "doctor_filter_limit")
        headquarters = []
        if current.role == "mr":
            mr = db.get(MRDirectory, current.mr.id)
            hq = db.get(Headquarter, mr.hq)
            if hq and not hq.deleted_at:
                headquarters.append(dict(id=str(hq.id), name=hq.name))
        result = dict(zones=[dict(id=str(zone.id), name=zone.name, status=zone.status) for zone in zones],
                      headquarters=headquarters,
                      states=sorted({encrypted.crypto().decrypt("doctor_directory", row.id, "state", row.state_ciphertext) for row in state_rows}),
                      missingMR=bool(db.scalar(select(Doctor.id).where(*predicates(mr_id="missing"), *scope).limit(1))),
                      missingZone=bool(db.scalar(select(Doctor.id).where(*predicates(zone_id="missing"), *scope).limit(1))))
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
    from app.services.master_numbers import allocate
    now = utcnow()
    row = Doctor(**body.model_dump(), doctorNumber=allocate(db, "doctor"), verification=verification, version=1,
                 created_by=actor.user.id, updated_by=actor.user.id, created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    def work():
        current = authorize(db, actor, "add")
        mrs.graph_lock(db)
        assigned = body.model_copy(update={"mrId": current.mr.id}) if current.role == "mr" else body
        assignment(db, assigned.mrId)
        unique(db, assigned.registrationNumber)
        result = read_projection(db, current, insert(db, current, assigned))
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
            raise DoctorError("Contact rules are fixed. Enter either a phone number or an email address in Edit Doctor.",
                              422, "doctor_contact_fixed")
        elif operation == "delete":
            row.deleted_at, row.deleted_by = utcnow(), current.user.id
        else:
            raise ValueError("Unsupported Doctor mutation")
        row.version += 1
        row.updated_at, row.updated_by = row.deleted_at if operation == "delete" else utcnow(), current.user.id
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
