"""Admin-only bounded mappings and encrypted, append-only assignment evidence."""
import unicodedata
import uuid
from sqlalchemy import func, select, text, or_
from app.core.security import utcnow
from app.db.doctor_models import DoctorDirectory as Doctor, DoctorAssignmentEvent as Event
from app.db.headquarter_models import Headquarter, HeadquarterArea as Area
from app.db.mr_models import MRDirectory as MR, MRZoneAssignment
from app.db.zone_models import Zone
from app.services import doctors, directory_runtime as encrypted, mrs


def ready(db):
    db.execute(text('SELECT "areaId","areaVersion" FROM doctor_directory LIMIT 0'))
    db.execute(text("SELECT id,doctor_id,kind,actor_id,recorded_at,payload_ciphertext FROM doctor_assignment_events LIMIT 0"))
    for name, kind in (("doctor_assignment_immutable", 27), ("doctor_assignment_no_truncate", 34)):
        if not db.scalar(text("""
            SELECT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
            WHERE t.tgrelid='doctor_assignment_events'::regclass AND t.tgname=:name
              AND t.tgenabled='O' AND t.tgtype=:kind AND p.proname='inventory_immutable'
              AND NOT t.tgisinternal)
        """), dict(name=name, kind=kind)):
            raise RuntimeError("Immutable Doctor mapping guards required")


def admin(db, actor, action=None):
    if actor.role == "mr":
        raise doctors.DoctorError("Admin Doctor mapping access required.", 403, "access_denied")
    return doctors.authorize(db, actor, action)


def reason(value):
    value = value.strip()
    if len(value) < 10 or len(value) > 1000 or len(value.split()) < 2 or any(
        unicodedata.category(c).startswith("C") for c in value
    ) or len({c.lower() for c in value if c.isalnum()}) < 4:
        raise doctors.DoctorError("Enter a meaningful reason of 10–1000 characters explaining the change.",
                                  422, "doctor_mapping_reason")
    return value


def area_snapshot(db, area_id):
    area = db.get(Area, area_id) if area_id else None
    if not area:
        return None
    hq = db.get(Headquarter, area.headquarter_id)
    return dict(id=str(area.id), name=f"{area.name} ({area.code})",
                headquarter=hq.name if hq else "Missing Headquarter")


def validate_area(db, area_id):
    if area_id is None:
        return
    # Catalogue writers lock the parent HQ; share that lock through commit.
    area = db.get(Area, area_id)
    hq = db.scalar(select(Headquarter).where(Headquarter.id == area.headquarter_id).with_for_update()) if area else None
    if area:
        db.refresh(area)
    if not area or area.deleted_at or not hq or hq.deleted_at or hq.status != "active":
        raise doctors.DoctorError("Select an available Doctor Area in an active Headquarter.", 409, "doctor_area")


def mr_snapshot(db, mr_id):
    row = db.get(MR, mr_id) if mr_id else None
    return dict(id=str(row.id), name=row.name, number=row.employeeCode) if row else None


def append(db, actor, row, kind, why, previous_mr=None, previous_area=None):
    event_id = uuid.uuid4()
    # Preserve the actual authenticated account, never a generic backend label.
    actor_name = actor.user.username or str(actor.user.id)
    if actor.staff:
        from app.services.staff_crypto import StaffCrypto
        from app.core.config import get_settings
        name = StaffCrypto(get_settings()).decrypt(actor.staff.id, "name", actor.staff.name_ciphertext)
        actor_name = f"{name} ({actor_name})"
    elif actor.mr:
        mr = db.get(MR, actor.mr.id)
        if mr:
            actor_name = f"{mr.name} ({actor_name})"
    payload = dict(doctor=dict(id=str(row.id), name=row.name, number=row.doctorNumber),
        previousMR=mr_snapshot(db, previous_mr), newMR=mr_snapshot(db, row.mrId),
        previousArea=previous_area, newArea=area_snapshot(db, row.areaId),
        actor=dict(id=str(actor.user.id), name=actor_name), reason=why)
    db.add(Event(id=event_id, doctor_id=row.id, kind=kind, actor_id=actor.user.id,
        recorded_at=utcnow(), payload_ciphertext=encrypted.crypto().encrypt_mapping(event_id, payload)))


def transfer(db, actor, rows, destination, why):
    """Caller holds graph/Doctor locks and checked all optimistic versions."""
    changed = [row for row in rows if row.mrId != destination]
    if not changed:
        return []
    why = reason(why)
    doctors.assignment(db, destination)
    from app.services.territories import validate_doctor
    for row in changed:
        validate_doctor(db, row, row, mr_id=destination)
    from app.services.patients import shift_doctors
    shift_doctors(db, actor, [(row, destination) for row in changed])
    for row in changed:
        old = row.mrId
        row.mrId = destination
        append(db, actor, row, "transfer", why, previous_mr=old,
               previous_area=area_snapshot(db, row.areaId))
    return changed


def change_area(db, actor, row, area_id, why, expected, destination=None):
    if row.areaVersion != expected:
        raise doctors.DoctorError("Doctor Area changed. Review current Area and history before saving.",
                                  409, "doctor_area_stale")
    # The merged territory feature already owns the exact Zone/HQ/Area tuple.
    # Reuse it, never add a second ambiguous Area field or grant MR coverage.
    area = db.get(Area, area_id) if area_id else None
    hq = db.get(Headquarter, area.headquarter_id) if area else None
    next_location = (hq.zone_id if hq else None, hq.id if hq else None, area_id)
    if (row.zoneId, row.hqId, row.areaId) == next_location:
        return False
    why = reason(why)
    validate_area(db, area_id)
    if area:
        from types import SimpleNamespace
        from app.services.territories import validate_doctor
        validate_doctor(db, SimpleNamespace(zoneId=hq.zone_id, hqId=hq.id, areaId=area.id,
            mrId=destination or row.mrId))
    previous = area_snapshot(db, row.areaId)
    row.zoneId, row.hqId, row.areaId = next_location
    row.areaVersion += 1
    row.updated_at, row.updated_by = utcnow(), actor.user.id
    append(db, actor, row, "area", why, previous_mr=row.mrId, previous_area=previous)
    doctors.audit(db, actor, row, "area")
    return True


def area_correction(db, actor, doctor_id, body):
    def work():
        current = admin(db, actor, "edit")
        mrs.graph_lock(db)
        row = doctors.find(db, doctor_id, True)
        change_area(db, current, row, body.areaId, body.reason, body.expected_area_version)
        db.flush()
        result = doctors.projection(db, row)
        db.commit()
        return result
    return doctors.transaction(db, work)


def history(db, actor, doctor_id, limit, offset):
    def work():
        admin(db, actor)
        # Retain history for tombstoned Doctors as well; never MR-accessible.
        if not db.get(Doctor, doctor_id):
            raise doctors.DoctorError("Doctor not found.", 404, "not_found")
        clauses = [Event.doctor_id == doctor_id]
        total = db.scalar(select(func.count()).select_from(Event).where(*clauses))
        rows = db.scalars(select(Event).where(*clauses).order_by(
            Event.recorded_at.desc(), Event.id.desc()).limit(limit).offset(offset))
        result = dict(items=[dict(id=row.id, kind=row.kind, recordedAt=row.recorded_at,
            details=encrypted.crypto().decrypt_mapping(row.id, row.payload_ciphertext)) for row in rows],
            total=total, limit=limit, offset=offset)
        db.commit()
        return result
    return doctors.transaction(db, work)


def listing(db, actor, *, area_id="", headquarter_id=None, zone_id=None, status="all",
            mr_id=None, doctor_id=None, limit=20, offset=0):
    def work():
        admin(db, actor)
        clauses = doctors.predicates(status=status, mr_id=mr_id)
        if area_id:
            clauses.append(Doctor.areaId.is_(None) if area_id == "unset" else Doctor.areaId == area_id)
        if doctor_id:
            clauses.append(Doctor.id == doctor_id)
        if headquarter_id:
            clauses.append(Doctor.mrId.in_(select(MR.id).join(Headquarter, Headquarter.id == MR.hq).where(
                MR.deleted_at.is_(None), Headquarter.deleted_at.is_(None), MR.hq == headquarter_id)))
        if zone_id:
            clauses.append(Doctor.mrId.in_(select(MRZoneAssignment.mr_id).join(
                MR, MR.id == MRZoneAssignment.mr_id).join(Zone, Zone.id == MRZoneAssignment.zone_id).where(
                MR.deleted_at.is_(None), Zone.deleted_at.is_(None), MRZoneAssignment.zone_id == zone_id)))
        total = db.scalar(select(func.count()).select_from(Doctor).where(Doctor.deleted_at.is_(None)))
        filtered = db.scalar(select(func.count()).select_from(Doctor).where(*clauses))
        rows = list(db.scalars(select(Doctor).where(*clauses).order_by(
            Doctor.mrId, Doctor.id).limit(limit).offset(offset)))
        result = dict(items=[doctors.projection(db, row) for row in rows],
                      total=total, filtered=filtered, limit=limit, offset=offset)
        db.commit()
        return result
    return doctors.transaction(db, work)


def references(db, actor, kind, query, limit, offset, include_saved=None, cursor=None):
    def work():
        admin(db, actor)
        model = {"area": Area, "headquarter": Headquarter, "zone": Zone, "doctor": Doctor}[kind]
        clauses = [model.deleted_at.is_(None)]
        meta = {}
        if kind == "doctor" and query.strip():
            rows, meta = encrypted.scan(db, Doctor, clauses, None, limit=limit, cursor=cursor,
                prepare=lambda rows: doctors.search_matcher(db, query, rows))
            total = None
        else:
            if query.strip():
                escaped = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                search = [model.name.ilike(f"%{escaped}%", escape="\\")]
                if kind == "area":
                    search += [Area.code.ilike(f"%{escaped}%", escape="\\"),
                               Area.headquarter_id.in_(select(Headquarter.id).where(
                                   Headquarter.name.ilike(f"%{escaped}%", escape="\\")))]
                clauses.append(or_(*search))
            total = db.scalar(select(func.count()).select_from(model).where(*clauses))
            rows = list(db.scalars(select(model).where(*clauses).order_by(model.id).limit(limit).offset(offset)))
        if include_saved:
            saved = db.get(model, include_saved)
            if saved and all(row.id != saved.id for row in rows):
                rows.append(saved)
        items = []
        for row in rows:
            status = getattr(row, "status", "active")
            name = row.name
            if kind == "area":
                hq = db.get(Headquarter, row.headquarter_id)
                name = f"{row.name} ({row.code}) — {hq.name if hq else 'Missing HQ'}"
                status = hq.status if hq and not hq.deleted_at else "inactive"
            items.append(dict(id=row.id, name=name, userId=getattr(row, "doctorNumber", ""),
                status=status, usable=not row.deleted_at and status == "active", deleted=bool(row.deleted_at)))
        db.commit()
        return dict(items=items, total=total, limit=limit, offset=offset, **meta)
    return doctors.transaction(db, work)
