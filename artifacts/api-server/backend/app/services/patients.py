"""Protected Patient directory with shared graph and User->MR->Patient locks."""
import uuid
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import Patient, AuditEvent
from app.db.patient_models import PatientDirectory as Directory
from app.db.doctor_models import DoctorDirectory as Doctor
from app.db.mr_models import MRDirectory
from app.db.zone_models import Zone
from app.schemas.patients import PatientFields
from app.services import doctors, mrs, domain
from app.services.zones import label

class PatientError(mrs.MRError):
    def __init__(self, message="Patient service unavailable. Preserve your draft and retry later.", status=503, code="patient_unavailable"):
        super().__init__(message, status, code)


def transaction(db, work):
    try:
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
        db.execute(text("SET LOCAL statement_timeout = '10s'"))
        return work()
    except IntegrityError:
        db.rollback()
        raise PatientError("Patient code or duplicate identity conflicts with saved records. Review before retrying.", 409, "patient_conflict") from None
    except SQLAlchemyError:
        db.rollback()
        raise PatientError() from None
    except Exception:
        db.rollback()
        raise


def permission(actor, action):
    if action not in actor.permissions:
        raise PatientError("Access denied", 403, "access_denied")


def assignment(db, doctor_id, existing=None):
    doctor = db.get(Doctor, doctor_id)
    if not doctor:
        raise PatientError("Doctor missing. Select a server Doctor explicitly.", 409, "patient_assignment")
    retained = existing is not None and existing.doctorId == doctor_id
    if not retained and doctor.status != "active":
        raise PatientError("New assignments require an active Doctor.", 409, "patient_assignment")
    mr, zone = doctors.assignment(db, doctor.mrId, doctor if retained else None)
    return doctor, mr, zone


def projection(db, row):
    owner = db.get(Patient, row.id)
    doctor = db.get(Doctor, row.doctorId)
    mr = db.get(MRDirectory, doctor.mrId) if doctor else None
    zone = db.get(Zone, mr.zoneId) if mr and not mr.deleted_at else None
    warnings = doctors.projection(db, doctor)["assignmentWarnings"] if doctor else ["Missing Doctor; repair explicitly."]
    if doctor and doctor.status != "active":
        warnings = ["Doctor inactive; unchanged assignment may be retained."] + warnings
    return dict(**{key: getattr(row, key) for key in PatientFields.model_fields},
                id=row.id, code=row.code, version=owner.version,
                doctorName=doctor.name if doctor else "",
                doctorRegistrationNumber=doctor.registrationNumber if doctor else "",
                mrId=mr.id if mr and not mr.deleted_at else None, mrName=mr.name if mr and not mr.deleted_at else "",
                zoneId=zone.id if zone and not zone.deleted_at else None, zoneName=zone.name if zone and not zone.deleted_at else "",
                assignmentWarnings=warnings, createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def predicates(query="", status="all", zone_id="", mr_id=""):
    clauses = []
    if query.strip():
        pattern = "%" + mrs.literal(query) + "%"
        clauses.append(or_(Directory.name.ilike(pattern, escape="\\"), Directory.code.ilike(pattern, escape="\\")))
    if status != "all":
        clauses.append(Directory.status == status)
    for key, value in (("mr_id", mr_id), ("zone_id", zone_id)):
        if value:
            clauses.append(Directory.doctorId.in_(select(Doctor.id).where(*doctors.predicates(**{key: value}))))
    return clauses


def listing(db, actor, query="", status="all", zone_id="", mr_id="", limit=10, offset=0):
    def work():
        mrs.authorize(db, actor, lock=False)
        clauses = predicates(query, status, zone_id, mr_id)
        rows = db.scalars(select(Directory).where(*clauses).order_by(Directory.created_at.desc(), Directory.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, r) for r in rows],
                      total=db.scalar(select(func.count()).select_from(Directory)),
                      filtered=db.scalar(select(func.count()).select_from(Directory).where(*clauses)), limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id):
    row = db.get(Directory, record_id)
    if not row:
        raise PatientError("Patient record not found.", 404, "not_found")
    return row


def detail(db, actor, record_id):
    def work():
        mrs.authorize(db, actor, lock=False)
        result = projection(db, find(db, record_id))
        db.commit()
        return result
    return transaction(db, work)


def choices(db, actor, query="", limit=100, offset=0, include_saved=None):
    def work():
        mrs.authorize(db, actor, lock=False)
        clauses = [Doctor.name.ilike("%" + mrs.literal(query) + "%", escape="\\")] if query else []
        total = db.scalar(select(func.count()).select_from(Doctor).where(*clauses))
        rows = list(db.scalars(select(Doctor).where(*clauses).order_by(func.lower(Doctor.name), Doctor.id).limit(limit).offset(offset)))
        saved = db.get(Doctor, include_saved) if include_saved else None
        if saved and saved not in rows:
            rows.append(saved)
        items = []
        for row in rows:
            value = doctors.projection(db, row)
            items.append(dict(id=row.id, name=row.name, status=row.status,
                              usable=row.status == "active" and not value["assignmentWarnings"],
                              mrName=value["mrName"], zoneName=value["zoneName"]))
        db.commit()
        return dict(items=items, total=total, limit=limit, offset=offset)
    return transaction(db, work)


def unique(db, body, code=None, except_id=None):
    clauses = [func.lower(func.btrim(Directory.name)) == body.name.lower(), Directory.dialCountry == body.dialCountry,
               Directory.phone == body.phone, Directory.dateOfBirth == body.dateOfBirth]
    query = select(Directory.id).where(or_(Directory.code == code, and_(*clauses)))
    if except_id:
        query = query.where(Directory.id != except_id)
    if db.scalar(query):
        raise PatientError("Patient code or name/phone/date-of-birth combination already exists.", 409, "patient_duplicate")


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="patient_directory_" + operation,
                      resource_type="patient", resource_id=row.id, outcome="success", request_id=db.info.get("request_id")))


def insert(db, actor, body, code=None):
    permission(actor, "domain.provision")
    doctor, mr, _ = assignment(db, body.doctorId)
    domain._lock_mrs(db, {mr.id})
    owner = Patient(assigned_mr_id=mr.id, is_active=body.status == "active", version=1)
    db.add(owner)
    db.flush()
    now = utcnow()
    row = Directory(id=owner.id, code=code or "PAT-" + uuid.uuid4().hex.upper(), **body.model_dump(),
                    created_by=actor.user.id, updated_by=actor.user.id, created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    def work():
        current = mrs.authorize(db, actor)
        mrs.graph_lock(db)
        unique(db, body)
        row = insert(db, current, body)
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)


def lock_owner(db, row, target, require_target_active=False):
    snapshot = db.get(Patient, row.id)
    before = snapshot.assigned_mr_id
    domain._lock_mrs(db, {v for v in (before, target) if v}, require_active=False)
    if require_target_active:
        domain._lock_mrs(db, {target})
    owner = db.scalar(select(Patient).where(Patient.id == row.id).execution_options(populate_existing=True).with_for_update())
    if owner.assigned_mr_id != before:
        raise PatientError("Patient ownership changed. Refresh before retrying.", 409, "patient_stale")
    return owner


def mutate(db, actor, record_id, body, operation):
    def work():
        current = mrs.authorize(db, actor)
        mrs.graph_lock(db)
        row = find(db, record_id)
        if operation == "edit":
            doctor, mr, _ = assignment(db, body.doctorId, row)
            target = mr.id
            if body.doctorId != row.doctorId:
                permission(current, "domain.assign_patient")
        else:
            target = db.get(Patient, row.id).assigned_mr_id
        owner = lock_owner(db, row, target, operation == "edit" and body.doctorId != row.doctorId)
        if owner.version != body.expected_version:
            raise PatientError("Patient changed. Refresh to review before retrying.", 409, "patient_stale")
        if operation == "edit":
            unique(db, body, except_id=row.id)
            for key, value in body.model_dump(exclude={"expected_version"}).items():
                setattr(row, key, value)
            owner.assigned_mr_id = mr.id
        else:
            row.status = body.status
        owner.is_active = row.status == "active"
        owner.version += 1
        row.updated_at, row.updated_by = utcnow(), current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)


def shift_doctors(db, actor, changes):
    """Called inside Doctor transaction before assignment writes. Atomic with files."""
    ids = [row.id for row, _ in changes]
    rows = list(db.scalars(select(Directory).where(Directory.doctorId.in_(ids)).order_by(Directory.id)))
    if rows:
        permission(actor, "domain.assign_patient")
    targets = {row.id: target for row, target in changes}
    snapshots = {r.id: db.get(Patient, r.id).assigned_mr_id for r in rows}
    domain._lock_mrs(db, {v for v in list(snapshots.values()) + list(targets.values()) if v}, require_active=False)
    if rows:
        domain._lock_mrs(db, set(targets.values()))
    for row in rows:
        owner = db.scalar(select(Patient).where(Patient.id == row.id).execution_options(populate_existing=True).with_for_update())
        if owner.assigned_mr_id != snapshots[row.id]:
            raise PatientError("Patient ownership changed. Doctor shift cancelled.", 409, "patient_stale")
        if owner.assigned_mr_id != targets[row.doctorId]:
            owner.assigned_mr_id = targets[row.doctorId]
            owner.version += 1
            row.updated_at, row.updated_by = utcnow(), actor.user.id
            audit(db, actor, row, "assignment")
