"""Reviewed physical stock initialization in the one authoritative ledger."""
import uuid
from decimal import Decimal
from sqlalchemy import select
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.opening_stock_models import OpeningStock as Opening, OpeningStockRequest as Retry
from app.db.inventory_models import InventoryLot as Lot
from app.db.allergen_models import AllergenProduct
from app.db.product_models import ComboProduct
from app.db.location_models import StorageLocation
from app.services import inventory as inv
from app.services.purchase_received_crypto import PRError
from app.services.zones import label

HISTORY = "Pre-system batch, expiry, receipt and assembly history unavailable; no historical values inferred."
SCOPE = ("All matching committed opening records, not current stock or sales revenue. Opening value is exact "
         "original quantity × retained two-place unit rate (up to five decimal places), not an accounting valuation. "
         "Quantities/values grouped by item, established unit and original location; movements never rewrite openings.")


def value(quantity, rate):
    return format(Decimal(quantity) * Decimal(rate), ".5f")


def summary(records):
    groups = {}
    sources = set()
    for row in records:
        if row.get("mode") == "import":
            sources.add(row["sourceId"])
        key = (row["itemKind"], row["itemId"], row["unit"], row["locationId"])
        if key not in groups:
            groups[key] = dict(itemKind=row["itemKind"], itemId=row["itemId"],
                productName=row["productName"], unit=row["unit"], locationId=row["locationId"],
                locationName=row["location"]["name"], quantity="0.000", openingValue="0.00000")
        group = groups[key]
        group["quantity"] = inv.q(Decimal(group["quantity"]) + Decimal(row["quantity"]))
        group["openingValue"] = format(Decimal(group["openingValue"]) + Decimal(row["openingValue"]), ".5f")
    return dict(records=len(records), imports=len(sources), breakdown=list(groups.values()), scope=SCOPE)


def catalogue(db, crypto):
    allergens = inv.bounded(db, select(AllergenProduct).where(
        AllergenProduct.deleted_at.is_(None), AllergenProduct.status == "active").order_by(AllergenProduct.id))
    products = inv.bounded(db, select(ComboProduct).where(
        ComboProduct.deleted_at.is_(None), ComboProduct.status == "active").order_by(ComboProduct.id))
    result = [dict(id=str(r.id), itemKind="allergen", name=f"{r.name} · {r.concentration}",
                   unit="procurement quantity units", version=r.version) for r in allergens]
    result += [dict(id=str(r.id), itemKind="combo", name=crypto.open(r.id, "product", r.payload_ciphertext)["name"],
                    unit="whole combos", version=r.version) for r in products]
    if len(result) > inv.LIMIT:
        raise PRError("Combined eligible catalogue exceeds the finite 2000-item bound.", 422, "opening_scope")
    return result


def references(db, actor, query="", offset=0, limit=25):
    def work(_, crypto):
        rows = [r for r in catalogue(db, crypto) if query.strip().casefold() in
                f"{r['name']} {r['itemKind']} {r['id']}".casefold()]
        return dict(items=rows[offset:offset + limit], filtered=len(rows), offset=offset, limit=limit)
    return inv.transaction(db, actor, work)


def existing(db, row):
    return db.scalar(select(Opening).where(Opening.source_id == row.sourceId, Opening.row_id == row.rowId))


def same_input(saved, row):
    return all(saved[k] == row.model_dump(mode="json")[k] for k in
               ("sourceId", "rowId", "itemKind", "itemId", "unitRate", "locationId")) and \
        Decimal(saved["quantity"]) == Decimal(row.quantity)


def review_row(db, crypto, row, recorded_date):
    old = existing(db, row)
    if old:
        saved = crypto.open(old.id, "opening", old.payload_ciphertext)
        if not same_input(saved, row):
            raise PRError("This source/row identity is already posted with different values. It cannot be reused.", 409, "opening_source_conflict")
        # Backups retain their recorded date; re-upload cannot relabel it.
        fields = {k: saved[k] for k in ("productName", "unit", "location", "itemVersion", "openingValue")}
        return {**row.model_dump(mode="json"), **fields,
                "quantity": inv.q(Decimal(row.quantity)), "state": "already_imported"}
    model = ComboProduct if row.itemKind == "combo" else AllergenProduct
    item = db.scalar(select(model).where(model.id == row.itemId).with_for_update())
    if not item or item.deleted_at or item.status != "active":
        raise PRError("Item ID/type must resolve to an existing active eligible item.", 409, "opening_item")
    name = crypto.open(item.id, "product", item.payload_ciphertext)["name"] if row.itemKind == "combo" else f"{item.name} · {item.concentration}"
    if row.locationId is None:
        location = inv.unallocated_snapshot()
    else:
        target = db.scalar(select(StorageLocation).where(StorageLocation.id == row.locationId).with_for_update())
        if not target or target.deleted_at or target.status != "active":
            raise PRError("Storage location ID must resolve to an active location, or be blank for Unallocated.", 409, "opening_location")
        location = inv.location_snapshot(target)
    return {**row.model_dump(mode="json"), "quantity": inv.q(Decimal(row.quantity)),
        "productName": name, "unit": "whole combos" if row.itemKind == "combo" else "procurement quantity units",
        "itemVersion": item.version, "location": location, "openingValue": value(row.quantity, row.unitRate),
        "state": "ready" if Decimal(row.quantity) > 0 else "skipped"}


def review_data(db, crypto, body):
    rows = [review_row(db, crypto, row, body.recordedDate) for row in body.rows]
    snapshot = dict(rows=rows, recordedDate=body.recordedDate.isoformat(), mode=body.mode)
    return dict(rows=rows, reviewToken=crypto.digests(["opening-review:v1", snapshot])[crypto.active],
                summary=summary([{**r, "mode": body.mode} for r in rows if r["state"] == "ready"]))


def preview(db, actor, body):
    return inv.transaction(db, actor, lambda _, c: review_data(db, c, body))


def create(db, actor, body):
    def work(current, crypto):
        hashes = crypto.digests(["opening-request:v1", body.model_dump(mode="json")])
        retry = db.get(Retry, body.idempotencyKey)
        if retry:
            if retry.actor_id != current.user.id or retry.digest not in hashes.values():
                raise PRError("Request identity is closed or conflicts; reconcile before another save.", 409, "opening_retry")
            return crypto.open(retry.key, "opening_retry", retry.payload_ciphertext)
        review = review_data(db, crypto, body)
        snapshot = dict(rows=review["rows"], recordedDate=body.recordedDate.isoformat(), mode=body.mode)
        if body.reviewToken not in crypto.digests(["opening-review:v1", snapshot]).values():
            raise PRError("References or imported rows changed. Review your preserved draft again.", 409, "opening_review_stale")
        records, posted, already = [], 0, 0
        for row, reviewed in zip(body.rows, review["rows"]):
            if reviewed["state"] == "skipped":
                continue
            if reviewed["state"] == "already_imported":
                old = existing(db, row)
                records.append(crypto.open(old.id, "opening", old.payload_ciphertext))
                already += 1
                continue
            now, oid, lid = utcnow(), uuid.uuid4(), uuid.uuid4()
            actor_name = label(db, current.user.id)
            event = AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                action="opening_stock_imported" if body.mode == "import" else "opening_stock_created",
                resource_type="opening_stock", resource_id=oid, outcome="success",
                request_id=db.info.get("request_id"), created_at=now)
            db.add(event)
            db.flush()
            data = dict(**reviewed, id=str(oid), lotId=str(lid), recordedDate=body.recordedDate.isoformat(),
                mode=body.mode, createdAt=now.isoformat(), actor=actor_name, actorId=str(current.user.id),
                source="opening", appendOnly=True, before="0.000", after=reviewed["quantity"], historicalData=HISTORY,
                activity=[dict(action="opening_stock_imported" if body.mode == "import" else "opening_stock_created",
                    at=now.isoformat(), actor=actor_name, requestId=db.info.get("request_id"))])
            db.add(Opening(id=oid, source_id=row.sourceId, row_id=row.rowId, actor_id=current.user.id,
                event_id=event.id, created_at=now, payload_ciphertext=crypto.seal(oid, "opening", data)))
            db.flush()
            meta = dict(itemKind=row.itemKind, source="opening", openingId=str(oid),
                productId=str(row.itemId), productName=reviewed["productName"], unit=reviewed["unit"],
                unitRate=row.unitRate, openingValue=reviewed["openingValue"],
                openingLocation=reviewed["location"], recordedDate=body.recordedDate.isoformat(),
                batchNo=None, expiryDate=None, receiptId=None, receiptNumber=None, lineId=None,
                receivedDate=None, originalCreatedAt=now.isoformat(), historicalData=HISTORY,
                originLocationId=str(row.locationId) if row.locationId else None,
                originLocationName=reviewed["location"]["name"])
            lot = Lot(id=lid, opening_id=oid, product_id=row.itemId if row.itemKind == "allergen" else None,
                combo_id=row.itemId if row.itemKind == "combo" else None, origin_id=row.locationId,
                accepted=Decimal(row.quantity), payload_ciphertext=crypto.seal(lid, "lot", meta))
            db.add(lot)
            db.flush()
            inv.post(db, lot, row.locationId, Decimal(row.quantity), f"opening:{oid}", current)
            records.append(data)
            posted += 1
        result = dict(records=records, summary=summary(records), postedCount=posted, alreadyImportedCount=already)
        db.add(Retry(key=body.idempotencyKey, actor_id=current.user.id, digest=hashes[crypto.active],
            payload_ciphertext=crypto.seal(body.idempotencyKey, "opening_retry", result)))
        return result
    return inv.transaction(db, actor, work)


def reconcile(db, actor, key):
    def work(current, crypto):
        row = db.get(Retry, key)
        if row and row.actor_id != current.user.id:
            raise PRError("Request belongs to a different actor.", 403, "opening_retry_owner")
        if not row:
            db.add(Retry(key=key, actor_id=current.user.id, digest="cancelled",
                payload_ciphertext=crypto.seal(key, "opening_retry", None)))
        return dict(state="committed" if row and row.digest != "cancelled" else "not_committed",
                    result=crypto.open(key, "opening_retry", row.payload_ciphertext) if row else None)
    return inv.transaction(db, actor, work)


def matching(db, crypto, query=""):
    rows = inv.bounded(db, select(Opening).order_by(Opening.created_at.desc(), Opening.id))
    data = [crypto.open(r.id, "opening", r.payload_ciphertext) for r in rows]
    term = query.strip().casefold()
    return [r for r in data if term in " ".join((r["productName"], r["itemKind"], r["itemId"],
            r["location"]["name"], r["actor"], r["recordedDate"], r["id"])).casefold()], len(data)


def listing(db, actor, query="", offset=0, limit=25):
    def work(_, crypto):
        rows, total = matching(db, crypto, query)
        return dict(items=rows[offset:offset + limit], filtered=len(rows), total=total,
                    offset=offset, limit=limit, summary=summary(rows))
    return inv.transaction(db, actor, work)


def detail(db, actor, record_id, section=None):
    def work(_, crypto):
        row = db.get(Opening, record_id)
        if not row:
            raise PRError("Opening stock record not found.", 404, "opening_not_found")
        data = crypto.open(row.id, "opening", row.payload_ciphertext)
        if section == "analytics":
            return summary([data])
        if section == "activity":
            return dict(items=data["activity"], filtered=len(data["activity"]))
        return data
    return inv.transaction(db, actor, work)
