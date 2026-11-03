"""Protected reserve availability and exact, explicitly reviewed conversions."""
import re
import uuid
import calendar
from datetime import date
from decimal import Decimal, localcontext
from sqlalchemy import select, text
from app.db.in_house_stock_models import InHouseStock, InHousePosting
from app.db.location_models import StorageLocation
from app.services.purchase_received_crypto import PRError


def acquire(db, actor):
    from app.services.allergens import authorize
    from app.services.in_house_stock import LOCK
    authorize(db, actor)
    # All mixed operations take inventory first, reserve second, before row locks.
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})


def balances(db, record):
    from app.services.inventory import bounded, quantity
    amounts = {record["locationId"]: quantity(record["quantity"])}
    for posting in bounded(db, select(InHousePosting).where(
            InHousePosting.reserve_id == uuid.UUID(record["id"])).order_by(InHousePosting.id)):
        key = str(posting.location_id)
        amounts[key] = amounts.get(key, Decimal(0)) + posting.delta
    return amounts


def availability(db, record):
    from app.services.inventory import q
    from app.services.expiry_policy import usable
    amounts = balances(db, record)
    return dict(availableQuantity=q(sum(amounts.values(), Decimal(0))) if usable(record) else "0.000",
        locationBalances=[dict(locationId=key, locationName=db.get(StorageLocation, uuid.UUID(key)).name,
                               quantity=q(amount)) for key, amount in sorted(amounts.items()) if amount])


def metadata(record):
    return dict(source="in_house_reserve", sourceKind="reserve", reserveOnly=True,
        reserveId=record["id"], productId=record["allergenId"], productName=record["allergenName"],
        concentration=record["concentration"], batchNo=record["batch"] or None,
        expiryDate=record["expiryDate"], unit=record["unit"] or "ml", itemKind="allergen",
        receiptId=None, receiptNumber=None, lineId=None, receivedDate=None,
        originalCreatedAt=record["createdAt"])


def choices(db, crypto, source_id):
    from app.services.inventory import bounded, q
    result = []
    for row in bounded(db, select(InHouseStock).order_by(InHouseStock.id)):
        record = crypto.open(row.id, "in_house_reserve", row.payload_ciphertext)
        from app.services.expiry_policy import usable
        if not usable(record):
            continue
        amount = balances(db, record).get(str(source_id), Decimal(0))
        if amount > 0:
            meta = metadata(record)
            result.append(dict(**meta, id=str(row.id), available=q(amount),
                name=f"{meta['productName']} · {meta['batchNo'] or 'Batch unavailable'} · In-house reserve"))
    return result


def calculate(amount, concentration, unit, factor, movement_date):
    """No binary float, rounding, legacy-unit inference or catalogue lookups."""
    from app.services.inventory import quantity, q
    if unit not in ("", "ml"):
        raise PRError("Dilution requires an explicit ml reserve. This legacy unit cannot be converted; choose No or use a supported reserve.", 422, "reserve_dilution_unit")
    if factor not in (2, 5, 10):
        raise PRError("Choose 2-fold, 5-fold or 10-fold dilution.", 422, "reserve_dilution_factor")
    if not re.fullmatch(r"(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?%?", concentration):
        raise PRError("Dilution requires a positive plain numeric concentration (up to three integer digits and six decimals), optionally followed by %. Choose No to transfer a descriptive reserve unchanged.", 422, "reserve_dilution_concentration")
    with localcontext() as ctx:
        ctx.prec = 40
        suffix = "%" if concentration.endswith("%") else ""
        original = Decimal(concentration[:-1] if suffix else concentration)
        if original <= 0 or (suffix and original > 100):
            raise PRError("Dilution requires a concentration above zero; explicit percentages cannot exceed 100%.", 422, "reserve_dilution_concentration")
        output = quantity(amount * factor)
        result = original / factor
        if result != result.quantize(Decimal(".000001")):
            raise PRError("Resulting concentration cannot be represented exactly to six decimals. Choose another approved factor; nothing was saved.", 422, "reserve_dilution_precision")
        if movement_date.year > 9997:
            raise PRError("Movement date cannot represent a two-year expiry. Choose an earlier date.", 422, "reserve_dilution_expiry")
        year = movement_date.year + 2
        expiry = date(year, movement_date.month, min(movement_date.day, calendar.monthrange(year, movement_date.month)[1]))
        rendered = format(result, "f")
        rendered = rendered.rstrip("0").rstrip(".") if "." in rendered else rendered
        return dict(resultingQuantity=q(output), resultingConcentration=rendered + suffix,
                    resultingExpiryDate=expiry.isoformat(), dilutionFactor=factor)


def review_line(db, crypto, body, line):
    from app.services.inventory import quantity, q
    from app.db.allergen_models import AllergenProduct
    row = db.get(InHouseStock, line.lotId)
    if not row:
        raise PRError("In-house reserve is unavailable. Refresh source balances.", 409, "reserve_missing")
    record = crypto.open(row.id, "in_house_reserve", row.payload_ciphertext)
    from app.services.expiry_policy import require_usable
    require_usable(record)
    product = db.get(AllergenProduct, uuid.UUID(record["allergenId"]))
    if not product or product.deleted_at or product.status != "active":
        raise PRError("This reserve's allergen is no longer active. Select an available active allergen batch.", 409, "inventory_product")
    amounts = balances(db, record)
    src, dst = amounts.get(str(body.sourceId), Decimal(0)), amounts.get(str(body.destinationId), Decimal(0))
    amount = quantity(line.quantity)
    if amount <= 0 or amount > src:
        raise PRError("Available reserve stock changed. Review your retained draft again.", 409, "inventory_insufficient")
    meta = metadata(record)
    result = calculate(amount, record["concentration"], record["unit"], line.dilutionFactor, body.date) if line.dilute else dict(
        resultingQuantity=q(amount), resultingConcentration=record["concentration"],
        resultingExpiryDate=record["expiryDate"], dilutionFactor=None)
    if not line.dilute:
        quantity(dst + amount)
    return dict(**meta, **result, lotId=str(row.id), quantity=q(amount),
        sourceBefore=q(src), sourceAfter=q(src - amount),
        destinationBefore="0.000" if line.dilute else q(dst),
        destinationAfter=result["resultingQuantity"] if line.dilute else q(dst + amount),
        productVersion=product.version)


def commit_line(db, crypto, current, body, line, mid):
    from app.services.inventory import Lot, post
    from app.services.expiry_policy import require_usable
    reserve = db.get(InHouseStock, uuid.UUID(line["reserveId"]))
    require_usable(crypto.open(reserve.id, "in_house_reserve", reserve.payload_ciphertext))
    amount = Decimal(line["quantity"])
    db.add(InHousePosting(reserve_id=uuid.UUID(line["reserveId"]), movement_id=mid, location_id=body.sourceId,
        delta=-amount, before=Decimal(line["sourceBefore"]), after=Decimal(line["sourceAfter"])))
    if not line["dilutionFactor"]:
        db.add(InHousePosting(reserve_id=uuid.UUID(line["reserveId"]), movement_id=mid, location_id=body.destinationId,
            delta=amount, before=Decimal(line["destinationBefore"]), after=Decimal(line["destinationAfter"])))
        return
    lid = uuid.uuid5(mid, line["reserveId"])
    line["destinationLotId"] = str(lid)
    meta = {**line, "source": "in_house_dilution", "sourceKind": "inventory", "reserveOnly": False,
        "sourceMovementId": str(mid), "concentration": line["resultingConcentration"],
        "expiryDate": line["resultingExpiryDate"], "unit": "ml"}
    for key in ("lotId", "quantity", "sourceBefore", "sourceAfter", "destinationBefore", "destinationAfter", "productVersion"):
        meta.pop(key, None)
    lot = Lot(id=lid, product_id=uuid.UUID(line["productId"]), reserve_movement_id=mid,
        origin_id=body.destinationId, accepted=Decimal(line["resultingQuantity"]),
        payload_ciphertext=crypto.seal(lid, "lot", meta))
    db.add(lot)
    db.flush()
    post(db, lot, body.destinationId, Decimal(line["resultingQuantity"]), f"dilution:{mid}", current, mid)
