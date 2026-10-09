from decimal import Decimal
from datetime import datetime, timezone
from sqlalchemy import case, func, select, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import aliased
from app.core.security import utcnow
from app.db.models import AuditEvent, User
from app.db.sales_target_models import SalesTarget
from app.db.mr_models import MRDirectory
from app.db.zone_models import Zone
from app.db.headquarter_models import Headquarter
from app.services.auth import revalidate_identity
from app.services.zones import label
from app.schemas.sales_targets import BUSINESS_FIELDS, QUARTERS


class SalesTargetError(Exception):
    def __init__(self, message="Sales target persistence is unavailable. Your draft is preserved; retry later.",
                 status=503, code="sales_target_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint == "uq_sales_target_live_period":
            raise SalesTargetError("This MR already has a non-deleted target for this financial year, including inactive targets.",
                                   409, "sales_target_duplicate") from None
        raise SalesTargetError() from None
    except SQLAlchemyError:
        db.rollback()
        raise SalesTargetError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor):
    current = revalidate_identity(db, actor, lock=True)
    if not current.user.is_protected_system_admin or current.role != "super_admin" or "admin.access" not in current.permissions:
        raise SalesTargetError("Access denied", 403, "access_denied")
    return current


def literal(value):
    return " ".join(value.split()).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def reference(db, mr_id, lock=False):
    query = select(MRDirectory).where(MRDirectory.id == mr_id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    mr = db.scalar(query)
    if not mr or mr.deleted_at:
        raise SalesTargetError("MR is missing or deleted. Choose a saved server MR.", 409, "sales_target_reference")
    # Hold all relationships through commit so concurrent soft deletion/changes cannot invalidate a save.
    related = []
    for model, record_id, title in ((Zone, mr.zoneId, "Zone"), (Headquarter, mr.hq, "Headquarter")):
        query = select(model).where(model.id == record_id).execution_options(populate_existing=True)
        if lock:
            query = query.with_for_update()
        row = db.scalar(query)
        if not row or row.deleted_at:
            raise SalesTargetError(f"MR's {title} is missing or deleted. Repair the server MR reference first.",
                                   409, "sales_target_reference")
        related.append(row)
    return mr, *related


def projection(db, row, related=None):
    if related is None:
        # Single-record mutation/detail paths retain their existing locks.
        mr = db.get(MRDirectory, row.mrId)
        zone, hq = db.get(Zone, mr.zoneId), db.get(Headquarter, mr.hq)
        related = dict(mrName=mr.name, employeeCode=mr.employeeCode, zoneId=mr.zoneId,
                       zoneName=zone.name, headquarterId=mr.hq, headquarterName=hq.name,
                       createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by))
    fields = {field: getattr(row, field) for field in BUSINESS_FIELDS}
    fields.update({key: format(getattr(row, key), ".2f") for key in QUARTERS})
    return dict(id=row.id, **fields, version=row.version, **related,
                annualTotal=format(sum(getattr(row, key) for key in QUARTERS), ".2f"),
                createdAt=row.created_at, updatedAt=row.updated_at)


def projections(db, query):
    """Resolve display-only references in one bounded query, not per target.

    No live-reference predicates: soft-deleted MR/zone/HQ history is still visible.
    Select only actor protection flags, never credentials or private staff fields.
    Authorization remains the caller's protected-singleton check.
    """
    creator, updater = aliased(User), aliased(User)
    query = query.add_columns(
        MRDirectory.name.label("mrName"), MRDirectory.employeeCode.label("employeeCode"),
        MRDirectory.zoneId.label("zoneId"), Zone.name.label("zoneName"),
        MRDirectory.hq.label("headquarterId"), Headquarter.name.label("headquarterName"),
        case((creator.is_protected_system_admin.is_(True), "Super Admin"),
             else_="Backend user").label("createdBy"),
        case((updater.is_protected_system_admin.is_(True), "Super Admin"),
             else_="Backend user").label("updatedBy"),
    ).join(MRDirectory, MRDirectory.id == SalesTarget.mrId).join(
        Zone, Zone.id == MRDirectory.zoneId).join(Headquarter, Headquarter.id == MRDirectory.hq
    ).outerjoin(creator, creator.id == SalesTarget.created_by).outerjoin(
        updater, updater.id == SalesTarget.updated_by)
    result = []
    for values in db.execute(query).mappings():
        related = dict(values)
        row = related.pop("SalesTarget")
        result.append(projection(db, row, related))
    return result


def predicates(query="", status="all", zoneId=None, mrId=None, startYear=None, endYear=None):
    filters = [SalesTarget.deleted_at.is_(None)]
    if query.strip():
        filters.append(SalesTarget.mrId.in_(select(MRDirectory.id).where(
            MRDirectory.name.ilike("%" + literal(query) + "%", escape="\\"))))
    if status != "all":
        filters.append(SalesTarget.status == status)
    if zoneId:
        filters.append(SalesTarget.mrId.in_(select(MRDirectory.id).where(MRDirectory.zoneId == zoneId)))
    for key, value in (("mrId", mrId), ("startYear", startYear), ("endYear", endYear)):
        if value is not None:
            filters.append(getattr(SalesTarget, key) == value)
    return filters


def listing(db, actor, filters, limit, offset):
    def work():
        authorize(db, actor)
        clauses = predicates(**filters)
        sums = db.execute(select(*(func.coalesce(func.sum(getattr(SalesTarget, key)), 0)
                                   for key in QUARTERS)).where(*clauses)).one()
        totals = {key: format(Decimal(value), ".2f") for key, value in zip(QUARTERS, sums)}
        totals["total"] = format(sum(Decimal(value) for value in sums), ".2f")
        rows = projections(db, select(SalesTarget).where(*clauses).order_by(
            SalesTarget.created_at.desc(), SalesTarget.id.desc()).limit(limit).offset(offset))
        result = dict(items=rows,
                      total=db.scalar(select(func.count()).select_from(SalesTarget).where(SalesTarget.deleted_at.is_(None))),
                      filtered=db.scalar(select(func.count()).select_from(SalesTarget).where(*clauses)),
                      limit=limit, offset=offset, totals=totals)
        db.commit()
        return result
    return transaction(db, work)


def choices(db, actor, query, zoneId, limit, offset, zoneQuery, zoneOffset):
    def work():
        authorize(db, actor)
        filters = [MRDirectory.deleted_at.is_(None),
                   MRDirectory.zoneId.in_(select(Zone.id).where(Zone.deleted_at.is_(None))),
                   MRDirectory.hq.in_(select(Headquarter.id).where(Headquarter.deleted_at.is_(None)))]
        if query.strip():
            filters.append(or_(MRDirectory.name.ilike("%" + literal(query) + "%", escape="\\"),
                               MRDirectory.employeeCode.ilike("%" + literal(query) + "%", escape="\\")))
        if zoneId:
            filters.append(MRDirectory.zoneId == zoneId)
        mrs = list(db.scalars(select(MRDirectory).where(*filters).order_by(
            func.lower(MRDirectory.name), MRDirectory.id).limit(limit).offset(offset)))
        zone_filters = [Zone.deleted_at.is_(None)]
        if zoneQuery.strip():
            zone_filters.append(Zone.name.ilike("%" + literal(zoneQuery) + "%", escape="\\"))
        zones = db.scalars(select(Zone).where(*zone_filters).order_by(func.lower(Zone.name), Zone.id).limit(100).offset(zoneOffset))
        now = datetime.now(timezone.utc)
        base = now.year - (now.month < 4)
        years = set(range(base - 5, base + 7))
        years.update(db.scalars(select(SalesTarget.startYear).where(SalesTarget.deleted_at.is_(None)).distinct()))
        years.update(db.scalars(select(SalesTarget.endYear).where(SalesTarget.deleted_at.is_(None)).distinct()))
        result = dict(mrs=[dict(id=mr.id, name=mr.name, employeeCode=mr.employeeCode, zoneId=mr.zoneId,
                                zoneName=db.get(Zone, mr.zoneId).name, headquarterId=mr.hq,
                                headquarterName=db.get(Headquarter, mr.hq).name) for mr in mrs],
                      zones=[dict(id=z.id, name=z.name) for z in zones], years=sorted(years, reverse=True),
                      total=db.scalar(select(func.count()).select_from(MRDirectory).where(*filters)),
                      limit=limit, offset=offset,
                      zonesTotal=db.scalar(select(func.count()).select_from(Zone).where(*zone_filters)), zoneOffset=zoneOffset)
        db.commit()
        return result
    return transaction(db, work)


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="sales_target_" + operation,
                      resource_type="sales_target", resource_id=row.id, outcome="success",
                      request_id=db.info.get("request_id")))


def insert(db, actor, body):
    reference(db, body.mrId, lock=True)
    now = utcnow()
    fields = {field: getattr(body, field) for field in BUSINESS_FIELDS}
    fields.update({key: Decimal(fields[key]) for key in QUARTERS})
    row = SalesTarget(**fields, created_by=actor.user.id, updated_by=actor.user.id, created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    def work():
        current = authorize(db, actor)
        result = projection(db, insert(db, current, body))
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id):
    row = db.scalar(select(SalesTarget).where(SalesTarget.id == record_id, SalesTarget.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if not row:
        raise SalesTargetError("Sales target not found. It may have been deleted.", 404, "not_found")
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
        current = authorize(db, actor)
        row = find(db, record_id)
        if row.version != body.expected_version:
            raise SalesTargetError("Sales target changed. Your draft is not saved. Reload current details or discard explicitly.",
                                   409, "sales_target_stale")
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            reference(db, body.mrId if operation == "edit" else row.mrId, lock=True)
            row.status = body.status
            if operation == "edit":
                for field in BUSINESS_FIELDS:
                    value = getattr(body, field)
                    setattr(row, field, Decimal(value) if field in QUARTERS else value)
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
