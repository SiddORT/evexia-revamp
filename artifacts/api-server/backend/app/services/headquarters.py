import re
from sqlalchemy import func, select, or_, Text, cast
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.headquarter_models import Headquarter, HeadquarterArea, normalized_name
from app.db.zone_models import Zone
from app.schemas.headquarters import abbreviation
from app.services.zones import label
from app.services.master_policy import authorize_master


class HeadquarterError(Exception):
    def __init__(self, message="Headquarter persistence is unavailable. Your draft is preserved; retry later.",
                 status=503, code="headquarter_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_headquarter_live_name":
            raise HeadquarterError("A non-deleted headquarter already uses this name. Review current records.",
                                   409, "headquarter_duplicate") from None
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) in ("uq_hq_area_live_name", "uq_hq_area_live_code"):
            raise HeadquarterError("Area names and codes must be unique within this headquarter (ignoring case).",
                                   422, "headquarter_area_duplicate") from None
        raise HeadquarterError() from None
    except SQLAlchemyError:
        db.rollback()
        raise HeadquarterError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor, action=None):
    return authorize_master(db, actor, "headquarter", action, error=HeadquarterError)


def projection(db, row):
    zone = db.get(Zone, row.zone_id) if row.zone_id else None
    areas = list(db.scalars(select(HeadquarterArea).where(
        HeadquarterArea.headquarter_id == row.id, HeadquarterArea.deleted_at.is_(None))
        .order_by(HeadquarterArea.position, HeadquarterArea.id)))
    return dict(id=row.id, name=row.name, state_code=row.state_code, status=row.status, version=row.version,
                zone_id=row.zone_id, zone=None if zone is None else dict(
                    id=zone.id, name=zone.name, status=zone.status, deleted=zone.deleted_at is not None),
                areas=[dict(id=area.id, name=area.name, code=area.code, sequence=area.sequence) for area in areas],
                area_count=len(areas), next_area_sequence=row.next_area_sequence,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def zone_choices(db, actor, query, limit, offset):
    def work():
        authorize(db, actor)
        filters = [Zone.deleted_at.is_(None), Zone.status == "active"]
        term = " ".join(query.split()).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        if term:
            filters.append(Zone.name.ilike("%" + term + "%", escape="\\"))
        total = db.scalar(select(func.count()).select_from(Zone).where(*filters))
        rows = db.scalars(select(Zone).where(*filters).order_by(func.lower(Zone.name), Zone.id)
                          .limit(limit).offset(offset))
        result = dict(items=[dict(id=r.id, name=r.name) for r in rows], total=total, limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def assign_zone(db, row, zone_id):
    # Serialize selection against Zone edits/deletion; unchanged historical links
    # remain readable/retainable but cannot be newly selected.
    zone = db.scalar(select(Zone).where(Zone.id == zone_id).with_for_update())
    if zone is None or (zone_id != row.zone_id and (zone.deleted_at is not None or zone.status != "active")):
        raise HeadquarterError("Select a saved active Zone. The selected Zone is unavailable.", 422, "headquarter_zone_invalid")
    row.zone_id = zone_id


def comparison_keys(db, values):
    return list(db.scalars(select(normalized_name(func.unnest(cast(values, ARRAY(Text)))))))


def plan_areas(db, row, inputs, existing=(), historical_codes=()):
    """Read-only validation/allocation shared by live writes and transfer review."""
    if len(inputs) > 200:
        raise HeadquarterError("At most 200 areas are allowed per headquarter.", 422, "headquarter_area_invalid")
    by_id = {area.id: area for area in existing}
    ids = [area.id for area in inputs if area.id is not None]
    if len(ids) != len(set(ids)) or any(area_id not in by_id for area_id in ids):
        raise HeadquarterError("An area identity is repeated or no longer belongs to the current headquarter. Review current areas.",
                               409, "headquarter_stale")
    names = comparison_keys(db, [area.name for area in inputs])
    if len(names) != len(set(names)):
        raise HeadquarterError("Area names must be unique within this headquarter (ignoring case).", 422, "headquarter_area_duplicate")
    next_sequence = row.next_area_sequence
    explicit = [area.code for area in inputs if area.code is not None]
    # Manual codes reserve numeric suffixes too; this high-water mark survives
    # later removals and prefix edits and never renumbers other areas.
    pattern = re.compile(re.escape(row.state_code) + r"([0-9]+)\Z")
    for code in explicit:
        match = pattern.fullmatch(code)
        if match:
            suffix = int(match.group(1))
            if suffix <= 2147483646:
                next_sequence = max(next_sequence, suffix + 1)
    code_keys = comparison_keys(db, explicit)
    if len(code_keys) != len(set(code_keys)):
        raise HeadquarterError("Area codes must be unique within this headquarter (ignoring case).", 422, "headquarter_area_duplicate")
    # Include retained removals when allocating suggestions, including codes
    # entered manually under an earlier prefix.
    used = set(comparison_keys(db, list(historical_codes) + explicit))
    planned = []
    for position, body in enumerate(inputs):
        area = by_id.get(body.id)
        if area is not None and body.code is None:
            raise HeadquarterError(f"Area {position + 1}: supply the saved code explicitly.", 422, "headquarter_area_invalid")
        sequence = area.sequence if area else None
        code = body.code
        if code is None:
            while next_sequence <= 2147483646:
                code = f"{row.state_code}{next_sequence}"
                key = comparison_keys(db, [code])[0]
                sequence = next_sequence
                next_sequence += 1
                if key not in used:
                    used.add(key)
                    break
            else:
                raise HeadquarterError("Area numbering is exhausted; use a manual area code.", 422, "headquarter_area_sequence")
        planned.append((area, body, code, sequence, position))
    return planned, next_sequence


def save_areas(db, actor, row, inputs):
    existing = list(db.scalars(select(HeadquarterArea).where(
        HeadquarterArea.headquarter_id == row.id, HeadquarterArea.deleted_at.is_(None)).with_for_update()))
    historical_codes = list(db.scalars(select(HeadquarterArea.code).where(HeadquarterArea.headquarter_id == row.id)))
    planned, next_sequence = plan_areas(db, row, inputs, existing, historical_codes)
    now = utcnow()
    # Temporarily release partial unique indexes inside this transaction so
    # name/code swaps are atomic too. Removed rows retain these tombstones.
    for area in existing:
        area.deleted_at, area.deleted_by = now, actor.user.id
        area.updated_at, area.updated_by = now, actor.user.id
    db.flush()
    for area, body, code, sequence, position in planned:
        if area is None:
            area = HeadquarterArea(headquarter_id=row.id, created_by=actor.user.id, created_at=now)
            db.add(area)
        area.name, area.code, area.sequence, area.position = body.name, code, sequence, position
        area.updated_at, area.updated_by = now, actor.user.id
        area.deleted_at = area.deleted_by = None
    row.next_area_sequence = next_sequence
    db.flush()


def predicates(query="", status="all"):
    result = [Headquarter.deleted_at.is_(None)]
    term = " ".join(query.split())
    if term:
        term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        result.append(or_(Headquarter.name.ilike("%" + term + "%", escape="\\"),
                          Headquarter.state_code.ilike("%" + term + "%", escape="\\")))
    if status != "all":
        result.append(Headquarter.status == status)
    return result


def listing(db, actor, query, status, limit, offset):
    def work():
        authorize(db, actor)
        total = db.scalar(select(func.count()).select_from(Headquarter).where(Headquarter.deleted_at.is_(None)))
        filters = predicates(query, status)
        filtered = db.scalar(select(func.count()).select_from(Headquarter).where(*filters))
        rows = db.scalars(select(Headquarter).where(*filters).order_by(
            Headquarter.created_at.desc(), Headquarter.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered,
                      limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="headquarter_" + operation,
                      resource_type="headquarter", resource_id=row.id, outcome="success",
                      request_id=db.info.get("request_id")))


def insert(db, actor, body):
    now = utcnow()
    row = Headquarter(name=body.name, state_code=body.state_code or abbreviation(body.name), status=body.status,
                      zone_id=None, next_area_sequence=1,
                      created_by=actor.user.id, updated_by=actor.user.id, created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    def work():
        current = authorize(db, actor, "add")
        row = insert(db, current, body)
        assign_zone(db, row, body.zone_id)
        save_areas(db, current, row, body.areas)
        # Counter/link autoflushes must not replace creation's update timestamp
        # with the transaction-start timestamp (which can precede created_at).
        row.updated_at = row.created_at
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id):
    row = db.scalar(select(Headquarter).where(Headquarter.id == record_id, Headquarter.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if not row:
        raise HeadquarterError("Headquarter not found. It may have been deleted.", 404, "not_found")
    return row


def detail(db, actor, record_id):
    def work():
        authorize(db, actor)
        result = projection(db, find(db, record_id))
        db.commit()
        return result
    return transaction(db, work)


def mutate(db, actor, record_id, body, operation):
    def work():
        current = authorize(db, actor, "delete" if operation == "delete" else "edit")
        row = find(db, record_id)
        if row.version != body.expected_version:
            raise HeadquarterError("Headquarter changed. Your draft is not saved. Review current details before retrying.",
                                   409, "headquarter_stale")
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            row.status = body.status
            if operation == "edit":
                assign_zone(db, row, body.zone_id)
                row.name = body.name
                if body.state_code is not None:
                    row.state_code = body.state_code
                save_areas(db, current, row, body.areas)
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
