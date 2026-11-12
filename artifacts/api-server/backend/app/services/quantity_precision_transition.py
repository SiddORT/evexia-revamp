"""Forward precision conversion; invoked only by the coordinated Alembic revision.

All reads precede operational changes. Original ciphertext, immutable source rows
and postings are retained. Never call this from request/startup repair code.
"""
import copy
import json
import uuid
from collections import defaultdict
from decimal import Decimal
from sqlalchemy import text
from app.schemas.quantities import rounded_quantity, display_quantity, quantity_string
from app.schemas.rates import rate
from app.services.quantity_precision_plan import plan_inventory_boundary, historical, PrecisionPlanError
from app.services.quantity_precision import source_digest, POLICY

BOUNDARY_ID = uuid.UUID("00000000-0000-4000-8000-000000000092")
LIMIT = 100000


def rows(connection, table, order="id"):
    # Table/order identifiers below are source literals, never operator input.
    result = connection.execute(text(f"SELECT * FROM {table} ORDER BY {order} LIMIT {LIMIT + 1}")).mappings().all()
    if len(result) > LIMIT:
        raise PrecisionPlanError(f"{table} exceeds the bounded conversion scope; no conversion was committed.")
    return result


def normalized(purpose, original):
    value = copy.deepcopy(original)
    if purpose == "inventory:product":
        for member in value["members"]:
            member["quantity"] = quantity_string(member["quantity"], positive=True)
    elif purpose == "inventory:opening":
        value["quantity"] = display_quantity(Decimal(value["quantity"]))
        value["openingValue"] = display_quantity(Decimal(value["quantity"]) * Decimal(value["unitRate"]))
        for field in ("before", "after"):
            if field in value:
                value[field] = display_quantity(Decimal(value[field]))
    elif purpose == "inventory:in_house_reserve":
        value["quantity"] = display_quantity(historical(value["quantity"]))
    elif purpose == "receipt":
        for line in value["lines"]:
            raw_received, raw_accepted = historical(line["receivedQty"]), historical(line["acceptedQty"])
            if raw_received <= 0 or raw_accepted > raw_received or historical(line["rejectedQty"]) != raw_received - raw_accepted:
                raise PrecisionPlanError("A retained receipt has inconsistent original quantity evidence.")
            # Historical zero-after-rounding is evidence, not a new receipt.
            line["receivedQty"] = display_quantity(raw_received)
            line["acceptedQty"] = display_quantity(raw_accepted)
            line["rejectedQty"] = display_quantity(Decimal(line["receivedQty"]) - Decimal(line["acceptedQty"]))
            line["orderedQty"] = display_quantity(historical(line["orderedQty"]))
            if line.get("balanceAfterQty") is not None:
                line["balanceAfterQty"] = display_quantity(historical(line["balanceAfterQty"]))
    elif purpose == "inventory:batch_cost":
        value["unitCost"] = rate(value["unitCost"], Decimal("999999999.99"))
    return value


def prepare(connection):
    """Locked, complete preflight. The caller's transaction owns all DDL/writes."""
    from app.core.config import get_settings
    from app.services.inventory import InventoryCrypto
    from app.services.purchase_received_crypto import ReceiptCrypto
    from app.services.directory_crypto import DirectoryCrypto
    from app.services.immunotherapy import unseal, seal
    settings = get_settings()
    inventory_crypto, receipt_crypto = InventoryCrypto(settings), ReceiptCrypto(settings)
    for key in (145573, 145579):
        connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
    tables = (
        "purchase_orders", "purchase_order_lines", "purchase_receipts", "purchase_receipt_sources",
        "inventory_lots", "inventory_balances", "inventory_postings", "inventory_receipt_states",
        "inventory_movements", "inventory_adjustments", "in_house_stock", "in_house_postings",
        "opening_stock", "combo_products", "combo_product_revisions", "combo_product_members",
        "product_assemblies", "immunotherapy_orders", "immunotherapy_extract_settings",
        "allergen_products", "inventory_batch_costs", "inventory_expiry_disposals",
    )
    # PostgreSQL rejects an unavailable predecessor schema rather than skipping a
    # dependency or treating missing rows as an empty installation.
    connection.execute(text("LOCK TABLE " + ",".join(tables) + " IN ACCESS EXCLUSIVE MODE"))
    raw_lots = rows(connection, "inventory_lots")
    raw_balances = rows(connection, "inventory_balances", "id")
    raw_postings = rows(connection, "inventory_postings", "created_at,id")
    movements = {str(r["id"]): (r, inventory_crypto.open(r["id"], "movement", r["payload_ciphertext"]))
                 for r in rows(connection, "inventory_movements")}
    source_documents = {}
    source_times = {}
    snapshots = []

    def archive(purpose, identity, raw, value, crypto, field):
        projected = normalized(purpose, value)
        snapshots.append(dict(purpose=purpose, record_id=identity, original_digest=source_digest(raw),
                              original_ciphertext=raw, normalized_ciphertext=crypto.seal(identity, field, projected)))
        return projected

    for table, field in (
        ("opening_stock", "opening"), ("combo_products", "product"),
        ("in_house_stock", "in_house_reserve"), ("inventory_batch_costs", "batch_cost"),
    ):
        for row in rows(connection, table):
            value = inventory_crypto.open(row["id"], field, row["payload_ciphertext"])
            source_documents[(field, str(row["id"]))] = value
            archive("inventory:" + field, row["id"], row["payload_ciphertext"], value, inventory_crypto, field)
    for table, field in (
        ("product_assemblies", "assembly"), ("inventory_adjustments", "adjustment"),
        ("inventory_expiry_disposals", "expiry_disposal"),
    ):
        for row in rows(connection, table):
            source_documents[(field, str(row["id"]))] = inventory_crypto.open(row["id"], field, row["payload_ciphertext"])
            source_times[(field, str(row["id"]))] = row["created_at"]

    receipts = {}
    states = {r["receipt_id"]: r["version"] for r in rows(connection, "inventory_receipt_states", "receipt_id")}
    for row in rows(connection, "purchase_receipts"):
        original = receipt_crypto.open(row["id"], "receipt", row["payload_ciphertext"])
        if states.get(row["id"]) != row["version"] or original["version"] != row["version"] or original["status"] != row["status"]:
            raise PrecisionPlanError("Receipt initialization or retained version evidence is incomplete.")
        projected = archive("receipt", row["id"], row["payload_ciphertext"], original, receipt_crypto, "receipt")
        receipts[str(row["id"])] = (original, projected)

    # PO snapshots are plaintext in their original historical contract. Preserve
    # a separately encrypted original; only the explicit operational quantity is
    # converted. Issued document revisions and saved paise financial totals stay.
    po_quantities = {}
    po_lines = rows(connection, "purchase_order_lines")
    for row in po_lines:
        snapshot = row["snapshot"]
        amount = display_quantity(historical(str(snapshot["quantity"])))
        po_quantities[str(row["id"])] = Decimal(amount)
        raw = json.dumps(snapshot, sort_keys=True, separators=(",", ":"))
        projected = {**snapshot, "quantity": amount}
        snapshots.append(dict(purpose="po_line", record_id=row["id"], original_digest=source_digest(raw),
                              original_ciphertext=inventory_crypto.seal(row["id"], "po_line_original", snapshot),
                              normalized_ciphertext=inventory_crypto.seal(row["id"], "po_line", projected)))
    accepted_by_line = defaultdict(lambda: Decimal(0))
    for original, projected in receipts.values():
        if original["status"] == "active":
            for line in projected["lines"]:
                if line["lineId"] not in po_quantities:
                    raise PrecisionPlanError("A receipt has no retained PO line.")
                accepted_by_line[line["lineId"]] += Decimal(line["acceptedQty"])
    if any(amount > po_quantities[line] for line, amount in accepted_by_line.items()):
        raise PrecisionPlanError("Rounded receipt acceptance exceeds its PO capacity; explicitly reconcile the source receipts before conversion.")

    # Authenticate keys only if directory-encrypted configuration/orders exist.
    extract_rows = rows(connection, "immunotherapy_extract_settings", "category_id")
    order_rows = rows(connection, "immunotherapy_orders")
    directory_keys = DirectoryCrypto(settings) if extract_rows or order_rows else None
    order_consumption = {}
    for row in order_rows:
        saved = unseal(directory_keys, "orders", row["id"], row["snapshot_ciphertext"])
        if not saved.get("materialConsumption") and saved.get("status") in ("Draft", "Saved"):
            for group in saved.get("groups", []):
                for item in group.get("items", []):
                    for field in ("extract", "dilution"):
                        original = item.get(field)
                        if original is not None and Decimal(original) != rounded_quantity(Decimal(original)):
                            raise PrecisionPlanError("A pending order contains historical ml precision; explicitly review and save its canonical material quantities before conversion.")
        consumed = saved.get("materialConsumption")
        if consumed:
            order_consumption[str(row["id"])] = consumed
        if not consumed and saved.get("pricingPolicy") == "configured_material_ml_v1":
            for group in (saved.get("pricingEvidence") or {}).get("groups", []):
                if any(Decimal(c["quantityMl"]) != rounded_quantity(Decimal(c["quantityMl"])) for c in group["components"]):
                    raise PrecisionPlanError("A pending configured-price order retains higher-precision consumption. Explicitly re-quote it with two-place settings before conversion.")
    for row in extract_rows:
        original = unseal(directory_keys, "extract-settings", row["category_id"], row["payload_ciphertext"])
        projected = copy.deepcopy(original)

        def pairs(value):
            if isinstance(value, list):
                for entry in value:
                    pairs(entry)
            elif isinstance(value, dict):
                for field, child in value.items():
                    if field == "legacyRows":
                        continue  # Unapplied historical configuration is evidence.
                    if field in ("extract", "dilution") and child is not None:
                        value[field] = quantity_string(child, maximum=Decimal("999999.999999"))
                    else:
                        pairs(child)
        if isinstance(projected, dict):
            pairs(projected)
        snapshots.append(dict(purpose="extract-settings", record_id=row["category_id"],
                              original_digest=source_digest(row["payload_ciphertext"]),
                              original_ciphertext=row["payload_ciphertext"],
                              normalized_ciphertext=seal(directory_keys, "extract-settings", row["category_id"], projected)))

    lot_data = []
    for row in raw_lots:
        metadata = inventory_crypto.open(row["id"], "lot", row["payload_ciphertext"])
        if str(row["product_id"] or row["combo_id"]) != metadata["productId"]:
            raise PrecisionPlanError("A retained lot has inconsistent material identity.")
        lot_data.append(dict(id=str(row["id"]), accepted=row["accepted"], whole=row["combo_id"] is not None,
                             **{field: str(row[column]) if row[column] else None for field, column in (
                                 ("receiptId", "receipt_id"), ("openingId", "opening_id"), ("assemblyId", "assembly_id"),
                                 ("adjustmentId", "adjustment_id"), ("reserveMovementId", "reserve_movement_id"))}))
        if row["receipt_id"]:
            original, _ = receipts.get(str(row["receipt_id"]), (None, None))
            line = next((l for l in original["lines"] if l["lineId"] == str(row["line_id"])), None) if original else None
            expected = Decimal(line["acceptedQty"]) if line and original["status"] == "active" else Decimal(0)
            if not original or row["accepted"] != expected:
                raise PrecisionPlanError("Receipt acceptance does not match its retained source lot.")
    by_lot = {r["id"]: r for r in raw_lots}
    for posting in raw_postings:
        prefix, _, identity = posting["source_key"].partition(":")
        identity = identity.split(":")[0]
        lot = by_lot[posting["lot_id"]]
        if prefix in ("move", "dilution"):
            movement, saved = movements.get(identity, (None, None))
            if not movement or posting["movement_id"] != movement["id"]:
                raise PrecisionPlanError("A posting has no authenticated movement.")
            field = "destinationLotId" if prefix == "dilution" else "lotId"
            line = next((l for l in saved["lines"] if l.get(field) == str(lot["id"])), None)
            if not line:
                raise PrecisionPlanError("A movement is missing retained lot membership.")
            expected = Decimal(line["resultingQuantity"] if prefix == "dilution" else line["quantity"])
            if posting["location_id"] not in (movement["source_id"], movement["destination_id"]):
                raise PrecisionPlanError("A movement posting uses an unrelated location.")
            if prefix == "move" and posting["location_id"] == movement["source_id"]:
                expected = -expected
            if posting["delta"] != expected:
                raise PrecisionPlanError("Movement quantities differ from their immutable postings.")
        elif prefix == "it-approval":
            saved = order_consumption.get(identity)
            allocation = next((a for a in saved["allocations"] if a["lotId"] == str(lot["id"])
                               and a["locationId"] == str(posting["location_id"])), None) if saved else None
            if not allocation or posting["delta"] != -Decimal(allocation["quantityMl"]):
                raise PrecisionPlanError("Order-linked consumption evidence is unavailable or inconsistent.")
        elif prefix in ("opening", "assembly", "adjustment", "disposal"):
            field = {"opening": "opening", "assembly": "assembly", "adjustment": "adjustment", "disposal": "expiry_disposal"}[prefix]
            if (field, identity) not in source_documents:
                raise PrecisionPlanError("A posting's immutable source document is unavailable.")
            saved = source_documents[(field, identity)]
            if prefix == "opening":
                if posting["delta"] != Decimal(saved["quantity"]) or lot["opening_id"] != uuid.UUID(identity):
                    raise PrecisionPlanError("Opening quantity differs from its immutable source.")
            elif prefix == "adjustment":
                expected = Decimal(saved["quantity"]) * (1 if saved["direction"] == "add" else -1)
                if posting["delta"] != expected or posting["before"] != Decimal(saved["before"]) or posting["after"] != Decimal(saved["after"]):
                    raise PrecisionPlanError("Adjustment quantities differ from immutable evidence.")
            elif prefix == "assembly":
                if lot["assembly_id"] == uuid.UUID(identity):
                    expected = Decimal(saved["quantity"])
                else:
                    component = next((c for c in saved["components"] if c["lotId"] == str(lot["id"])), None)
                    if not component:
                        raise PrecisionPlanError("Assembly component provenance is missing.")
                    expected = -Decimal(component["quantity"])
                if posting["delta"] != expected:
                    raise PrecisionPlanError("Assembly quantities differ from immutable evidence.")
            elif saved["sourceKind"] != "lot" or saved["batchId"] != str(lot["id"]) or posting["delta"] != -Decimal(saved["quantity"]):
                raise PrecisionPlanError("Disposal quantity differs from its immutable batch evidence.")
    plan = plan_inventory_boundary(
        lot_data,
        [dict(id=str(r["id"]), lotId=str(r["lot_id"]), locationId=str(r["location_id"]) if r["location_id"] else None,
              quantity=r["quantity"]) for r in raw_balances],
        [dict(id=str(r["id"]), lotId=str(r["lot_id"]), locationId=str(r["location_id"]) if r["location_id"] else None,
              at=r["created_at"].isoformat(), before=r["before"], delta=r["delta"], after=r["after"],
              source=r["source_key"], movementId=str(r["movement_id"]) if r["movement_id"] else None) for r in raw_postings],
        dependencies_complete=True)
    locations = [dict(kind="inventory", owner_id=uuid.UUID(r["lotId"]), location_key=r["locationId"] or "",
                      original=Decimal(r["original"]), normalized=Decimal(r["normalized"]), residual=Decimal(r["residual"]))
                 for r in plan["balances"]]
    locations.extend(dict(kind="source", owner_id=uuid.UUID(r["lotId"]), location_key="",
                          original=Decimal(r["originalAccepted"]), normalized=Decimal(r["normalizedAccepted"]),
                          residual=Decimal(r["acceptedResidual"])) for r in plan["sources"])

    reserve_postings = rows(connection, "in_house_postings")
    reserve_movements = defaultdict(list)
    for posting in reserve_postings:
        if posting["movement_id"]:
            reserve_movements[(posting["reserve_id"], posting["movement_id"])].append(posting)
    for (reserve_id, movement_id), legs in reserve_movements.items():
        movement, saved = movements.get(str(movement_id), (None, None))
        line = next((l for l in saved["lines"] if l.get("reserveId") == str(reserve_id)), None) if saved else None
        if not line:
            raise PrecisionPlanError("Reserve movement source membership is unavailable.")
        if line.get("dilutionFactor"):
            output = next((l for l in raw_lots if str(l["id"]) == line.get("destinationLotId")), None)
            if (len(legs) != 1 or legs[0]["location_id"] != movement["source_id"]
                    or not output or output["reserve_movement_id"] != movement_id
                    or output["origin_id"] != movement["destination_id"]
                    or output["accepted"] != Decimal(line["quantity"]) * Decimal(line["dilutionFactor"])):
                raise PrecisionPlanError("Reserve dilution does not conserve its reviewed input/output factor.")
        elif (len(legs) != 2 or sum((p["delta"] for p in legs), Decimal(0)) != 0
              or {p["location_id"] for p in legs} != {movement["source_id"], movement["destination_id"]}):
            raise PrecisionPlanError("Reserve transfer is missing its conserved opposite leg.")
    for (purpose, identity), saved in source_documents.items():
        if purpose != "in_house_reserve":
            continue
        amounts = defaultdict(lambda: Decimal(0), {saved["locationId"]: historical(saved["quantity"])})
        selected = [p for p in reserve_postings if str(p["reserve_id"]) == identity]
        def recorded_at(posting):
            if posting["movement_id"]:
                entry = movements.get(str(posting["movement_id"]))
                if not entry:
                    raise PrecisionPlanError("Reserve movement evidence is unavailable.")
                return entry[0]["created_at"], str(posting["id"])
            key = ("expiry_disposal", str(posting["disposal_id"]))
            if key not in source_times:
                raise PrecisionPlanError("Reserve disposal recorded time is unavailable.")
            return source_times[key], str(posting["id"])
        for posting in sorted(selected, key=recorded_at):
                if amounts[str(posting["location_id"])] != posting["before"]:
                    raise PrecisionPlanError("Reserve history has a missing or out-of-order before/after chain.")
                if posting["after"] != posting["before"] + posting["delta"] or posting["after"] < 0:
                    raise PrecisionPlanError("Reserve chain arithmetic is inconsistent.")
                if posting["movement_id"]:
                    movement, document = movements[str(posting["movement_id"])]
                    line = next((l for l in document["lines"] if l.get("reserveId") == identity), None)
                    if not line:
                        raise PrecisionPlanError("Reserve movement membership is unavailable.")
                    source = posting["location_id"] == movement["source_id"]
                    expected = Decimal(line["quantity"]) * (-1 if source else 1)
                    if posting["delta"] != expected or not source and line.get("dilutionFactor"):
                        raise PrecisionPlanError("Reserve transfer/conversion differs from its original source.")
                else:
                    disposal = source_documents[("expiry_disposal", str(posting["disposal_id"]))]
                    if disposal["sourceKind"] != "reserve" or disposal["batchId"] != identity or posting["delta"] != -Decimal(disposal["quantity"]):
                        raise PrecisionPlanError("Reserve disposal differs from retained evidence.")
                amounts[str(posting["location_id"])] = posting["after"]
        for location, amount in amounts.items():
            result = rounded_quantity(amount)
            locations.append(dict(kind="reserve", owner_id=uuid.UUID(identity), location_key=location,
                                  original=amount, normalized=result, residual=result - amount))

    thresholds = []
    for row in rows(connection, "allergen_products"):
        if row["threshold_limit"] is not None:
            old = row["threshold_limit"]
            new = Decimal(rate(format(old, "f")))
            thresholds.append((row["id"], old, new))
    report = dict(inventory=plan, checkpoints=locations,
                  snapshotDigests=[dict(purpose=r["purpose"], recordId=str(r["record_id"]), originalDigest=r["original_digest"]) for r in snapshots],
                  thresholds=[dict(allergenId=str(identity), original=old, normalized=new, residual=new-old) for identity, old, new in thresholds])
    digest = source_digest(json.dumps(report, sort_keys=True, separators=(",", ":"), default=str))
    return dict(plan=plan, locations=locations, snapshots=snapshots, thresholds=thresholds, digest=digest,
                evidence=inventory_crypto.seal(BOUNDARY_ID, "quantity_precision", report))


def apply(connection, prepared):
    """Only called after the entire preflight succeeded, within its same locks."""
    from app.core.security import utcnow
    connection.execute(text("""
        INSERT INTO quantity_precision_boundary(id,policy,created_at,evidence_digest,payload_ciphertext)
        VALUES(1,:policy,:at,:digest,:payload)
    """), dict(policy=POLICY, at=utcnow(), digest=prepared["digest"], payload=prepared["evidence"]))
    for row in prepared["locations"]:
        connection.execute(text("""
            INSERT INTO quantity_precision_locations(id,kind,owner_id,location_key,original,normalized,residual)
            VALUES(:id,:kind,:owner_id,:location_key,:original,:normalized,:residual)
        """), {"id": uuid.uuid4(), **row})
    for row in prepared["snapshots"]:
        connection.execute(text("""
            INSERT INTO quantity_precision_snapshots(purpose,record_id,original_digest,original_ciphertext,normalized_ciphertext)
            VALUES(:purpose,:record_id,:original_digest,:original_ciphertext,:normalized_ciphertext)
        """), row)
    # Only mutable current location balances change. No historical posting, lot,
    # opening, reserve, assembly, adjustment, document or payment is edited.
    for row in prepared["plan"]["balances"]:
        connection.execute(text("UPDATE inventory_balances SET quantity=:quantity WHERE id=:id"),
                           {"quantity": Decimal(row["normalized"]), "id": uuid.UUID(row["balanceId"])})
    for identity, old, new in prepared["thresholds"]:
        connection.execute(text("""
            INSERT INTO quantity_precision_thresholds(allergen_id,original,normalized,residual)
            VALUES(:id,:old,:new,:residual)
        """), {"id": identity, "old": old, "new": new, "residual": new - old})
        if old != new:
            connection.execute(text("UPDATE allergen_products SET threshold_limit=:new,version=version+1 WHERE id=:id"), {"id": identity, "new": new})
