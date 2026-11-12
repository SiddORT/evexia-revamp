"""Atomic order-linked ml postings at explicit approval, not placement or shipping."""
import uuid
from collections import defaultdict
from decimal import Decimal
from sqlalchemy import select
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.inventory_models import InventoryLot as Lot, InventoryBalance as Balance, InventoryPosting as Posting
from app.db.location_models import StorageLocation
from app.services.immunotherapy import ImmError
from app.services.immunotherapy_material_pricing import POLICY, validate_saved
from app.services import inventory
from app.services.purchase_received_crypto import PRError
from app.services.expiry_policy import usable


def consume(db, actor, row, snapshot):
    if snapshot.get("pricingPolicy") != POLICY:
        return  # Historic/Admin compositions have no newly authorized recipe.
    if snapshot.get("materialConsumption"):
        raise ImmError("This order already has consumption evidence. No further stock was deducted.", 409, "imm_consumption_exists")
    validate_saved(snapshot)
    if snapshot["pricingEvidence"]["orderDate"] != row.date.isoformat():
        raise ImmError("Saved pricing date differs from the immutable order date. Ask Admin to reconcile; stock was not consumed.",
                       409, "imm_consumption_evidence")
    inventory.lock(db)
    source = f"it-approval:{row.id}"  # Same identity across all attempts/versions.
    if db.scalar(select(Posting.id).where(Posting.source_key == source).limit(1)):
        raise ImmError("Order consumption history already exists without matching order evidence. Ask Admin to reconcile; nothing was deducted.",
                       409, "imm_consumption_history")
    try:
        crypto = inventory.InventoryCrypto(get_settings(), db)
        required, materials = defaultdict(lambda: Decimal(0)), {}
        for group in snapshot["pricingEvidence"]["groups"]:
            for component in group["components"]:
                identity = uuid.UUID(component["materialId"])
                ml = Decimal(component["quantityMl"])
                if not ml.is_finite() or ml < 0 or ml > Decimal("1000000000") or ml != ml.quantize(Decimal(".01")):
                    raise ImmError("Saved material quantities are unreadable; approval has not consumed stock.", 409, "imm_consumption_evidence")
                required[identity] += ml
                materials[identity] = component["name"]
        if any(required.values()):
            inventory.require_complete(db)
        allocations, shortages = [], []
        for identity in sorted(required):
            need = required[identity]
            if not need:
                continue
            # Only allocated balances at usable saved locations, never reserve.
            statement = select(Balance, Lot, StorageLocation).join(Lot, Lot.id == Balance.lot_id).join(
                StorageLocation, StorageLocation.id == Balance.location_id).where(
                Lot.product_id == identity, Balance.quantity > 0,
                StorageLocation.deleted_at.is_(None), StorageLocation.status == "active"
            ).order_by(Lot.id, Balance.location_id, Balance.id).with_for_update()
            candidates = list(db.execute(statement.limit(inventory.LIMIT + 1)))
            if len(candidates) > inventory.LIMIT:
                raise ImmError(f"{materials[identity]} stock allocation exceeds the safe scope. Admin must narrow/reconcile lot history.",
                               409, "imm_stock_scope")
            eligible = []
            for balance, lot, location in candidates:
                meta = crypto.open(lot.id, "lot", lot.payload_ciphertext)
                if usable(meta):
                    eligible.append((meta["expiryDate"], str(lot.id), str(location.id), balance, lot, location, meta))
            eligible.sort(key=lambda entry: entry[:3])  # FEFO, deterministic tie-break.
            available = sum((inventory.quantity(entry[3].quantity) for entry in eligible), Decimal(0))
            if need > available:
                shortages.append(f"{materials[identity]}: required {inventory.q(need)} ml; allocated usable available {inventory.q(available)} ml")
                continue
            remaining = need
            for _, _, _, balance, lot, location, meta in eligible:
                if remaining <= 0:
                    break
                amount = min(remaining, balance.quantity)
                allocations.append((lot, location, amount, dict(
                    materialId=str(identity), name=materials[identity], lotId=str(lot.id),
                    locationId=str(location.id), locationName=location.name, quantityMl=inventory.q(amount),
                    batchNo=meta.get("batchNo"), expiryDate=meta["expiryDate"])))
                remaining -= amount
        if shortages:
            raise ImmError("Approval not applied; insufficient usable stock. " + "; ".join(shortages) +
                           ". Expired, expiry-today, unknown-expiry, Unallocated and reserve quantities cannot be consumed. No partial deductions were posted.",
                           409, "imm_stock_insufficient")
        evidence = []
        for lot, location, amount, allocation in allocations:
            balances = inventory.post(db, lot, location.id, -amount, source, actor)
            evidence.append({**allocation, **balances})
        snapshot["materialConsumption"] = dict(
            status="consumed", source=source, transitionVersion=row.version + 1,
            orderId=str(row.id), actorId=str(actor.user.id), at=utcnow().isoformat(), unit="ml",
            materials=[dict(materialId=str(identity), name=materials[identity], quantityMl=inventory.q(required[identity]))
                       for identity in sorted(required)], allocations=evidence)
    except PRError as error:
        raise ImmError(error.message, error.status, error.code) from None
