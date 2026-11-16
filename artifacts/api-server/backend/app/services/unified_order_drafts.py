"""Read-only, bounded projection of existing private entries and SPT Drafts.

No full snapshots, attachments, contacts or prices leave this boundary.
Search decrypts at most SCAN_LIMIT candidates; an empty scanned section
is not evidence that subsequent sections contain no matches.
"""
import base64
import hashlib
import json
import time
import uuid
from datetime import datetime, time as day_time
from zoneinfo import ZoneInfo

from sqlalchemy import func, literal, select, tuple_, union_all

from app.db.order_draft_models import OrderDraft
from app.db.spt_models import SptOrder
from app.services import order_drafts, spt
from app.services.capability_policy import allowed, readable
from app.services.directory_runtime import crypto_scope
from app.services.immunotherapy import ImmError
from app.services.mr_orders import authorize, scope, scope_identity

PRIVATE_KINDS = ("immunotherapy", "kits", "lupin")
KINDS = (*PRIVATE_KINDS, "spt")
SCAN_LIMIT = 100
KOLKATA = ZoneInfo("Asia/Kolkata")


def permitted(actor):
    return [kind for kind in KINDS if actor.role == "mr"
            or (readable(actor, kind) if kind == "spt" else allowed(actor, kind, "add"))]


def text_value(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def private_summary(keys, row, actor):
    # Use the existing privacy projection, then whitelist summary fields.
    payload = order_drafts.project(keys, row, actor)["payload"]
    values = payload["values"]
    selected = lambda field, label: f"{label} selected; name not saved" if values.get(field) else None
    details = []
    if row.kind == "kits":
        kit = values.get("kit", {})
        for key, label in (("product", "Kit"), ("custom", "Configuration"),
                           ("volume", "Entered volume (ml)"), ("quantity", "Entered kit quantity")):
            if text_value(kit.get(key)):
                details.append(f"{label}: {kit[key]}")
        for key, label in (("lancets", "Entered lancets"), ("applicators", "Entered applicators"),
                           ("tray", "Entered trays")):
            if text_value(values.get(key)):
                details.append(f"{label}: {values[key]}")
    elif row.kind == "lupin" and text_value(values.get("patientCount")):
        details.append(f'Entered patient count: {values["patientCount"]}')
    elif row.kind == "immunotherapy" and values.get("groups"):
        details.append(f'Saved allergen groups: {len(values["groups"])}')
    patient = selected("patientId", "Patient")
    if row.kind == "lupin":
        linked_names = [text_value(entry.get("name")) for entry in payload.get("linked", [])
                        if entry.get("id") in values.get("patientIds", [])]
        patient = (" · ".join(name for name in linked_names if name) or
                   ("Linked patients selected; names not saved" if values.get("patientIds") else None))
    return dict(id=str(row.id), kind=row.kind, version=row.version,
                updatedAt=row.updated_at.isoformat() if row.updated_at else None,
                identifier=None, doctor=selected("doctorId", "Doctor"), mr=selected("mrId", "MR"),
                patient=patient,
                details=" · ".join(details) or None, remarks=text_value(values.get("remarks")),
                canResume=True)


def spt_summary(keys, row, actor):
    data = spt.project(keys, row)
    names = [text_value(patient.get("name")) for patient in data.get("patients", [])]
    return dict(id=str(row.id), kind="spt", version=row.version,
                updatedAt=row.updated_at.isoformat() if row.updated_at else None,
                identifier=row.number, doctor=text_value(data.get("doctorName")),
                mr=text_value(data.get("mrName")),
                patient=" · ".join(name for name in names if name) or None,
                details=f'{len(data.get("patients", []))} saved patient entries',
                remarks=text_value(data.get("remarks")),
                canResume=bool(data["mrEditable"] and
                               (actor.role == "mr" or allowed(actor, "spt", "edit"))))


def encode_cursor(row, binding):
    value = [1, binding, row.saved.isoformat(), str(row.id), row.kind]
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode().rstrip("=")


def decode_cursor(cursor, binding):
    try:
        value = json.loads(base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True))
        if not isinstance(value, list) or len(value) != 5 or value[:2] != [1, binding] or value[4] not in KINDS:
            raise ValueError()
        saved, identity = datetime.fromisoformat(value[2]), uuid.UUID(value[3])
        if saved.tzinfo is None:
            raise ValueError()
        return saved, identity, value[4]
    except (ValueError, TypeError, OverflowError, RecursionError):
        raise ImmError("Draft section is invalid or its filters/access changed. Refresh drafts.", 422, "draft_cursor") from None


def listing(db, actor, *, kind=None, search="", from_date=None, to_date=None, cursor=None, limit=25):
    # Revalidate using an actually permitted existing workflow, never a new
    # combined permission. Recompute all sources from that current identity.
    sources = permitted(actor)
    if not sources:
        raise ImmError("Drafts are unavailable for this account.", 403, "access_denied")
    seed = sources[0]
    actor = authorize(db, actor, seed, None if seed == "spt" else "add")
    sources = permitted(actor)
    if kind:
        sources = [source for source in sources if source == kind]
        if not sources:
            raise ImmError("This draft type is unavailable for this account.", 403, "access_denied")
    if from_date and to_date and from_date > to_date:
        raise ImmError("From date must not follow To date.", 422, "draft_dates")
    needle = search.strip().casefold()
    binding = hashlib.sha256(json.dumps([
        str(actor.user.id), str(scope_identity(db)), sources, needle,
        str(from_date), str(to_date),
    ], separators=(",", ":")).encode()).hexdigest()
    selections = []
    private = [source for source in sources if source in PRIVATE_KINDS]
    if private:
        selections.append(select(
            OrderDraft.id.label("id"), OrderDraft.kind.label("kind"),
            func.coalesce(OrderDraft.updated_at, OrderDraft.created_at).label("saved"),
        ).where(OrderDraft.created_by == actor.user.id,
                OrderDraft.mr_scope == scope_identity(db),
                OrderDraft.kind.in_(private), OrderDraft.submitted_order_id.is_(None)))
    if "spt" in sources:
        selections.append(select(
            SptOrder.id.label("id"), literal("spt").label("kind"),
            func.coalesce(SptOrder.updated_at, SptOrder.created_at).label("saved"),
        ).where(SptOrder.status == "Draft", *scope(db, SptOrder)))
    candidates = union_all(*selections).subquery()
    query = select(candidates)
    if from_date:
        query = query.where(candidates.c.saved >= datetime.combine(from_date, day_time.min, KOLKATA))
    if to_date:
        query = query.where(candidates.c.saved <= datetime.combine(to_date, day_time.max, KOLKATA))
    if cursor:
        query = query.where(tuple_(candidates.c.saved, candidates.c.id, candidates.c.kind)
                            < tuple_(*decode_cursor(cursor, binding)))
    items, last, scanned, response_size = [], None, 0, 0
    started = time.monotonic()
    with crypto_scope(db) as keys:
        # crypto_scope also applies the existing statement timeout before the
        # metadata sort, not merely before decryption of the bounded page.
        candidates_page = list(db.execute(query.order_by(
            candidates.c.saved.desc(), candidates.c.id.desc(), candidates.c.kind.desc()).limit(SCAN_LIMIT + 1)))
        # Batch reads retain source authorization as well as the union's scope.
        ids = [row.id for row in candidates_page[:SCAN_LIMIT]]
        private_rows = {row.id: row for row in db.scalars(select(OrderDraft).where(
            OrderDraft.id.in_(ids), OrderDraft.created_by == actor.user.id,
            OrderDraft.mr_scope == scope_identity(db), OrderDraft.kind.in_(private),
            OrderDraft.submitted_order_id.is_(None)))} if private else {}
        spt_rows = {row.id: row for row in db.scalars(select(SptOrder).where(
            SptOrder.id.in_(ids), SptOrder.status == "Draft", *scope(db, SptOrder)))} if "spt" in sources else {}
        for candidate in candidates_page[:SCAN_LIMIT]:
            if time.monotonic() - started > 5:
                raise ImmError("Secure draft search budget exceeded. Narrow the filters and retry.", 409, "draft_bound")
            row = (spt_rows if candidate.kind == "spt" else private_rows).get(candidate.id)
            if not row or row.version < 1 or (row.updated_at or row.created_at) != candidate.saved:
                raise ImmError("Drafts changed while loading. Refresh this listing.", 409, "draft_changed")
            summary = spt_summary(keys, row, actor) if candidate.kind == "spt" else private_summary(keys, row, actor)
            scanned += 1
            last = candidate
            searchable = " ".join(str(summary[field] or "") for field in (
                "kind", "identifier", "doctor", "mr", "patient", "details", "remarks"))
            if not needle or needle in searchable.casefold():
                response_size += len(json.dumps(summary, ensure_ascii=False).encode())
                if response_size > 8_000_000:
                    raise ImmError("Draft summaries exceed the response budget. Use fewer rows or narrower filters.", 409, "draft_bound")
                items.append(summary)
                if len(items) == limit:
                    break
    more = len(candidates_page) > scanned
    return dict(items=items, nextCursor=encode_cursor(last, binding) if last and more else None,
                scanLimited=bool(more and scanned == SCAN_LIMIT and len(items) < limit), scannedCount=scanned)
