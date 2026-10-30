"""Unified fulfillment over authoritative order snapshots; no financial effects."""
import uuid
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo
from sqlalchemy import select, text, func
from sqlalchemy.exc import SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.courier_models import CourierPartner
from app.services import kits, immunotherapy, lupin, spt
from app.services.immunotherapy import ImmError, encode
from app.services.directory_runtime import crypto_scope
from app.services.capability_policy import is_super_admin
from app.services.zone_policy import lock_policy
from app.services.auth import revalidate_identity
from app.schemas.shipments import ShipmentRecord, ShipmentPage

SOURCES = {"Kit": kits, "IT": immunotherapy, "Lupin": lupin, "SPT": spt}
STATUSES = ("In process", "Shipped", "Returned")
SCAN_LIMIT = 20000
EXPORT_LIMIT = 5000


def transaction(db, actor, work):
    try:
        lock_policy(db)
        from app.services.order_eligibility import lock as financial_lock
        financial_lock(db)
        current = revalidate_identity(db, actor, lock=True)
        if not is_super_admin(current):
            raise ImmError("Shipments require Super Admin access.", 403, "access_denied")
        with crypto_scope(db) as keys:
            result = work(current, keys)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise ImmError("Shipments are unavailable. Your entries are preserved; retry the same submission.",
                       503, "shipments_unavailable") from None
    except Exception:
        db.rollback()
        raise


def address_text(value):
    if isinstance(value, str):
        return value.strip() or None
    if not isinstance(value, dict):
        return None
    return ", ".join(str(value[k]) for k in
                     ("line1", "line2", "landmark", "city", "state", "pincode", "country")
                     if value.get(k)) or None


def projection(kind, row, saved):
    """Never resolve historical fields from current directory records."""
    shipping = saved.get("shipment") or {}
    recipient = saved.get("recipient")
    if not recipient and kind == "IT":
        recipient = saved.get(saved.get("shipping")) if saved.get("shipping") in {"doctor", "patient"} else None
    recipient = recipient if isinstance(recipient, dict) else {}
    price = (saved.get("pricing") or {}).get("total") if kind == "Kit" else saved.get("total")
    if kind == "IT":
        minor = saved.get("totalMinor")
        price = format(Decimal(minor) / 100, ".2f") if minor is not None else None
    # Amounts are saved exact decimal text, never recalculated using current rates.
    value = str(price) if price is not None else None
    def name(key):
        person = saved.get(key)
        return person.get("name") or None if isinstance(person, dict) else None
    # Saved patient snapshots only: never infer a Patient from a shipping
    # recipient, or replace historical identities with today's directory.
    patients = []
    single = saved.get("patient")
    people = ([single] if isinstance(single, dict) else []) + (
        saved.get("patients") if isinstance(saved.get("patients"), list) else [])
    for person in people:
        if isinstance(person, dict) and isinstance(person.get("name"), str) and person["name"].strip():
            patients.append(person["name"])
    result = dict(id=str(row.id), key=f"{kind}:{row.id}", type=kind, number=row.number,
        date=row.date.isoformat(), version=row.version, value=value,
        doctor=name("doctor"), mr=name("mr"), patients=patients, recipient=recipient.get("name") or None,
        address=address_text(recipient.get("address")),
        courier=shipping.get("courierName"), trackingId=shipping.get("trackingId"),
        expectedDeliveryDate=shipping.get("expectedDeliveryDate"),
        actualDeliveryDate=shipping.get("actualDeliveryDate"), shippedAt=shipping.get("shippedAt"),
        status="In process" if row.status == "Approved" else row.status,
        paymentStatus=getattr(row, "payment_status", None))
    return ShipmentRecord.model_validate(result).model_dump(mode="json")


def detail(db, actor, kind, identity):
    if kind not in SOURCES:
        raise ImmError("Unsupported order type.", 422, "shipment_type")
    source = SOURCES[kind]

    def work(current, keys):
        row = db.get(source.Order, identity)
        if row is None or row.status not in {*STATUSES, "Approved"}:
            raise ImmError("Saved shipment order is unavailable.", 404, "shipment_not_found")
        # Reuse the source's full saved projection, including its saved clinical,
        # billing and shipping facts. No writes or live-directory enrichment.
        order = source.project(keys, row)
        order = {key: value for key, value in order.items()
                 if key not in {"decisionEligibility", "mrEditable"}}
        return dict(record=projection(kind, row, order), order=order)

    return transaction(db, actor, work)


def listing(db, actor, *, search="", status="In process", type="All",
            from_date=None, to_date=None, offset=0, limit=25, complete=False):
    if from_date and to_date and from_date > to_date:
        raise ImmError("Order-date From must not follow To.", 422, "shipment_dates")
    def work(current, keys):
        matches, scanned = [], 0
        term = search.strip().casefold()
        for kind, service in SOURCES.items():
            if type != "All" and type != kind:
                continue
            model = service.Order
            states = [*STATUSES, "Approved"] if status == "All" else (
                ["In process", "Approved"] if status == "In process" else [status])
            conditions = [model.status.in_(states)]
            if from_date:
                conditions.append(model.date >= from_date)
            if to_date:
                conditions.append(model.date <= to_date)
            count = db.scalar(select(func.count()).select_from(model).where(*conditions))
            scanned += count
            if scanned > SCAN_LIMIT:
                raise ImmError("Shipment search exceeds 20,000 candidate orders. Narrow the order dates or type.",
                               422, "shipment_scan_limit")
            # Counts establish a hard memory/decryption bound. No silent truncation.
            rows = db.scalars(select(model).where(*conditions).order_by(model.date.desc(), model.id.desc())
                              .limit(SCAN_LIMIT + 1))
            for row in rows:
                saved = service.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
                report = projection(kind, row, saved)
                searchable = ("number", "type", "date", "doctor", "mr", "recipient", "address",
                              "courier", "trackingId", "status", "paymentStatus")
                if not term or term in " ".join(str(report[k]) for k in searchable
                                                if report[k] is not None).casefold():
                    matches.append(report)
        matches.sort(key=lambda r: (r["date"], r["type"], r["id"]), reverse=True)
        if complete and len(matches) > EXPORT_LIMIT:
            raise ImmError("Export exceeds 5,000 matching shipments. Narrow the filters; no partial file was prepared.",
                           422, "shipment_export_limit")
        size, start = (EXPORT_LIMIT, 0) if complete else (limit, offset)
        return ShipmentPage.model_validate(dict(items=matches[start:start + size], total=len(matches),
                                                offset=start, limit=size)).model_dump(mode="json")
    return transaction(db, actor, work)


def couriers(db, actor, *, search="", offset=0, limit=25):
    def work(current, keys):
        conditions = [CourierPartner.deleted_at.is_(None), CourierPartner.status == "active"]
        term = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        if term:
            conditions.append(CourierPartner.name.ilike(f"%{term}%", escape="\\"))
        total = db.scalar(select(func.count()).select_from(CourierPartner).where(*conditions))
        rows = db.scalars(select(CourierPartner).where(*conditions)
                          .order_by(CourierPartner.name, CourierPartner.id).offset(offset).limit(limit))
        return dict(items=[dict(id=str(r.id), name=r.name) for r in rows], total=total)
    return transaction(db, actor, work)


def validate_actual(actual, shipped_at, today):
    if actual is None:
        return
    if not shipped_at:
        raise ImmError("The historical shipment event date is unavailable. Actual delivery cannot be recorded without it.",
                       409, "shipment_event_unavailable")
    event_date = datetime.fromisoformat(shipped_at).astimezone(ZoneInfo("Asia/Kolkata")).date()
    if actual > today or actual < event_date:
        raise ImmError("Actual delivery must be on or after shipment and cannot be in the future.",
                       422, "shipment_actual_date")


def mutate(db, actor, kind, identity, body, operation):
    service = SOURCES[kind]
    def work(current, keys):
        key = body.idempotency_key
        # Same lock namespace as the source's existing retry API. A retry can
        # only replay this exact owner-bound payload, never another operation.
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key.int % (2**63 - 1)})
        payload = dict(operation=f"shipment_{operation}", type=kind, id=str(identity),
                       body=body.model_dump(mode="json"))
        previous_request = db.get(service.Retry, key)
        if previous_request:
            if previous_request.actor_id != current.user.id:
                raise ImmError("Retry identity belongs to another actor.", 409, "shipment_retry")
            prior = service.unseal(keys, "requests", key, previous_request.response_ciphertext)
            if encode(prior.get("request")) != encode(payload):
                raise ImmError("Retry the exact unchanged shipment submission.", 409, "shipment_retry")
            row = db.scalar(select(service.Order).where(service.Order.id == identity).with_for_update())
            if not row:
                raise ImmError("Saved order is unavailable.", 404, "shipment_not_found")
            return projection(kind, row, service.unseal(keys, "orders", row.id, row.snapshot_ciphertext))
        row = db.scalar(select(service.Order).where(service.Order.id == identity).with_for_update())
        if not row:
            raise ImmError("Saved order is unavailable.", 404, "shipment_not_found")
        if row.version != body.expected_version:
            raise ImmError("Order changed. Your draft remains here. Close and refresh before preparing a new submission.",
                           409, "shipment_stale")
        snapshot = service.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
        shipping = dict(snapshot.get("shipment") or {})
        now = utcnow()
        today = now.astimezone(ZoneInfo("Asia/Kolkata")).date()
        old_status = "In process" if row.status == "Approved" else row.status
        if operation == "ship":
            if old_status != "In process":
                raise ImmError("Only In process orders can be shipped.", 409, "shipment_transition")
            courier = db.scalar(select(CourierPartner).where(
                CourierPartner.id == body.courier_id, CourierPartner.status == "active",
                CourierPartner.deleted_at.is_(None)).with_for_update())
            if not courier:
                raise ImmError("Choose an active saved Courier Partner.", 422, "shipment_courier")
            if body.expected_delivery_date < today:
                raise ImmError("Expected delivery cannot precede shipment.", 422, "shipment_expected_date")
            validate_actual(body.actual_delivery_date, now.isoformat(), today)
            # Retain any prior evidence instead of overwriting it silently.
            if shipping:
                snapshot["shipmentHistory"] = [*snapshot.get("shipmentHistory", []), shipping]
            shipping = dict(courierId=str(courier.id), courierName=courier.name,
                trackingId=body.tracking_id, expectedDeliveryDate=body.expected_delivery_date.isoformat(),
                actualDeliveryDate=body.actual_delivery_date.isoformat() if body.actual_delivery_date else None,
                shippedAt=now.isoformat(), shippedBy=str(current.user.id))
            row.status = "Shipped"
        elif operation in {"delivery", "return"}:
            if old_status != "Shipped":
                raise ImmError("Only Shipped orders permit this action.", 409, "shipment_transition")
            if operation == "delivery":
                validate_actual(body.actual_delivery_date, shipping.get("shippedAt"), today)
                snapshot["shipmentHistory"] = [*snapshot.get("shipmentHistory", []), dict(shipping)]
                shipping["actualDeliveryDate"] = body.actual_delivery_date.isoformat()
                shipping["deliveryRecordedAt"] = now.isoformat()
                shipping["deliveryRecordedBy"] = str(current.user.id)
            else:
                shipping["returnedAt"] = now.isoformat()
                shipping["returnedBy"] = str(current.user.id)
                row.status = "Returned"
        else:
            raise ImmError("Unsupported shipment action.", 422, "shipment_action")
        snapshot["shipment"], snapshot["status"] = shipping, row.status
        row.version += 1
        row.updated_by, row.updated_at = current.user.id, now
        row.snapshot_ciphertext = service.seal(keys, "orders", row.id, snapshot)
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            action=f"shipment_{operation}", resource_type=f"{kind.lower()}_order", resource_id=row.id,
            outcome="success", request_id=db.info.get("request_id"), created_at=now))
        result = projection(kind, row, snapshot)
        db.add(service.Retry(key=key, actor_id=current.user.id,
            response_ciphertext=service.seal(keys, "requests", key, dict(request=payload, result=result))))
        db.flush()
        return result
    return transaction(db, actor, work)
