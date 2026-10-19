"""Versioned products and atomic assembly on the authoritative inventory ledger."""
import uuid
from datetime import date
from decimal import Decimal
from sqlalchemy import select
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.product_models import ComboProduct as Product, ProductRevision as Revision, ProductMember as Member, ProductAssembly as Assembly, ProductRequest as Retry
from app.db.inventory_models import InventoryLot as Lot, InventoryBalance as Balance
from app.db.allergen_models import AllergenProduct
from app.db.location_models import StorageLocation
from app.services import inventory as inv
from app.services.purchase_received_crypto import PRError
from app.services.zones import label

UNIT = "procurement quantity units"
COMBO_UNIT = "whole combos"


def normalized(value):
    return " ".join(value.split()).casefold()


def current_row(db, record_id, live=False):
    row = db.scalar(select(Product).where(Product.id == record_id).with_for_update())
    if not row or (live and row.deleted_at):
        raise PRError("Product not found or deleted.", 404, "product_not_found")
    return row


def projection(db, crypto, row, refresh=True):
    data = crypto.open(row.id, "product", row.payload_ciphertext)
    if refresh:
        for member in data["members"]:
            allergen = db.get(AllergenProduct, uuid.UUID(member["allergenId"]))
            member["available"] = bool(allergen and not allergen.deleted_at and allergen.status == "active")
    return data


def event(db, actor, record_id, operation, kind="product"):
    row = AuditEvent(actor_id=actor.user.id, session_id=actor.session_id,
        action="product_" + operation, resource_type=kind, resource_id=record_id,
        outcome="success", request_id=db.info.get("request_id"), created_at=utcnow())
    db.add(row)
    db.flush()
    return row


def retry_result(db, current, crypto, key, command):
    hashes = crypto.digests(["products:v1", command])
    row = db.get(Retry, key)
    if row:
        if row.actor_id != current.user.id or row.digest not in hashes.values():
            raise PRError("This request identity is closed or conflicts. Reconcile before another save.", 409, "product_retry")
        return True, crypto.open(key, "product_retry", row.payload_ciphertext), hashes
    return False, None, hashes


def save_retry(db, actor, crypto, key, hashes, result):
    db.add(Retry(key=key, actor_id=actor.user.id, digest=hashes[crypto.active],
        payload_ciphertext=crypto.seal(key, "product_retry", result)))


def reconcile(db, actor, key):
    def work(current, crypto):
        row = db.get(Retry, key)
        if row and row.actor_id != current.user.id:
            raise PRError("Request belongs to a different actor.", 403, "product_retry_owner")
        if not row:
            db.add(Retry(key=key, actor_id=current.user.id, digest="cancelled",
                payload_ciphertext=crypto.seal(key, "product_retry", None)))
        return dict(state="committed" if row and row.digest != "cancelled" else "not_committed",
                    result=crypto.open(key, "product_retry", row.payload_ciphertext) if row else None)
    return inv.transaction(db, actor, work)


def recipe(db, members, old=None):
    retained = {(m["allergenId"], m["quantity"]) for m in old["members"]} if old else set()
    result = []
    for member in sorted(members, key=lambda m: m.allergenId):
        row = db.scalar(select(AllergenProduct).where(AllergenProduct.id == member.allergenId).with_for_update())
        amount = inv.q(inv.quantity(member.quantity))
        available = bool(row and not row.deleted_at and row.status == "active")
        if not row or (not available and (str(member.allergenId), amount) not in retained):
            raise PRError("Choose existing active allergens, never other combos. Unavailable unchanged members can be retained but not assembled.", 409, "product_member")
        result.append(dict(allergenId=str(row.id), name=row.name, quantity=amount, unit=UNIT, available=available))
    return result


def unique_name(db, crypto, name, exclude=None):
    # The shared inventory lock serializes absent-name creation. Decrypting the
    # bounded catalogue also detects duplicates encrypted/indexed with old keys.
    for row in inv.bounded(db, select(Product).where(Product.deleted_at.is_(None)).order_by(Product.id)):
        if row.id != exclude and normalized(projection(db, crypto, row, False)["name"]) == normalized(name):
            raise PRError("A live product already uses this name, including inactive products.", 409, "product_duplicate")
    return crypto.digests(["product-name:v1", normalized(name)])[crypto.active]


def mutate(db, actor, body, record_id=None, operation="create"):
    def work(current, crypto):
        command = [operation, str(record_id) if record_id else None, body.model_dump(mode="json")]
        found, result, hashes = retry_result(db, current, crypto, body.idempotencyKey, command)
        if found:
            return result
        now = utcnow()
        row = current_row(db, record_id, True) if record_id else None
        before = projection(db, crypto, row, False) if row else None
        if row and row.version != body.expected_version:
            raise PRError("Product changed. Your draft is preserved; review the current version.", 409, "product_stale")
        if not row:
            row = Product(id=uuid.uuid4(), version=1, status=body.status,
                created_by=current.user.id, updated_by=current.user.id, created_at=now, updated_at=now)
            data = {}
        else:
            data = dict(before)
            row.version += 1
        if operation in ("create", "edit"):
            row.name_key = unique_name(db, crypto, body.name, row.id)
            data.update(name=body.name, mrp=body.mrp, sellingPrice=body.sellingPrice,
                        members=recipe(db, body.members, before))
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            row.status = body.status
        row.updated_at, row.updated_by = now, current.user.id
        data.update(id=str(row.id), status=row.status, version=row.version,
            createdAt=row.created_at.isoformat(), updatedAt=now.isoformat(),
            createdBy=before["createdBy"] if before else label(db, current.user.id),
            updatedBy=label(db, current.user.id), deletedAt=now.isoformat() if row.deleted_at else None)
        row.payload_ciphertext = crypto.seal(row.id, "product", data)
        db.add(row)
        db.flush()
        audit = event(db, current, row.id, operation)
        revision_id = uuid.uuid4()
        history = dict(id=str(revision_id), action=operation, at=now.isoformat(),
            actor=label(db, current.user.id), version=row.version, before=before, after=data)
        db.add(Revision(id=revision_id, product_id=row.id, version=row.version,
            actor_id=current.user.id, event_id=audit.id, created_at=now,
            payload_ciphertext=crypto.seal(revision_id, "product_revision", history)))
        db.flush()
        for member in data["members"]:
            db.add(Member(revision_id=revision_id, allergen_id=uuid.UUID(member["allergenId"]),
                quantity=Decimal(member["quantity"])))
        save_retry(db, current, crypto, body.idempotencyKey, hashes, data)
        return data
    return inv.transaction(db, actor, work)


def summary(db, crypto, products):
    ids = {uuid.UUID(p["id"]) for p in products}
    names = {p["id"]: p["name"] for p in products}
    assembled, remaining = {}, []
    assemblies = inv.bounded(db, select(Assembly).where(Assembly.product_id.in_(ids)).order_by(Assembly.id))
    for row in assemblies:
        pid = str(row.product_id)
        assembled[pid] = assembled.get(pid, 0) + row.quantity
    lots = inv.bounded(db, select(Lot).where(Lot.combo_id.in_(ids)).order_by(Lot.id))
    lot_products = {r.id: str(r.combo_id) for r in lots}
    quantities = {}
    for row in inv.bounded(db, select(Balance).where(Balance.lot_id.in_(lot_products)).order_by(Balance.lot_id, Balance.location_id)):
        key = (lot_products[row.lot_id], row.location_id)
        quantities[key] = quantities.get(key, Decimal(0)) + row.quantity
    for (pid, lid), amount in quantities.items():
        location = db.get(StorageLocation, lid)
        remaining.append(dict(productId=pid, productName=names[pid], locationId=str(lid),
            locationName=location.name if location else "Unavailable location", unit=COMBO_UNIT, quantity=inv.q(amount)))
    return dict(products=len(products), assemblies=len(assemblies),
        assembled=[dict(productId=pid, productName=names[pid], unit=COMBO_UNIT, quantity=inv.q(Decimal(amount)))
                   for pid, amount in assembled.items()], remaining=remaining,
        scope="All matching products and committed assemblies, not the table page. Whole-combo quantities grouped by product/location; prices are not realized revenue.")


def listing(db, actor, query="", status="all", offset=0, limit=25):
    def work(_, crypto):
        rows = inv.bounded(db, select(Product).where(Product.deleted_at.is_(None)).order_by(Product.created_at.desc(), Product.id))
        data = [projection(db, crypto, r) for r in rows]
        term = normalized(query)
        matches = [r for r in data if (status == "all" or r["status"] == status)
                   and (not term or term in normalized(r["name"]))]
        return dict(items=matches[offset:offset + limit], total=len(data), filtered=len(matches),
                    offset=offset, limit=limit, summary=summary(db, crypto, matches))
    return inv.transaction(db, actor, work)


def detail(db, actor, record_id, section=None, offset=0, limit=25):
    def work(_, crypto):
        row = current_row(db, record_id)
        data = projection(db, crypto, row)
        if section == "analytics":
            return summary(db, crypto, [data])
        if section == "activity":
            rows = inv.bounded(db, select(Revision).where(Revision.product_id == row.id).order_by(Revision.version.desc()))
            return dict(items=[crypto.open(r.id, "product_revision", r.payload_ciphertext) for r in rows[offset:offset + limit]],
                        filtered=len(rows), offset=offset, limit=limit)
        if section == "assemblies":
            rows = inv.bounded(db, select(Assembly).where(Assembly.product_id == row.id).order_by(Assembly.created_at.desc(), Assembly.id))
            return dict(items=[crypto.open(r.id, "assembly", r.payload_ciphertext) for r in rows[offset:offset + limit]],
                        filtered=len(rows), offset=offset, limit=limit)
        return data
    return inv.transaction(db, actor, work)


def references(db, actor, query="", offset=0, limit=25):
    def work(_, crypto):
        rows = inv.bounded(db, select(AllergenProduct).where(AllergenProduct.deleted_at.is_(None), AllergenProduct.status == "active").order_by(AllergenProduct.name, AllergenProduct.id))
        data = [dict(id=str(r.id), name=f"{r.name} · {r.concentration}", version=r.version, unit=UNIT)
                for r in rows if normalized(query) in normalized(f"{r.name} {r.concentration}")]
        return dict(items=data[offset:offset + limit], filtered=len(data), offset=offset, limit=limit)
    return inv.transaction(db, actor, work)


def review_assembly(db, crypto, body):
    inv.require_complete(db)
    product = current_row(db, body.productId, True)
    if product.status != "active" or product.version != body.expected_version:
        raise PRError("Product is inactive or the saved recipe changed. Review the current version.", 409, "assembly_recipe_stale")
    data = projection(db, crypto, product, False)
    location = db.scalar(select(StorageLocation).where(StorageLocation.id == body.locationId).with_for_update())
    if not location or location.deleted_at or location.status != "active":
        raise PRError("Choose one active assembly location.", 409, "assembly_location")
    requirements, versions = {}, {}
    for member in sorted(data["members"], key=lambda m: m["allergenId"]):
        key = uuid.UUID(member["allergenId"])
        allergen = db.scalar(select(AllergenProduct).where(AllergenProduct.id == key).with_for_update())
        if not allergen or allergen.deleted_at or allergen.status != "active":
            raise PRError("Every recipe member must still be active for new assembly.", 409, "assembly_member")
        requirements[key] = Decimal(member["quantity"]) * body.quantity
        versions[key] = allergen.version
    used, totals, components = set(), {key: Decimal(0) for key in requirements}, []
    for allocation in sorted(body.allocations, key=lambda a: a.lotId):
        if allocation.lotId in used or inv.quantity(allocation.quantity) <= 0:
            raise PRError("Each source lot must occur once with a positive exact quantity.", 422, "assembly_allocation")
        used.add(allocation.lotId)
        lot = db.get(Lot, allocation.lotId)
        if not lot or lot.combo_id or lot.product_id not in requirements:
            raise PRError("Source lots must be individual allergens in this recipe, never assembled combos.", 409, "assembly_source")
        balance = db.get(Balance, (lot.id, body.locationId))
        amount = inv.quantity(allocation.quantity)
        if not balance or balance.quantity < amount:
            raise PRError("Insufficient component stock at the selected location. Review your retained draft.", 409, "assembly_insufficient")
        meta = crypto.open(lot.id, "lot", lot.payload_ciphertext)
        # Explicit output identity is separate from component identity. Never
        # extend a known source expiry or silently derive an invented batch.
        expiry = meta.get("expiryDate")
        if not expiry or body.expiryDate > date.fromisoformat(expiry):
            raise PRError("Output expiry cannot extend any source expiry. A source with unavailable expiry cannot be assembled.", 422, "assembly_expiry")
        totals[lot.product_id] += amount
        components.append(dict(**meta, lotId=str(lot.id), quantity=inv.q(amount),
            before=inv.q(balance.quantity), after=inv.q(balance.quantity - amount), productVersion=versions[lot.product_id]))
    if totals != requirements:
        raise PRError("Selected lot quantities must exactly equal every saved per-combo requirement multiplied by the whole output quantity.", 422, "assembly_requirements")
    snapshot = dict(productId=str(product.id), productName=data["name"], version=product.version,
        mrp=data["mrp"], sellingPrice=data["sellingPrice"], members=data["members"],
        location=inv.location_snapshot(location), quantity=body.quantity, unit=COMBO_UNIT,
        batchNo=body.batchNo, expiryDate=body.expiryDate.isoformat(), components=components)
    return dict(assembly=snapshot, reviewToken=crypto.digests(["assembly-review:v1", snapshot])[crypto.active])


def preview(db, actor, body):
    return inv.transaction(db, actor, lambda _, crypto: review_assembly(db, crypto, body))


def assemble(db, actor, body):
    def work(current, crypto):
        command = ["assembly", body.model_dump(mode="json")]
        found, result, hashes = retry_result(db, current, crypto, body.idempotencyKey, command)
        if found:
            return result
        review = review_assembly(db, crypto, body)
        if body.reviewToken not in crypto.digests(["assembly-review:v1", review["assembly"]]).values():
            raise PRError("Assembly review changed. Your draft is preserved; review again.", 409, "assembly_review_stale")
        now, aid, lid = utcnow(), uuid.uuid4(), uuid.uuid4()
        audit = event(db, current, aid, "assembled", "product_assembly")
        snapshot = review["assembly"]
        data = dict(**snapshot, id=str(aid), lotId=str(lid), createdAt=now.isoformat(),
            actor=label(db, current.user.id), actorId=str(current.user.id),
            outputBefore="0.000", outputAfter=inv.q(Decimal(body.quantity)),
            activity=[dict(action="assembled", at=now.isoformat(), actor=label(db, current.user.id), requestId=db.info.get("request_id"))])
        revision = db.scalar(select(Revision).where(Revision.product_id == body.productId, Revision.version == body.expected_version))
        if not revision:
            raise PRError("Saved recipe evidence is unavailable.", 409, "assembly_recipe_unavailable")
        db.add(Assembly(id=aid, product_id=body.productId, revision_id=revision.id,
            location_id=body.locationId, quantity=body.quantity, actor_id=current.user.id,
            event_id=audit.id, created_at=now, payload_ciphertext=crypto.seal(aid, "assembly", data)))
        db.flush()
        meta = dict(itemKind="combo", assemblyId=str(aid), productId=str(body.productId),
            comboProductId=str(body.productId), assembledQuantity=str(snapshot["quantity"]),
            productName=snapshot["productName"], batchNo=body.batchNo, expiryDate=body.expiryDate.isoformat(),
            receiptId=None, receiptNumber=None, lineId=None, receivedDate=None,
            originalCreatedAt=now.isoformat(), unit=COMBO_UNIT,
            originLocationId=str(body.locationId), originLocationName=snapshot["location"]["name"],
            recipe=dict(version=body.expected_version, members=snapshot["members"]),
            mrp=snapshot["mrp"], sellingPrice=snapshot["sellingPrice"], sourceComponents=snapshot["components"])
        lot = Lot(id=lid, receipt_id=None, line_id=None, product_id=None, combo_id=body.productId,
            assembly_id=aid, origin_id=body.locationId, accepted=Decimal(body.quantity),
            payload_ciphertext=crypto.seal(lid, "lot", meta))
        db.add(lot)
        db.flush()
        for component in snapshot["components"]:
            inv.post(db, db.get(Lot, uuid.UUID(component["lotId"])), body.locationId,
                -Decimal(component["quantity"]), f"assembly:{aid}", current)
        inv.post(db, lot, body.locationId, Decimal(body.quantity), f"assembly:{aid}", current)
        save_retry(db, current, crypto, body.idempotencyKey, hashes, data)
        return data
    return inv.transaction(db, actor, work)


def assembly_detail(db, actor, record_id):
    def work(_, crypto):
        row = db.get(Assembly, record_id)
        if not row:
            raise PRError("Assembly not found.", 404, "assembly_not_found")
        return crypto.open(row.id, "assembly", row.payload_ciphertext)
    return inv.transaction(db, actor, work)
