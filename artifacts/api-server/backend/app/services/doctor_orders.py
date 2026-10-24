"""Bounded, read-only cross-type order rows for one currently assigned Doctor."""
import base64
import binascii
import json
import uuid
from datetime import date

from sqlalchemy import literal, select, tuple_, union_all

from app.db.immunotherapy_models import ImmunotherapyOrder
from app.db.kits_models import KitsOrder
from app.db.lupin_models import LupinOrder
from app.db.spt_models import SptOrder
from app.services import doctors, mr_orders
from app.services.order_lifecycle import status


DOMAINS = {
    "immunotherapy": ImmunotherapyOrder,
    "kits": KitsOrder,
    "spt": SptOrder,
    "lupin": LupinOrder,
}
STATUSES = {"Confirmed", "In process", "Shipped", "Delivered", "Rejected", "Returned", "Saved"}


def clauses(db, kind, model, doctor_id):
    result = [model.doctor_id == doctor_id, *mr_orders.scope(db, model)]
    if kind == "kits":
        result.append(model.order_for == "doctor")
    if kind == "spt":
        result.append(model.status != "Draft")
    return result


def invalid_cursor():
    return doctors.DoctorError("Order continuation is no longer valid. Refresh orders.", 422, "doctor_order_cursor")


def continuation(db, token, actor, doctor_id):
    """Validate scope and the saved anchor, not client-supplied ownership.

    The cursor grants no access: every branch is independently scoped. It is
    a position, not a frozen history or an assertion of full-history counts.
    """
    try:
        value = json.loads(base64.b64decode(token.encode("ascii"), altchars=b"-_", validate=True))
        if not isinstance(value, list) or len(value) != 6:
            raise ValueError()
        version, doctor, mr, saved_date, kind, identity = value
        if type(version) is not int or version != 1 or not all(
                isinstance(item, str) for item in (doctor, mr, saved_date, kind, identity)):
            raise ValueError()
        if doctor != str(doctor_id) or mr != str(actor.mr.id) or kind not in DOMAINS:
            raise ValueError()
        identity, saved_date = uuid.UUID(identity), date.fromisoformat(saved_date)
        model = DOMAINS[kind]
        anchor = db.scalar(select(model.id).where(
            *clauses(db, kind, model, doctor_id), model.id == identity, model.date == saved_date))
        if anchor is None:
            raise ValueError()
        return saved_date, kind, identity
    except (ValueError, TypeError, KeyError, UnicodeError, binascii.Error):
        raise invalid_cursor() from None


def listing(db, actor, doctor_id, limit=20, cursor=None):
    def work():
        current = mr_orders.authorize(db, actor)
        if current.role != "mr" or not current.mr:
            raise doctors.DoctorError("This order view is available only to MRs.", 403, "access_denied")
        # Shared graph lock from authorize serializes Doctor reassignment.
        doctors.find(db, doctor_id, actor=current)
        if not 1 <= limit <= 50:
            raise doctors.DoctorError("Choose an order page size from 1 to 50.", 422, "doctor_order_bound")
        position = continuation(db, cursor, current, doctor_id) if cursor else None
        branches = []
        for kind, model in DOMAINS.items():
            filters = clauses(db, kind, model, doctor_id)
            if position:
                filters.append(tuple_(model.date, literal(kind), model.id) < tuple_(*position))
            # Bound each branch as well as the merged page. No snapshot reads.
            branch = select(model.id.label("id"), model.number.label("number"),
                            model.date.label("date"), model.status.label("status"),
                            literal(kind).label("kind")).where(*filters).order_by(
                                model.date.desc(), model.id.desc()).limit(limit + 1).subquery()
            branches.append(select(branch))
        merged = union_all(*branches).subquery()
        rows = list(db.execute(select(merged).order_by(
            merged.c.date.desc(), merged.c.kind.desc(), merged.c.id.desc()).limit(limit + 1)).mappings())
        items = []
        for row in rows[:limit]:
            canonical = status(row["status"])
            if canonical not in STATUSES or not row["number"] or not row["number"].strip():
                raise doctors.DoctorError("Saved order information is unreadable. Refresh or retry later.",
                                          503, "doctor_order_unreadable")
            items.append(dict(id=row["id"], number=row["number"], date=row["date"],
                              status=canonical, kind=row["kind"]))
        next_cursor = None
        if len(rows) > limit:
            last = rows[limit - 1]
            next_cursor = base64.urlsafe_b64encode(json.dumps([
                1, str(doctor_id), str(current.mr.id), last["date"].isoformat(),
                last["kind"], str(last["id"]),
            ], separators=(",", ":")).encode()).decode()
        db.commit()
        return dict(items=items, nextCursor=next_cursor, limit=limit)
    return doctors.transaction(db, work)
