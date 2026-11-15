"""Explicit responsibility, never an authorization or historical backfill rule."""
import uuid
from sqlalchemy import and_, or_, select, func, false
from app.db.mr_models import MRDirectory as MR
from app.db.zone_models import Zone
from app.db.headquarter_models import Headquarter as HQ, HeadquarterArea as Area


def fail(message):
    from app.services.mrs import MRError
    raise MRError(message, 409, "mr_assignment")


def mr_scope(db, body, existing=None):
    """Omitted additive fields preserve saved scope; null is legacy, not broad."""
    scope = body.coverageScope if "coverageScope" in body.model_fields_set else getattr(existing, "coverageScope", None)
    hqs = body.hqIds if body.hqIds is not None else list(getattr(existing, "hqIds", None) or [])
    areas = body.areaIds if body.areaIds is not None else list(getattr(existing, "areaIds", None) or [])
    if scope is None:
        if hqs or areas:
            fail("Review and adopt an explicit coverage scope before selecting HQs or Areas.")
        if existing and getattr(existing, "coverageScope", None):
            fail("An adopted territory cannot be reverted to legacy coverage.")
        return None, [], []
    from app.services.mrs import zone_members
    zones = body.zoneIds if body.zoneIds is not None else (
        [m.zone_id for m in zone_members(db, [existing])[existing.id]] if existing else [body.zoneId])
    if zones != [body.zoneId]:
        fail("Explicit responsibility requires exactly one Zone. Review legacy Zones before adoption.")
    if len(set(hqs)) != len(hqs) or len(set(areas)) != len(areas):
        fail("HQ and Area selections must be distinct.")
    if scope != ("area" if areas else "hq" if hqs else "zone"):
        fail("Coverage scope must agree with the deliberately selected HQs and Areas.")
    if areas and not hqs:
        fail("Areas require selected parent HQs.")
    # Shared parent locks serialize catalogue edits and retain exact identities.
    parents = list(db.scalars(select(HQ).where(HQ.id.in_(hqs)).order_by(HQ.id)
                             .execution_options(populate_existing=True).with_for_update(read=True)))
    retained = set(getattr(existing, "hqIds", None) or [])
    if len(parents) != len(hqs) or any(p.zone_id != body.zoneId or p.deleted_at or
            (p.status != "active" and p.id not in retained) for p in parents):
        fail("Select saved HQs in the selected Zone. New HQs must be active.")
    children = list(db.scalars(select(Area).where(Area.id.in_(areas)).order_by(Area.id)
                              .execution_options(populate_existing=True).with_for_update(read=True)))
    if len(children) != len(areas) or any(a.headquarter_id not in hqs or a.deleted_at for a in children):
        fail("Select saved Areas within the selected HQs.")
    return scope, hqs, areas


def location(db, zone_id, hq_id, area_id, *, lock=False):
    if not all((zone_id, hq_id, area_id)):
        return False
    statement = select(Area.id).join(HQ, HQ.id == Area.headquarter_id).join(Zone, Zone.id == HQ.zone_id).where(
        Zone.id == zone_id, HQ.id == hq_id, Area.id == area_id,
        Zone.deleted_at.is_(None), Zone.status == "active",
        HQ.deleted_at.is_(None), HQ.status == "active", Area.deleted_at.is_(None))
    return bool(db.scalar(statement.with_for_update(read=True) if lock else statement))


def eligibility(zone_id, hq_id, area_id):
    if not all((zone_id, hq_id, area_id)):
        return false()
    return and_(MR.deleted_at.is_(None), MR.status == "active", MR.zoneId == zone_id,
                or_(MR.coverageScope == "zone",
                    and_(MR.coverageScope == "hq", MR.hqIds.any(hq_id)),
                    and_(MR.coverageScope == "area", MR.hqIds.any(hq_id), MR.areaIds.any(area_id))))


def validate_doctor(db, body, existing=None, *, mr_id=None, legacy_import=False):
    mr_id = mr_id or body.mrId
    fields = ("zoneId", "hqId", "areaId")
    values = tuple(getattr(body, k, None) for k in fields)
    if existing and existing.mrId == mr_id and values == tuple(getattr(existing, k) for k in fields):
        return  # Historical incompatibilities remain readable and unchanged.
    if legacy_import and not any(values):
        return  # Explicit historical schema, never adopted responsibility.
    if not location(db, *values, lock=True):
        fail("Doctor assignment requires one active Zone, its HQ and one saved Area.")
    if not db.scalar(select(MR.id).where(MR.id == mr_id, eligibility(*values))):
        fail("The selected active MR does not cover this exact Doctor location. Review the assignment.")


def labels(db, model, ids):
    keys = list(ids or [])
    rows = {}
    for start in range(0, len(keys), 500):
        rows.update((row.id, row) for row in db.scalars(select(model).where(model.id.in_(keys[start:start + 500]))))
    return [dict(id=key, name=rows[key].name if key in rows else str(key),
                 headquarterId=rows[key].headquarter_id if model is Area and key in rows else None,
                 status=getattr(rows.get(key), "status", "active"), deleted=key not in rows or bool(rows[key].deleted_at))
            for key in keys]


def choices(db, kind, zone_id, hq_ids, query, limit, offset, include_saved=None):
    try:
        ids = list(dict.fromkeys(uuid.UUID(k) for k in hq_ids.split(",") if k))
    except ValueError:
        fail("Choose valid saved parent HQs.")
    if len(ids) > 1000:
        fail("Select at most 1,000 parent HQs.")
    model = {"zones": Zone, "headquarters": HQ, "areas": Area}[kind]
    clauses = [model.deleted_at.is_(None)]
    if kind == "headquarters":
        clauses += [HQ.zone_id == zone_id if zone_id else false()]
    elif kind == "areas":
        clauses += [Area.headquarter_id.in_(select(HQ.id).where(
            HQ.id.in_(ids), HQ.zone_id == zone_id, HQ.deleted_at.is_(None))) if ids and zone_id else false()]
    if query.strip():
        term = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses.append(model.name.ilike("%" + term + "%", escape="\\"))
    total = db.scalar(select(func.count()).select_from(model).where(*clauses))
    rows = list(db.scalars(select(model).where(*clauses).order_by(func.lower(model.name), model.id).limit(limit).offset(offset)))
    # Saved hydration never bypasses parent scope or lifecycle rules.
    if include_saved:
        saved = db.scalar(select(model).where(*clauses, model.id == include_saved))
        if saved and all(r.id != saved.id for r in rows):
            rows.append(saved)
    return dict(items=[dict(id=r.id, name=r.name, status=getattr(r, "status", "active"), deleted=False,
                            headquarterId=r.headquarter_id if kind == "areas" else None) for r in rows],
                total=total, limit=limit, offset=offset)
