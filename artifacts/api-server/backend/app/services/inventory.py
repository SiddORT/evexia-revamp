"""Receipt-backed inventory. All writers share one short transaction lock.

Operational quantities are canonical hundredths; original evidence is retained.
Current stock is lifetime acceptance plus transfers, not a financial-year sum.
"""
import uuid
from decimal import Decimal, InvalidOperation
from sqlalchemy import select, text, func, or_
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.inventory_models import (
    InventoryLot as Lot, InventoryBalance as Balance, InventoryPosting as Posting,
    InventoryReceiptState as ReceiptState, InventoryMovement as Movement,
    InventoryRequest as Retry,
)
from app.db.purchase_received_models import PurchaseReceipt as Receipt
from app.db.purchase_received_models import ReceiptSource
from app.db.location_models import StorageLocation
from app.db.allergen_models import AllergenProduct
from app.db.product_models import ComboProduct
from app.db.staff_models import StaffProfile
from app.services.purchase_received_crypto import ReceiptCrypto, PRError
from app.services.staff_crypto import StaffCrypto
from app.services.zones import label
from app.services import purchase_received as receipts
from app.services.expiry_policy import usable, require_usable, state as expiry_state
from app.schemas.quantities import quantity_string, display_quantity, rounded_quantity

LIMIT = 2000
LOCK = 145573
COVERAGE = ("Operational stock is exact to 0.01 procurement quantity units. Original thousandth evidence is retained across the explicit precision boundary. "
            "Reviewed assemblies consume those components and create separate whole-combo lots in this same ledger. "
            "Reasoned manual adjustments add distinct adjustment-origin stock or reduce an existing lot/location. "
            "Opening finished products do not consume components. Unallocated stock needs explicit allocation. No pack conversions. Stock carries across financial years. "
            "Supported configured-price MR IT approval consumes saved Extract/Dilution ml with order-linked postings. "
            "browser/demo data, unrelated sales, reservations and in-transit shipping are outside coverage.")


class InventoryCrypto(ReceiptCrypto):
    """Reuse independently approved PR keys, but never PR ciphertext purposes."""
    def seal(self, record_id, field, data):
        return super().seal(record_id, "inventory:" + field, data)

    def open(self, record_id, field, value):
        return super().open(record_id, "inventory:" + field, value)

    def digests(self, data):
        return super().digests(["inventory:v1", data])


def lock(db):
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
    from app.services.quantity_precision import ready
    ready(db)


def transaction(db, actor, work, *, capability=None):
    def run(current, _):
        lock(db)
        return work(current, InventoryCrypto(get_settings(), db))
    try:
        return receipts.transaction(db, actor, run, capability=capability)
    except PRError as exc:
        if exc.code == "pr_unavailable":
            raise PRError("Inventory schema or encrypted storage is unavailable. Contact the operator; your draft is preserved.",
                          503, "inventory_unavailable") from None
        raise


def bounded(db, statement):
    rows = list(db.scalars(statement.limit(LIMIT + 1)))
    if len(rows) > LIMIT:
        raise PRError(f"Inventory scope exceeds {LIMIT} records. Narrow the scope; no partial inventory is returned.", 422, "inventory_scope")
    return rows


def quantity(value):
    try:
        return Decimal(quantity_string(str(value)))
    except (ValueError, InvalidOperation, TypeError):
        raise PRError("Use a quantity from zero to 1000000 with up to six source decimals; it rounds half-up to two places. Positive entries must round to at least 0.01.", 422, "inventory_quantity") from None


def q(value):
    return display_quantity(value)


def selected_allergen_advice(db, identities):
    """Narrow MR advice, not permission to read stock/locations/lots/history.

    Sum the same lifetime lot/location balances as stock(), including
    Unallocated stock. Missing receipt initialization is never catalogue zero.
    A savepoint keeps a missing inventory schema advisory, not a failed order.
    """
    from sqlalchemy.exc import SQLAlchemyError
    ids = sorted({uuid.UUID(str(identity)) for identity in identities})
    if not ids:
        return []
    unknown = [dict(allergenId=str(identity), name="Selected allergen", state="unavailable_check",
                    quantity=None, threshold=None,
                    message="Inventory coverage is unavailable to check. This is advisory; you may continue.")
               for identity in ids]
    try:
        with db.begin_nested():
            lock(db)
            context = coverage(db)
            products = {p.id: p for p in db.scalars(select(AllergenProduct).where(AllergenProduct.id.in_(ids)))}
            if not context["complete"]:
                return [{**item, "name": products[uuid.UUID(item["allergenId"])].name
                         if uuid.UUID(item["allergenId"]) in products else item["name"]} for item in unknown]
            totals = {}
            crypto = InventoryCrypto(get_settings(), db)
            rows = list(db.execute(select(Lot, Balance).join(Balance, Balance.lot_id == Lot.id)
                    .where(Lot.product_id.in_(ids), Balance.quantity > 0).limit(LIMIT + 1)))
            if len(rows) > LIMIT:
                return unknown
            for lot, balance in rows:
                meta = crypto.open(lot.id, "lot", lot.payload_ciphertext)
                if usable(meta):
                    totals[lot.product_id] = totals.get(lot.product_id, Decimal(0)) + balance.quantity
            result = []
            for identity in ids:
                product = products.get(identity)
                if not product:
                    result.append(next(item for item in unknown if item["allergenId"] == str(identity)))
                    continue
                amount = totals.get(identity, Decimal(0))
                threshold = product.threshold_limit
                if not amount.is_finite() or amount < 0 or (threshold is not None and (not threshold.is_finite() or threshold < 0)):
                    result.append({**next(item for item in unknown if item["allergenId"] == str(identity)), "name": product.name})
                    continue
                state = "unavailable_stock" if amount == 0 else (
                    "low_stock" if threshold is not None and amount <= threshold else "healthy")
                message = ("No stock available." if amount == 0 else
                           f"Low stock: {q(amount)} at or below threshold {threshold}." if state == "low_stock" else
                           f"Stock present: {q(amount)}.")
                result.append(dict(allergenId=str(identity), name=product.name, state=state,
                    quantity=q(amount), threshold=str(threshold) if threshold is not None else None,
                    message=message + " Procurement quantity units; no demand conversion or reservation. Advisory only."))
            return result
    except (SQLAlchemyError, PRError):
        return unknown


def balance_at(db, lot_id, location):
    return db.scalar(select(Balance).where(Balance.lot_id == lot_id, Balance.location_id == location))


def post(db, lot, location, delta, source, actor, movement=None):
    if delta != rounded_quantity(delta):
        raise PRError("New stock postings must be canonical hundredths.", 409, "inventory_precision")
    if delta < 0 and not lot.combo_id and source.startswith(("assembly:", "adjustment:", "move:", "it-approval:")):
        require_usable(InventoryCrypto(get_settings(), db).open(lot.id, "lot", lot.payload_ciphertext))
    if location is None and not lot.opening_id:
        raise PRError("Only opening stock can be Unallocated.", 409, "inventory_unallocated")
    row = balance_at(db, lot.id, location)
    if not row:
        row = Balance(lot_id=lot.id, location_id=location, quantity=Decimal(0))
        db.add(row)
    before = row.quantity
    after = before + delta
    if after < 0 or after > 1000000:
        raise PRError("Receipt correction or transfer would overdraw this receipt lot. Your draft is preserved.", 409, "inventory_insufficient")
    row.quantity = after
    if delta:
        db.add(Posting(id=uuid.uuid4(), source_key=source, lot_id=lot.id, location_id=location,
                       movement_id=movement, actor_id=actor.user.id, created_at=utcnow(),
                       delta=delta, before=before, after=after))
    db.flush()
    return dict(before=q(before), after=q(after))


def reconcile_receipt(db, actor, data, initializing=False):
    """Called inside the receipt transaction, after shared inventory lock."""
    crypto = InventoryCrypto(get_settings(), db)
    receipt_id = uuid.UUID(data["id"])
    state = db.get(ReceiptState, receipt_id)
    existing = bounded(db, select(Lot).where(Lot.receipt_id == receipt_id).order_by(Lot.id))
    by_line = {str(row.line_id): row for row in existing}
    incoming = {line["lineId"]: line for line in data["lines"]} if data["status"] == "active" else {}
    for line_id in sorted(set(by_line) | set(incoming)):
        line, lot = incoming.get(line_id), by_line.get(line_id)
        accepted = quantity(line["acceptedQty"]) if line else Decimal(0)
        if not lot and not accepted:
            continue
        metadata = dict(
            receiptId=data["id"], receiptNumber=data["number"], lineId=line_id,
            productId=line["productId"], productName=line["productName"], batchNo=line["batchNo"],
            expiryDate=line["expiryDate"], receivedDate=data["receivedDate"],
            originalCreatedAt=data["createdAt"], unit="procurement quantity units",
            originLocationId=data["locationId"], originLocationName=data["locationName"],
        ) if line else None
        if not lot:
            lot = Lot(id=uuid.uuid5(receipt_id, line_id), receipt_id=receipt_id,
                      line_id=uuid.UUID(line_id), product_id=uuid.UUID(line["productId"]),
                      origin_id=uuid.UUID(data["locationId"]), accepted=Decimal(0),
                      payload_ciphertext=crypto.seal(uuid.uuid5(receipt_id, line_id), "lot", metadata))
            db.add(lot)
            db.flush()
        else:
            old = crypto.open(lot.id, "lot", lot.payload_ciphertext)
            changed = metadata and any(old[k] != metadata[k] for k in ("productId", "batchNo", "expiryDate"))
            from app.services.expiry_policy import state as expiry_state
            if changed and expiry_state(old.get("expiryDate")) in ("today", "expired"):
                raise PRError("A saved expired batch cannot be revived by changing its product, batch or expiry.", 409, "inventory_lot_retained")
            from app.services.inventory_expiry import cost
            if changed and cost(db, crypto, "lot", lot.id):
                raise PRError("A batch with recorded actual cost cannot change its identity or expiry. Record a separate genuine batch.", 409, "inventory_lot_retained")
            moved = db.scalar(select(Posting.id).where(Posting.lot_id == lot.id,
                or_(Posting.movement_id.is_not(None), Posting.source_key.startswith("assembly:"),
                    Posting.source_key.startswith("adjustment:"), Posting.source_key.startswith("disposal:"),
                    Posting.source_key.startswith("it-approval:"))).limit(1))
            if changed and moved:
                raise PRError("This receipt lot has committed transfers or consumption; its product, batch and expiry cannot change.", 409, "inventory_lot_retained")
            if metadata:
                lot.payload_ciphertext = crypto.seal(lot.id, "lot", metadata)
        # A committed separation or disposal permanently retains identity.
        from app.db.expiry_models import ExpirySeparation, ExpiryDisposal
        if existing and lot in existing:
            disposed = db.scalar(
                select(ExpiryDisposal.id).where(ExpiryDisposal.source_kind == "lot", ExpiryDisposal.batch_id == lot.id).limit(1))
            retained = db.get(ExpirySeparation, ("lot", lot.id)) or disposed
            if metadata and retained and any(old.get(k) != metadata.get(k) for k in ("productId", "batchNo", "expiryDate")):
                raise PRError("Expired/disposed batch identity and expiry cannot be rewritten.", 409, "inventory_lot_retained")
            if disposed and accepted > rounded_quantity(lot.accepted):
                raise PRError("A disposed receipt lot cannot receive additional acceptance. Record a separate genuine receipt batch.", 409, "inventory_lot_retained")
        if line and line.get("actualUnitCost") is not None:
            from app.services.inventory_expiry import cost, record_cost
            if not cost(db, crypto, "lot", lot.id):
                record_cost(db, crypto, actor, "lot", lot.id, line["actualUnitCost"],
                            line["costProvenance"], origin="purchase_receipt")
        # Reductions occur ONLY at original receipt location, never at a destination.
        post(db, lot, lot.origin_id, accepted - rounded_quantity(lot.accepted),
             f"receipt:{receipt_id}:{data['version']}", actor)
        lot.accepted = accepted
    if state:
        state.version = data["version"]
    else:
        db.add(ReceiptState(receipt_id=receipt_id, version=data["version"], initialized_at=utcnow()))
    db.flush()


def coverage(db):
    # SQL counts are not limited to the page. Zero catalogue quantity is distinct
    # from uninitialized receipt quantities.
    missing = db.scalar(select(func.count()).select_from(Receipt).outerjoin(
        ReceiptState, ReceiptState.receipt_id == Receipt.id).where(
            or_(ReceiptState.receipt_id.is_(None), ReceiptState.version != Receipt.version)))
    return dict(complete=missing == 0, pendingReceipts=missing, contract=COVERAGE,
                sales="unavailable: no server sales backend", openings="Reviewed server openings; Unallocated included separately")


def require_complete(db):
    result = coverage(db)
    if not result["complete"]:
        raise PRError("Inventory is unavailable until all server receipts have been reviewed and initialized. No partial balances may be used.", 409, "inventory_uninitialized")
    return result


def initialization_report(db, actor, offset=0, limit=25):
    def work(_, crypto):
        rows = list(db.scalars(select(Receipt).order_by(Receipt.id).offset(offset).limit(limit)))
        items = []
        for row in rows:
            try:
                data = receipts.projection(row, ReceiptCrypto(get_settings(), db))
                validate_initialization(db, row, data)
                state = db.get(ReceiptState, row.id)
                items.append(dict(receiptId=str(row.id), version=row.version,
                    state="current" if state and state.version == row.version else "eligible",
                    reviewToken=crypto.digests(data)[crypto.active],
                    reconciliation=receipt_evidence(db, row, data),
                    originalCreatedAt=data["createdAt"],
                    initializedAt=state.initialized_at.isoformat() if state else None,
                    historicalLocationGeography="unavailable; receipt retained ID/name only"))
            except Exception:
                items.append(dict(receiptId=str(row.id), state="unavailable", reviewToken=None))
        return dict(items=items, offset=offset, limit=limit, coverage=coverage(db))
    return transaction(db, actor, work)


def initialize_one(db, actor, receipt_id, token):
    """Operator procedure only. Caller must independently satisfy activation gates.

    Not exposed as an HTTP mutation. Rechecking the exact encrypted receipt
    digest makes an old review unusable. Receipt state makes resumption a no-op.
    """
    def work(current, crypto):
        row = receipts.get_row(db, receipt_id)
        data = receipts.projection(row, ReceiptCrypto(get_settings(), db))
        validate_initialization(db, row, data)
        if token not in crypto.digests(data).values():
            raise PRError("Initialization review is stale.", 409, "inventory_initialization_stale")
        state = db.get(ReceiptState, receipt_id)
        if state and state.version == row.version:
            evidence = receipt_evidence(db, row, data)
            if any(not item["matches"] for item in evidence):
                raise PRError("Current receipt state does not reconcile.", 409, "inventory_reconciliation")
            return dict(state="already_current", receiptId=str(receipt_id), reconciliation=evidence)
        reconcile_receipt(db, current, data, initializing=True)
        evidence = receipt_evidence(db, row, data)
        if any(not item["matches"] for item in evidence):
            raise PRError("Initialized receipt does not reconcile.", 409, "inventory_reconciliation")
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            action="inventory_initialized", resource_type="purchase_received",
            resource_id=row.id, outcome="success", request_id=db.info.get("request_id")))
        return dict(state="initialized", receiptId=str(receipt_id), version=row.version, reconciliation=evidence)
    return transaction(db, actor, work)


def validate_initialization(db, row, data):
    """Refuse unavailable/ambiguous source evidence rather than guess identity."""
    from datetime import date, datetime
    if (data["source"] != "server" or data["id"] != str(row.id)
            or data["version"] != row.version or data["status"] != row.status
            or data["locationId"] != str(row.location_id) or data["poId"] != str(row.po_id)
            or data["number"] != row.number):
        raise PRError("Receipt identity evidence is inconsistent.", 409, "inventory_initialization_unavailable")
    datetime.fromisoformat(data["createdAt"])
    line_ids = set()
    for line in data["lines"]:
        if line["lineId"] in line_ids:
            raise PRError("Receipt-line provenance is ambiguous.", 409, "inventory_initialization_unavailable")
        line_ids.add(line["lineId"])
        reference = db.get(ReceiptSource, (row.id, uuid.UUID(line["lineId"])))
        if (not reference or str(reference.product_id) != line["productId"]
                or quantity(line["acceptedQty"]) > quantity(line["receivedQty"])
                or not line["batchNo"].strip()):
            raise PRError("Receipt-line provenance is unavailable.", 409, "inventory_initialization_unavailable")
        date.fromisoformat(line["expiryDate"])
    if not db.get(StorageLocation, row.location_id):
        raise PRError("Retained receipt location is unavailable.", 409, "inventory_initialization_unavailable")


def receipt_evidence(db, row, data):
    """Per-product reconciliation, never a meaningless mixed-product total."""
    from app.services.quantity_precision import checkpoints, verify_chain, source_residual as precision_source_residual
    lots = bounded(db, select(Lot).where(Lot.receipt_id == row.id).order_by(Lot.id))
    evidence = []
    for line in data["lines"]:
        lot = next((r for r in lots if str(r.line_id) == line["lineId"]), None)
        amounts = bounded(db, select(Balance).where(Balance.lot_id == lot.id).order_by(Balance.location_id)) if lot else []
        ledger = bounded(db, select(Posting).where(Posting.lot_id == lot.id).order_by(Posting.id)) if lot else []
        boundary = checkpoints(db, "inventory", [lot.id]) if lot else []
        verify_chain(sorted(ledger, key=lambda p: (p.created_at, p.id)), amounts, boundary)
        expected = quantity(line["acceptedQty"]) if data["status"] == "active" else Decimal(0)
        balance = sum((a.quantity for a in amounts), Decimal(0))
        consumed = -sum((p.delta for p in ledger if p.source_key.startswith("assembly:")), Decimal(0))
        disposed = -sum((p.delta for p in ledger if p.source_key.startswith("disposal:")), Decimal(0))
        source = sum((p.delta for p in ledger if p.source_key.startswith("receipt:")), Decimal(0))
        other = sum((p.delta for p in ledger if not p.source_key.startswith("receipt:")), Decimal(0))
        residual = sum((r["residual"] for r in boundary), Decimal(0))
        evidence.append(dict(lineId=line["lineId"], productId=line["productId"],
            accepted=q(expected), posted=q(lot.accepted) if lot else "0.00",
            consumedInAssemblies=q(consumed), disposedQuantity=q(disposed), onHand=q(balance),
            precisionResidual=format(residual, "f"),
            matches=bool(rounded_quantity(lot.accepted if lot else Decimal(0)) == expected
                         and source + (precision_source_residual(db, lot.id) if lot else Decimal(0)) == expected
                         and source + other + residual == balance)))
    return evidence


def stock_snapshot(db, crypto, params):
    """Read under the caller's inventory lock; never commits or authorizes."""
    def work(_, crypto):
        context = coverage(db)
        if not context["complete"]:
            return dict(items=[], filtered=0, total=0, coverage=context, asOf=utcnow().isoformat(),
                        limit=params["limit"], offset=params["offset"])
        products = bounded(db, select(AllergenProduct).where(AllergenProduct.deleted_at.is_(None)).order_by(AllergenProduct.name, AllergenProduct.id))
        combos = bounded(db, select(ComboProduct).where(ComboProduct.deleted_at.is_(None)).order_by(ComboProduct.id))
        lots = bounded(db, select(Lot).order_by(Lot.id))
        balances = bounded(db, select(Balance).order_by(Balance.lot_id, Balance.location_id))
        locations = {}
        result = {}
        for product in products:
            result[str(product.id)] = dict(itemKind="allergen", productId=str(product.id), name=product.name,
                category=product.category_name, categoryId=str(product.category_id), concentration=product.concentration,
                sellingPrice=str(product.selling_price) if product.selling_price is not None else None,
                thresholdLimit=str(product.threshold_limit) if product.threshold_limit is not None else None,
                quantity="0.00", unit="procurement quantity units", lots=[], history=[], state="catalogue_zero")
        for product in combos:
            meta = crypto.open(product.id, "product", product.payload_ciphertext)
            result[str(product.id)] = dict(itemKind="combo", productId=str(product.id), name=meta["name"],
                category="Assembled combos", categoryId=None, concentration="", sellingPrice=meta["sellingPrice"],
                thresholdLimit=None,
                quantity="0.00", unit="whole combos", lots=[], history=[], state="catalogue_zero")
        for lot in lots:
            meta = crypto.open(lot.id, "lot", lot.payload_ciphertext)
            # Retained stock remains visible even after catalogue soft deletion.
            pid = str(lot.combo_id or lot.product_id)
            if pid not in result:
                product = db.get(AllergenProduct, lot.product_id) if lot.product_id else None
                result[pid] = dict(itemKind="combo" if lot.combo_id else "allergen",
                    productId=pid, name=meta["productName"], category=product.category_name if product else "Assembled combos",
                    categoryId=str(product.category_id) if product else None,
                    concentration=product.concentration if product else "", sellingPrice=None,
                    thresholdLimit=str(product.threshold_limit) if product and product.threshold_limit is not None else None,
                    quantity="0.00", unit=meta["unit"], lots=[], history=[], state="retained_product")
            item = result[pid]
            eligible = bool(lot.combo_id) or usable(meta)
            unknown_opening = bool(not lot.combo_id and lot.opening_id
                                   and expiry_state(meta.get("expiryDate")) == "unknown")
            if not eligible and not unknown_opening:
                # Only unknown-expiry openings gain presentation visibility.
                # Other excluded stock remains in the dedicated expiry views.
                continue
            item.setdefault("physicalLots", [])
            for balance in (b for b in balances if b.lot_id == lot.id and b.quantity):
                lid = str(balance.location_id) if balance.location_id else None
                if lid not in locations:
                    location = db.get(StorageLocation, balance.location_id) if balance.location_id else None
                    locations[lid] = location.name if location else "Unallocated"
                detail = dict(**meta, lotId=str(lot.id), locationId=lid,
                              locationName=locations[lid], quantity=q(balance.quantity))
                item["physicalLots"].append(detail)
                if eligible:
                    # Keep operational consumers (including low-stock alerts)
                    # on the existing usable quantity/lot contract.
                    item["lots"].append(detail)
                    item["quantity"] = q(Decimal(item["quantity"]) + balance.quantity)
                item["state"] = "in_house_dilution" if lot.reserve_movement_id else ("adjustment_backed" if lot.adjustment_id else ("opening_backed" if lot.opening_id else ("assembled" if lot.combo_id else "receipt_backed")))
        # Catalogue concentration is not a label for mixed-concentration batches.
        for item in result.values():
            if any(l.get("source") == "in_house_dilution" for l in item["lots"]):
                item["concentration"] = "Batch-specific — see lots"
                item["unit"] = "Batch-specific — see lots"
        for item in result.values():
            physical = item.setdefault("physicalLots", [])
            # Sum each live lot/location balance once, never original openings.
            item["physicalQuantity"] = q(sum((Decimal(l["quantity"]) for l in physical), Decimal(0)))
            item["unknownExpiryOpeningQuantity"] = q(Decimal(item["physicalQuantity"]) - Decimal(item["quantity"]))
            item["physicalUnallocatedQuantity"] = q(sum((Decimal(l["quantity"]) for l in physical if l["locationId"] is None), Decimal(0)))
            item["unallocatedQuantity"] = q(sum((Decimal(l["quantity"]) for l in item["lots"] if l["locationId"] is None), Decimal(0)))
        rows = list(result.values())
        total = len(rows)
        choices = [{key: row[key] for key in ("productId", "name", "concentration", "category", "categoryId")}
                   for row in rows]
        status = params.get("stock_status", "all")
        if status not in {"all", "in_stock", "out_of_stock", "stock_alert"}:
            raise PRError("Choose a valid stock status.", 422, "inventory_filter")

        def matches_status(row):
            # Stock Status filters follow its presentation quantity, not the
            # separate operational low-stock policy.
            amount = Decimal(row["physicalQuantity"])
            if status == "in_stock":
                return amount > 0
            if status == "out_of_stock":
                return amount == 0
            if status == "stock_alert":
                return (row["itemKind"] == "allergen" and row["thresholdLimit"] is not None
                        and amount <= Decimal(row["thresholdLimit"]))
            return True

        term = params.get("query", "").strip().casefold()
        ids = params.get("product_ids", "")
        selected = set(ids.split(",")) if ids else set()
        rows = [r for r in rows if (not term or term in " ".join([r["name"], r["concentration"], r["category"], r["productId"]]).casefold())
                and (not params.get("category_id") or r["categoryId"] == str(params["category_id"]))
                and (not selected or r["productId"] in selected) and matches_status(r)]
        if len(rows) > LIMIT:
            raise PRError("Combined stock scope exceeds the bounded inventory limit. Narrow the scope.", 422, "inventory_scope")
        # Snapshot contains every matching row for report/CSV. Pagination is a
        # projection of this same transaction-held snapshot, never another read.
        return dict(items=rows[params["offset"]:params["offset"] + params["limit"]],
                    snapshot=rows if params.get("snapshot") else None,
                    filterOptions=choices, filtered=len(rows), total=total, limit=params["limit"], offset=params["offset"],
                    asOf=utcnow().isoformat(), coverage=context)
    return work(None, crypto)


def stock(db, actor, params):
    return transaction(db, actor, lambda _, crypto: stock_snapshot(db, crypto, params),
                       capability=("stock_status", "export" if params.get("snapshot") else None))


def stock_history(db, actor, product_id, from_date=None, to_date=None, offset=0, limit=25):
    def work(_, crypto):
        require_complete(db)
        statement = select(Posting).join(Lot, Lot.id == Posting.lot_id).where(or_(Lot.product_id == product_id, Lot.combo_id == product_id))
        if from_date:
            statement = statement.where(Posting.created_at >= from_date)
        if to_date:
            statement = statement.where(Posting.created_at < to_date)
        rows = bounded(db, statement.order_by(Posting.created_at.desc(), Posting.id))
        return dict(items=[dict(id=str(r.id), at=r.created_at.isoformat(), lotId=str(r.lot_id),
             locationId=str(r.location_id) if r.location_id else None, movementId=str(r.movement_id) if r.movement_id else None,
              delta=q(rounded_quantity(r.after) - rounded_quantity(r.before)), before=q(r.before), after=q(r.after), actor=label(db, r.actor_id),
             source=r.source_key) for r in rows[offset:offset + limit]],
             filtered=len(rows), offset=offset, limit=limit,
             scope="Recorded receipt, opening, assembly, IT approval consumption and transfer/allocation posting times, not inferred historical activity. Period changes history only, never on-hand.")
    return transaction(db, actor, work, capability=("stock_status", "history"))


def references(db, actor, kind, query="", offset=0, limit=25, source_id=None, unallocated=False, *, purpose="movement"):
    if purpose == "opening_stock":
        if kind != "locations":
            raise PRError("Opening Stock references are limited to eligible locations.", 403, "access_denied")
        capability = ("opening_stock", None)
    elif purpose == "movement":
        capability = ("stock_movement", "create" if kind in ("staff", "lots") else None)
    else:
        raise PRError("Unsupported reference purpose.", 403, "access_denied")
    def work(current, crypto):
        if purpose == "opening_stock":
            # Use the shared master's predicates, and page in SQL before the
            # inventory-wide bounded loader can hide a large master directory.
            from app.services.locations import predicates
            filters = predicates(query, "active")
            filtered = db.scalar(select(func.count()).select_from(StorageLocation).where(*filters))
            rows = db.scalars(select(StorageLocation).where(*filters).order_by(
                StorageLocation.name, StorageLocation.id).offset(offset).limit(limit))
            return dict(items=[dict(id=str(r.id), name=r.name) for r in rows],
                        filtered=filtered, offset=offset, limit=limit)
        if kind.startswith("movement-"):
            # Historical choices must not disappear when a catalogue row is
            # renamed, inactivated or deleted. Latest saved label per ID wins.
            rows = bounded(db, select(Movement).order_by(Movement.created_at.desc(), Movement.id))
            choices = {}
            for row in rows:
                movement = crypto.open(row.id, "movement", row.payload_ciphertext)
                if not reserve_visible(current, movement):
                    continue
                if kind == "movement-allergens":
                    for key, name in movement_allergens(movement).items():
                        choices.setdefault(key, name)
                else:
                    location = movement["source" if kind == "movement-sources" else "destination"]
                    if location["id"] is not None:
                        choices.setdefault(str(location["id"]), location["name"])
            data = [dict(id=key, name=name) for key, name in choices.items()]
        elif kind == "staff":
            rows = bounded(db, select(StaffProfile).where(StaffProfile.status == "active", StaffProfile.deleted_at.is_(None)).order_by(StaffProfile.id))
            sc = StaffCrypto(get_settings())
            data = [dict(id=str(r.id), name=sc.decrypt(r.id, "name", r.name_ciphertext)) for r in rows]
        elif kind == "locations":
            rows = bounded(db, select(StorageLocation).where(StorageLocation.status == "active", StorageLocation.deleted_at.is_(None)).order_by(StorageLocation.id))
            data = [dict(id=str(r.id), name=r.name) for r in rows]
        else:
            require_complete(db)
            if not source_id and not unallocated:
                return dict(items=[], filtered=0, offset=offset, limit=limit)
            if source_id and unallocated:
                raise PRError("Choose a real source or Unallocated, not both.", 422, "inventory_source")
            balances = bounded(db, select(Balance).where(Balance.location_id == source_id, Balance.quantity > 0).order_by(Balance.lot_id))
            data = []
            for balance in balances:
                lot = db.get(Lot, balance.lot_id)
                meta = crypto.open(lot.id, "lot", lot.payload_ciphertext)
                if not lot.combo_id and not usable(meta):
                    continue
                meta.setdefault("itemKind", "combo" if lot.combo_id else "allergen")
                provenance = ("Adjustment " + str(lot.adjustment_id)) if lot.adjustment_id else (("Opening stock " + meta["openingId"]) if lot.opening_id else (meta.get("receiptNumber") or "Assembled combo"))
                data.append(dict(id=str(lot.id), name=f"{meta['productName']} · {meta.get('batchNo') or 'Batch unavailable'} · {provenance}",
                                 **meta, available=q(balance.quantity)))
            if source_id and current.user.is_protected_system_admin and current.role == "super_admin":
                from app.services import reserve_movements
                reserve_movements.acquire(db, current)
                data.extend(reserve_movements.choices(db, crypto, source_id))
        data = sorted([r for r in data if query.strip().casefold() in r["name"].casefold()], key=lambda r: (r["name"], r["id"]))
        return dict(items=data[offset:offset + limit], filtered=len(data), offset=offset, limit=limit)
    return transaction(db, actor, work, capability=capability)


def location_snapshot(row):
    return dict(id=str(row.id), name=row.name, address=row.address, pincode=row.pincode,
                countryCode=row.countryCode, state=row.state, city=row.city, version=row.version)


def unallocated_snapshot():
    return dict(id=None, name="Unallocated", address="", pincode="", countryCode="", state="", city="", version=0)


def review_move(db, crypto, body, actor=None):
    require_complete(db)
    if any(line.sourceKind == "reserve" for line in body.lines):
        from app.services import reserve_movements
        reserve_movements.acquire(db, actor)
    locations = {}
    if body.sourceId is None:
        locations[None] = unallocated_snapshot()
    for key in sorted(k for k in (body.sourceId, body.destinationId) if k is not None):
        row = db.scalar(select(StorageLocation).where(StorageLocation.id == key).with_for_update())
        if not row or row.status != "active" or row.deleted_at:
            raise PRError("Choose two available active locations.", 409, "inventory_location")
        locations[key] = location_snapshot(row)
    if body.deliveryMode == "staff":
        staff = db.scalar(select(StaffProfile).where(StaffProfile.id == body.staffId).with_for_update())
        if not staff or staff.deleted_at or staff.status != "active":
            raise PRError("Choose active staff or Other.", 409, "inventory_staff")
        name = StaffCrypto(get_settings()).decrypt(staff.id, "name", staff.name_ciphertext)
        staff_version = staff.version
    else:
        name, staff_version = body.otherName.strip(), None
    lines, seen = [], set()
    for line in sorted(body.lines, key=lambda l: l.lotId):
        if line.lotId in seen or quantity(line.quantity) <= 0:
            raise PRError("Each lot must occur once with a positive quantity.", 422, "inventory_line")
        seen.add(line.lotId)
        if line.sourceKind == "reserve":
            lines.append(reserve_movements.review_line(db, crypto, body, line))
            continue
        lot = db.get(Lot, line.lotId)
        balance = balance_at(db, line.lotId, body.sourceId)
        if not lot or not balance or balance.quantity < quantity(line.quantity):
            raise PRError("Available source stock changed. Review the retained draft again.", 409, "inventory_insufficient")
        product = db.get(ComboProduct, lot.combo_id) if lot.combo_id else db.get(AllergenProduct, lot.product_id)
        if not product or (not lot.combo_id and (product.status != "active" or product.deleted_at)):
            raise PRError("The selected product is no longer active.", 409, "inventory_product")
        if lot.combo_id and Decimal(line.quantity) != Decimal(line.quantity).to_integral_value():
            raise PRError("Assembled products move only as positive whole combos.", 422, "inventory_combo_quantity")
        destination = balance_at(db, lot.id, body.destinationId)
        src, dst, amount = balance.quantity, destination.quantity if destination else Decimal(0), quantity(line.quantity)
        metadata = crypto.open(lot.id, "lot", lot.payload_ciphertext)
        if not lot.combo_id:
            require_usable(metadata)
        # A later unchanged transfer is not another dilution.
        metadata.update(sourceKind="inventory", dilutionFactor=None,
            resultingQuantity=q(amount), resultingConcentration=metadata.get("concentration"),
            resultingExpiryDate=metadata.get("expiryDate"))
        lines.append(dict(**metadata, lotId=str(lot.id),
            quantity=q(amount), sourceBefore=q(src), sourceAfter=q(src - amount),
            destinationBefore=q(dst), destinationAfter=q(dst + amount), productVersion=product.version))
    data = dict(source=locations[body.sourceId], destination=locations[body.destinationId],
                date=body.date.isoformat(), deliveryMode=body.deliveryMode,
                staffId=str(body.staffId) if body.staffId else None, deliveredBy=name,
                staffVersion=staff_version, lines=lines)
    return dict(movement=data, reviewToken=crypto.digests([str(actor.user.id), data])[crypto.active])


def preview(db, actor, body):
    return transaction(db, actor, lambda current, c: review_move(db, c, body, current), capability=("stock_movement", "create"))


def create(db, actor, body):
    def work(current, crypto):
        hashes = crypto.digests(body.model_dump(mode="json"))
        old = db.get(Retry, body.idempotencyKey)
        if old:
            if old.actor_id != current.user.id or old.digest not in hashes.values():
                raise PRError("Request identity is closed or conflicts. Reconcile before a new save.", 409, "inventory_retry")
            return public_movement(current, crypto.open(old.key, "retry", old.payload_ciphertext))
        review = review_move(db, crypto, body, current)
        if review["reviewToken"] != body.reviewToken:
            raise PRError("Stock or reference choices changed. Review your preserved draft again.", 409, "inventory_review_stale")
        now, mid = utcnow(), uuid.uuid4()
        for line in review["movement"]["lines"]:
            if line.get("sourceKind") == "reserve" and line.get("dilutionFactor"):
                line["destinationLotId"] = str(uuid.uuid5(mid, line["reserveId"]))
        event = AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            action="inventory_allocated" if body.sourceId is None else "inventory_moved",
            resource_type="inventory_movement", resource_id=mid,
            outcome="success", request_id=db.info.get("request_id"), created_at=now)
        db.add(event)
        db.flush()
        data = dict(**review["movement"], id=str(mid), createdAt=now.isoformat(),
            actor=label(db, current.user.id), actorId=str(current.user.id), appendOnly=True,
            activity=[dict(action="committed", at=now.isoformat(), actor=label(db, current.user.id),
                           requestId=db.info.get("request_id"))],
            summary=dict(movements=1, lots=len(body.lines),
                         scope="This committed movement only. Quantities are not summed across products."))
        db.add(Movement(id=mid, source_id=body.sourceId, destination_id=body.destinationId,
                        actor_id=current.user.id, event_id=event.id, created_at=now,
                        payload_ciphertext=crypto.seal(mid, "movement", data)))
        db.flush()
        for line in review["movement"]["lines"]:
            if line.get("sourceKind") == "reserve":
                from app.services import reserve_movements
                reserve_movements.commit_line(db, crypto, current, body, line, mid)
                continue
            lot = db.get(Lot, uuid.UUID(line["lotId"]))
            post(db, lot, body.sourceId, -Decimal(line["quantity"]), f"move:{mid}", current, mid)
            post(db, lot, body.destinationId, Decimal(line["quantity"]), f"move:{mid}", current, mid)
        db.add(Retry(key=body.idempotencyKey, actor_id=current.user.id, digest=hashes[crypto.active],
                     payload_ciphertext=crypto.seal(body.idempotencyKey, "retry", data)))
        return public_movement(current, data)
    return transaction(db, actor, work, capability=("stock_movement", "create"))


def public_movement(actor, data):
    from app.services.capability_policy import allowed
    if data is None:
        return None
    return {**data,
            "activity": data["activity"] if allowed(actor, "stock_movement", "activity") else [],
            "summary": data["summary"] if allowed(actor, "stock_movement", "analytics") else None}


def reserve_visible(actor, data):
    return (actor.user.is_protected_system_admin and actor.role == "super_admin") or not any(
        line.get("sourceKind") == "reserve" for line in data["lines"])


def reconcile(db, actor, key):
    def work(current, crypto):
        row = db.get(Retry, key)
        if row and row.actor_id != current.user.id:
            raise PRError("Request belongs to a different actor.", 403, "inventory_retry_owner")
        if not row:
            db.add(Retry(key=key, actor_id=current.user.id, digest="cancelled",
                         payload_ciphertext=crypto.seal(key, "retry", None)))
        return dict(state="committed" if row and row.digest != "cancelled" else "not_committed",
                    movement=public_movement(current, crypto.open(key, "retry", row.payload_ciphertext)) if row else None)
    return transaction(db, actor, work, capability=("stock_movement", "create"))


def movement_allergens(movement):
    """Match saved allergen IDs, including the assembly's historical recipe.

    Finished-product openings without recipe evidence are not attributed to a
    current recipe: doing so would invent historical component provenance.
    """
    result = {}
    for line in movement["lines"]:
        if line.get("itemKind") == "combo" or line.get("comboProductId"):
            for member in (line.get("recipe") or {}).get("members", []):
                result.setdefault(str(member["allergenId"]), member["name"])
        else:
            result.setdefault(str(line["productId"]), line["productName"])
    return result


def movements(db, actor, query="", offset=0, limit=10, record_id=None, section=None,
              source_id=None, destination_id=None, unallocated=False, allergen_ids=None):
    def work(current, crypto):
        from app.services.capability_policy import allowed
        statement = select(Movement)
        if record_id:
            statement = statement.where(Movement.id == record_id)
        rows = bounded(db, statement.order_by(Movement.created_at.desc(), Movement.id))
        data = [crypto.open(r.id, "movement", r.payload_ciphertext) for r in rows]
        data = [r for r in data if reserve_visible(current, r)]
        if section is None:
            for item in data:
                if not allowed(current, "stock_movement", "activity"):
                    item["activity"] = []
                if not allowed(current, "stock_movement", "analytics"):
                    item["summary"] = None
        if record_id:
            if not data:
                raise PRError("Movement not found.", 404, "inventory_not_found")
            return data[0][section] if section else data[0]
        data = [r for r in data
            if (not source_id or str(r["source"]["id"]) == str(source_id))
            and (not unallocated or r["source"]["id"] is None)
            and (not destination_id or str(r["destination"]["id"]) == str(destination_id))
            and (not allergen_ids or allergen_ids.intersection(movement_allergens(r)))
            and query.strip().casefold() in " ".join([
            r["source"]["name"], r["destination"]["name"], r["deliveredBy"],
            *[l["productName"] for l in r["lines"]]]).casefold()]
        return dict(items=data[offset:offset + limit], filtered=len(data), total=sum(
            reserve_visible(current, crypto.open(r.id, "movement", r.payload_ciphertext)) for r in rows), limit=limit, offset=offset,
                    summary=dict(movements=len(data), lots=sum(len(r["lines"]) for r in data),
                                 scope="All matching committed movements; no mixed-product quantity total.")
                    if allowed(current, "stock_movement", "analytics") else None)
    return transaction(db, actor, work, capability=("stock_movement",
        "activity" if section == "activity" else "analytics" if section == "summary" else None))
