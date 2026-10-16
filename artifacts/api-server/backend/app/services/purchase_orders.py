"""Exact, transactionally audited procurement; no browser ledger is consulted."""
import hashlib
import json
import uuid
from decimal import Decimal
from sqlalchemy import select, func, or_, delete, text
from sqlalchemy.exc import SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.purchase_order_models import PurchaseOrder as PO, PurchaseOrderLine as Line, PurchaseOrderAudit as Meta, PurchaseOrderRequest as Retry
from app.db.vendor_models import Vendor
from app.db.location_models import StorageLocation
from app.db.allergen_models import AllergenProduct
from app.schemas.purchase_orders import POInput
from app.services.allergens import authorize
from app.services.zones import label
from app.services.purchase_order_tax import tax_basis, supplier_state, calculate_components, COMPONENTS

MAX_TOTAL = 10000000000
MODELS = {"vendors": (Vendor, Vendor.vendorName), "locations": (StorageLocation, StorageLocation.name),
          "products": (AllergenProduct, AllergenProduct.name)}


class POError(Exception):
    def __init__(self, message="Purchase orders are unavailable. Your draft is preserved; retry later.",
                 status=503, code="po_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, actor, work):
    try:
        current = authorize(db, actor)
        result = work(current)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise POError() from None
    except Exception:
        db.rollback()
        raise


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def locked_reference(db, kind, record_id):
    model, _ = MODELS[kind]
    row = db.scalar(select(model).where(model.id == record_id).with_for_update())
    # Vendors retain their existing any-non-deleted eligibility convention.
    if not row or row.deleted_at or (kind != "vendors" and row.status != "active"):
        raise POError(f"Selected {kind} record is no longer available. Choose a current record and review again.",
                      409, "po_reference_stale")
    return row


def projection(db, row):
    lines = db.scalars(select(Line).where(Line.order_id == row.id).order_by(Line.position)).all()
    return dict(id=str(row.id), number=row.number, version=row.version, poDate=row.po_date.isoformat(),
                expectedDate=row.expected_date.isoformat(), vendorId=str(row.vendor_id), vendorName=row.vendor_name,
                locationId=str(row.location_id), locationName=row.location_name, status=row.status,
                subtotal=row.subtotal, gstAmount=row.gst_amount, total=row.total,
                taxBasis=row.tax_basis, taxComponents=row.tax_components,
                createdAt=row.created_at.isoformat(), updatedAt=row.updated_at.isoformat(), deletedAt=row.deleted_at,
                lines=[dict(**line.snapshot, id=str(line.id)) for line in lines])


def preview_data(db, body, existing=None):
    previous = projection(db, existing) if existing else None
    vendor = None if previous and previous["vendorId"] == str(body.vendorId) else locked_reference(db, "vendors", body.vendorId)
    # Retained vendors keep captured tax identity, never silently adopt master changes.
    # Legacy edits explicitly capture the current, available vendor tax identity.
    if vendor is None and not previous.get("taxBasis"):
        vendor = locked_reference(db, "vendors", body.vendorId)
    gstin = vendor.gstNo if vendor else previous["taxBasis"]["supplierGstin"]
    basis = tax_basis(gstin, body.placeOfSupplyCode)
    location = None if previous and previous["locationId"] == str(body.locationId) else locked_reference(db, "locations", body.locationId)
    products = {}
    retained = {line["productId"]: line for line in previous["lines"]} if previous else {}
    for product_id in sorted({line.productId for line in body.lines}):
        if str(product_id) not in retained:
            products[product_id] = locked_reference(db, "products", product_id)
    lines = []
    revisions = []
    for line in body.lines:
        old = retained.get(str(line.productId))
        product = products.get(line.productId)
        price = Decimal(old["unitPrice"]) if old else product.selling_price
        gst = Decimal(old["gst"]) if old else product.gst
        if price is None:
            raise POError("The selected product has no catalogue selling price. Set it in Allergen Master before reviewing.", 422, "po_price_missing")
        lines.append(dict(productId=str(line.productId), productName=old["productName"] if old else product.name,
                          quantity=line.quantity, unitPrice=str(price), gst=str(gst),
                          **calculate_components(line.quantity, price, gst, basis["treatment"])))
        revisions.append(product.version if product else None)
    figures = {field: sum(line[field] for line in lines) for field in ("subtotal", "gstAmount", "total")}
    if figures["total"] > MAX_TOTAL:
        raise POError("Order total exceeds ₹10 crore.", 422, "po_total")
    order = dict(poDate=body.poDate.isoformat(), expectedDate=body.expectedDate.isoformat(),
                 vendorId=str(body.vendorId), vendorName=previous["vendorName"] if previous and previous["vendorId"] == str(body.vendorId) else vendor.vendorName,
                 locationId=str(body.locationId), locationName=location.name if location else previous["locationName"],
                 lines=lines, **figures)
    order.update(taxBasis=basis, taxComponents={k: sum(line["taxComponents"][k] for line in lines) for k in COMPONENTS})
    token = digest([order, vendor.version if vendor else None, location.version if location else None, revisions,
                    str(existing.id) if existing else None, existing.version if existing else None])
    return dict(order=order, reviewToken=token)


def preview(db, actor, body, record_id=None):
    return transaction(db, actor, lambda _: preview_data(db, body, find(db, record_id) if record_id else None))


def find(db, record_id):
    row = db.scalar(select(PO).where(PO.id == record_id).with_for_update())
    if not row:
        raise POError("Purchase order not found.", 404, "po_not_found")
    return row


def audit(db, actor, row, action, summary):
    event = AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action=f"purchase_order_{action}",
                       resource_type="purchase_order", resource_id=row.id, outcome="success",
                       request_id=db.info.get("request_id"), created_at=utcnow())
    db.add(event)
    db.flush()
    db.add(Meta(event_id=event.id, order_id=row.id, number=row.number, action=action,
                summary=summary, actor=label(db, actor.user.id)))


def persist_lines(db, row, lines):
    old = list(db.scalars(select(Line).where(Line.order_id == row.id).order_by(Line.position)))
    # Reuse matching server identities, including repeated products, once each.
    for position, data in enumerate(lines):
        match = next((line for line in old if str(line.product_id) == data["productId"]), None)
        if match:
            old.remove(match)
            match.position, match.snapshot = position, data
        else:
            db.add(Line(order_id=row.id, product_id=uuid.UUID(data["productId"]), position=position, snapshot=data))
    for line in old:
        db.delete(line)


def mutation(db, actor, body, record_id=None, operation="created"):
    def work(current):
        payload = body.model_dump(mode="json")
        # Pre-upgrade requests omitted this field. Preserve their exact digest so
        # committed/lost-ack responses can be recovered before any new validation.
        if "placeOfSupplyCode" not in body.model_fields_set:
            payload.pop("placeOfSupplyCode", None)
        payload_digest = digest([operation, record_id, payload])
        # Serialize retry key before existence check, including across requests.
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int(body.idempotencyKey.int % (2**63 - 1))})
        prior = db.get(Retry, body.idempotencyKey)
        if prior:
            if prior.actor_id != current.user.id or prior.digest != payload_digest:
                raise POError("Retry identity belongs to different data. Check the saved order before continuing.", 409, "po_retry_conflict")
            return prior.response
        row = find(db, record_id) if record_id else None
        before = projection(db, row) if row else None
        if row and (row.status != "open" or row.version != body.expected_version):
            raise POError("Order changed or was deleted. Reload it before retrying.", 409, "po_stale")
        if operation == "deleted":
            row.status, row.deleted_at = "deleted", utcnow().isoformat()
            summary = f"Deleted order; open value removed: INR {Decimal(row.total) / 100:.2f}"
        else:
            review = preview_data(db, body, row)
            if review["reviewToken"] != body.reviewToken:
                raise POError("Catalogue or reference details changed since review. Your draft is preserved; review current amounts again.",
                              409, "po_review_stale")
            data = review["order"]
            if not row:
                sequence = db.scalar(text("SELECT nextval('purchase_order_number_seq')"))
                row = PO(id=uuid.uuid4(), number=f"PO-{body.poDate:%Y%m%d}-{sequence:08d}",
                         created_by=current.user.id, version=1, status="open")
                db.add(row)
            row.vendor_id, row.location_id = body.vendorId, body.locationId
            row.vendor_name, row.location_name = data["vendorName"], data["locationName"]
            row.po_date, row.expected_date = body.poDate, body.expectedDate
            row.subtotal, row.gst_amount, row.total = data["subtotal"], data["gstAmount"], data["total"]
            row.tax_basis, row.tax_components = data["taxBasis"], data["taxComponents"]
            db.flush()
            persist_lines(db, row, data["lines"])
            if before:
                changed = [name for key, name in (("poDate", "PO date"), ("expectedDate", "expected delivery"),
                           ("vendorId", "vendor"), ("locationId", "storage location"), ("taxBasis", "tax basis / place of supply"), ("lines", "product lines"))
                           if (before[key] if key != "lines" else [{k: v for k, v in l.items() if k != "id"} for l in before[key]]) != data[key]]
                if not changed:
                    raise POError("No changes to save.", 422, "po_no_change")
                summary = f"Updated {', '.join(changed)}; total INR {Decimal(before['total']) / 100:.2f} → {Decimal(row.total) / 100:.2f}"
            else:
                summary = f"Created with {len(data['lines'])} product lines; total INR {Decimal(row.total) / 100:.2f} including GST"
        if before:
            row.version += 1
        row.updated_at = utcnow()
        db.flush()
        audit(db, current, row, operation, summary)
        result = projection(db, row)
        db.add(Retry(key=body.idempotencyKey, actor_id=current.user.id, digest=payload_digest, response=result))
        return result
    return transaction(db, actor, work)


def page(db, statement, total_statement, limit, offset, project):
    filtered = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery()))
    total = db.scalar(total_statement)
    return dict(items=[project(row) for row in db.execute(statement.limit(limit).offset(offset)).all()],
                filtered=filtered, total=total, limit=limit, offset=offset)


def pattern(query):
    return "%" + query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def listing(db, actor, query="", status="open", vendor_id=None, product_id=None,
            from_date=None, to_date=None, sort="recent", limit=10, offset=0):
    def work(_):
        if from_date and to_date and from_date > to_date:
            raise POError("From PO date must not be later than To PO date.", 422, "po_date_range")
        statement = select(PO)
        if status != "all":
            statement = statement.where(PO.status == status)
        if vendor_id:
            statement = statement.where(PO.vendor_id == vendor_id)
        if product_id:
            statement = statement.where(select(Line.id).where(Line.order_id == PO.id, Line.product_id == product_id).exists())
        if from_date:
            statement = statement.where(PO.po_date >= from_date)
        if to_date:
            statement = statement.where(PO.po_date <= to_date)
        if query.strip():
            p = pattern(query)
            statement = statement.where(or_(PO.number.ilike(p, escape="\\"), PO.vendor_name.ilike(p, escape="\\"),
                PO.location_name.ilike(p, escape="\\"),
                select(Line.id).where(Line.order_id == PO.id, Line.snapshot["productName"].as_string().ilike(p, escape="\\")).exists()))
        ordering = (PO.po_date, PO.created_at, PO.id)
        statement = statement.order_by(*(col.asc() if sort == "oldest" else col.desc() for col in ordering))
        return page(db, statement, select(func.count()).select_from(PO), limit, offset, lambda r: projection(db, r[0]))
    return transaction(db, actor, work)


def overview_data(db):
    count, value, vendors = db.execute(select(func.count(), func.coalesce(func.sum(PO.total), 0),
        func.count(func.distinct(PO.vendor_id))).where(PO.status == "open")).one()
    lines = db.scalar(select(func.count()).select_from(Line).join(PO).where(PO.status == "open"))
    changes = db.scalar(select(func.count()).select_from(Meta))
    return dict(openValue=int(value), openCount=count, vendorCount=vendors, lineCount=lines, changes=changes)


def activity(db, actor, query="", limit=10, offset=0):
    def work(_):
        statement = select(Meta, AuditEvent).join(AuditEvent, AuditEvent.id == Meta.event_id)
        if query.strip():
            p = pattern(query)
            statement = statement.where(or_(*(col.ilike(p, escape="\\") for col in (Meta.number, Meta.action, Meta.summary, Meta.actor))))
        statement = statement.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        return page(db, statement, select(func.count()).select_from(Meta), limit, offset,
            lambda r: dict(id=str(r[0].event_id), orderId=str(r[0].order_id), number=r[0].number,
                           action=r[0].action, summary=r[0].summary, actor=r[0].actor, at=r[1].created_at.isoformat()))
    return transaction(db, actor, work)


def analytics(db, actor):
    def work(_):
        counts = dict(created=0, updated=0, deleted=0)
        counts.update(dict(db.execute(select(Meta.action, func.count()).group_by(Meta.action)).all()))
        # Group by historical name as well as identity; renaming cannot relabel
        # previous purchases. Sum of these groups equals the overview exactly.
        vendors = db.execute(select(PO.vendor_id, PO.vendor_name, func.count(), func.sum(PO.total))
            .where(PO.status == "open").group_by(PO.vendor_id, PO.vendor_name)
            .order_by(func.sum(PO.total).desc(), PO.vendor_name, PO.vendor_id)).all()
        return dict(counts=counts, vendors=[dict(id=f"{r[0]}:{r[1]}", name=r[1], count=r[2], amount=int(r[3])) for r in vendors])
    return transaction(db, actor, work)


def references(db, actor, kind, query="", limit=25, offset=0, selected_id=None, historical=False):
    def work(_):
        if historical:
            if kind == "vendors":
                choices = select(PO.vendor_id.label("id"), PO.vendor_name.label("name")).distinct().subquery()
            else:
                choices = select(Line.product_id.label("id"), Line.snapshot["productName"].as_string().label("name")).distinct().subquery()
            # One choice per master identity, even after historical renames.
            # Search every retained label, but return a stable representative.
            grouped = select(choices.c.id, func.min(choices.c.name).label("name")).group_by(choices.c.id)
            if query.strip():
                grouped = grouped.having(func.bool_or(choices.c.name.ilike(pattern(query), escape="\\")))
            if selected_id:
                grouped = grouped.where(choices.c.id == selected_id)
            options = grouped.subquery()
            statement = select(options.c.id, options.c.name)
            return page(db, statement.order_by(options.c.name, options.c.id),
                        select(func.count(func.distinct(choices.c.id))),
                        limit, offset, lambda r: dict(id=str(r[0]), name=r[1]))
        model, name = MODELS[kind]
        statement = select(model).where(model.deleted_at.is_(None))
        if kind != "vendors":
            statement = statement.where(model.status == "active")
        total = select(func.count()).select_from(statement.subquery())
        if query.strip():
            statement = statement.where(name.ilike(pattern(query), escape="\\"))
        if selected_id:
            statement = statement.where(model.id == selected_id)
        def project(r):
            row = r[0]
            data = dict(id=str(row.id), name=getattr(row, name.key), version=row.version)
            if kind == "products":
                data.update(unitPrice=str(row.selling_price) if row.selling_price is not None else None, gst=str(row.gst))
            if kind == "vendors":
                state = supplier_state(row.gstNo)
                data.update(gstin=row.gstNo, registrationStateCode=state["code"] if state else None,
                            registrationStateName=state["name"] if state else None)
            return data
        return page(db, statement.order_by(name, model.id), total, limit, offset, project)
    return transaction(db, actor, work)
