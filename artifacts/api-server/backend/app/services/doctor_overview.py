"""Read-only MR summaries, bounded by the authorized Doctor page.

Counts/flags cover the entire persisted scope, not an order search page.
Only saved canonical monetary snapshots are inspected, never master prices.
"""
import re
from decimal import Decimal

from sqlalchemy import func, select

from app.db.immunotherapy_models import ImmunotherapyOrder
from app.db.kits_models import KitsOrder
from app.db.lupin_models import LupinOrder
from app.db.spt_models import SptOrder
from app.services import immunotherapy, kits, lupin, spt
from app.services.directory_inventory import DirectoryCryptoError
from app.services.directory_runtime import crypto_scope
from app.services.mr_orders import authorize, scope


# A page may have 100 Doctors. Never decrypt an unbounded order history.
# Counts still cover all matching rows when monetary inspection is unavailable.
MAX_SNAPSHOTS = 2000
DOMAINS = (
    ("immunotherapy", ImmunotherapyOrder, immunotherapy,
     frozenset({"Confirmed", "Approved", "In process", "Shipped"})),
    ("kits", KitsOrder, kits, frozenset({"Confirmed", "In process", "Shipped"})),
    ("spt", SptOrder, spt, None),
    ("lupin", LupinOrder, lupin, frozenset({"Confirmed", "Approved", "Shipped"})),
)


def minor_value(kind, snapshot):
    """None means genuinely unpriced; malformed saved prices are unavailable."""
    if not isinstance(snapshot, dict):
        raise ValueError("Invalid saved order snapshot")
    if kind == "immunotherapy":
        amount = snapshot.get("totalMinor")
        if amount is not None and (type(amount) is not int or amount < 0):
            raise ValueError("Invalid saved minor units")
        return amount
    if kind == "kits":
        price = snapshot.get("pricing")
        if price is None:
            return None
        amount = price["total"]
    else:
        amount = snapshot["total"]
    if not isinstance(amount, str) or not re.fullmatch(r"\d{1,24}\.\d{2}", amount):
        raise ValueError("Invalid saved decimal")
    return int(Decimal(amount) * 100)


def summaries(db, actor, doctor_ids):
    # Also establishes precisely the shared order-read authorization boundary.
    current = authorize(db, actor)
    if current.role != "mr" or current.mr.id != actor.mr.id:
        raise immunotherapy.ImmError("MR overview is unavailable.", 403, "access_denied")
    if not doctor_ids:
        return {}
    if len(doctor_ids) > 100:
        raise immunotherapy.ImmError("Doctor overview page is too large.", 422, "doctor_overview_bound")
    result = {identity: dict(
        orderCount=0, pendingFulfillment=0, fulfillmentUntracked=0,
        knownValueMinor="0", pricedOrders=0, unpricedOrders=0,
        valueAvailability="available", valueUnavailableReason=None,
        paymentFlags=dict(paid=0, unpaid=0, partial=0, notTracked=0),
        balanceAvailability="not_tracked", domains=[],
    ) for identity in doctor_ids}
    queries = []
    for kind, model, service, pending in DOMAINS:
        clauses = [model.doctor_id.in_(doctor_ids), *scope(db, model)]
        # SPT's Draft is an incomplete persisted editor, not a saved order.
        if kind == "spt":
            clauses.append(model.status == "Saved")
        columns = [model.doctor_id, model.status]
        if kind in {"kits", "lupin"}:
            columns.append(model.payment_status)
        grouped = db.execute(select(*columns, func.count()).where(*clauses).group_by(*columns))
        counts = {identity: dict(kind=kind, orderCount=0,
                                pendingFulfillment=None if pending is None else 0)
                  for identity in doctor_ids}
        for row in grouped:
            identity, status, count = row[0], row[1], row[-1]
            total = result[identity]
            total["orderCount"] += count
            counts[identity]["orderCount"] += count
            if pending is None:
                total["fulfillmentUntracked"] += count
            elif status in pending:
                total["pendingFulfillment"] += count
                counts[identity]["pendingFulfillment"] += count
            flag = row[2].lower() if kind in {"kits", "lupin"} else "notTracked"
            total["paymentFlags"][flag] += count
        for identity in doctor_ids:
            result[identity]["domains"].append(counts[identity])
        queries.append((kind, model, service, clauses))

    # One global budget prevents page-size-dependent fan-out. No prefix sum is
    # presented as complete if the page's monetary inspection cannot finish.
    if sum(item["orderCount"] for item in result.values()) > MAX_SNAPSHOTS:
        for item in result.values():
            if item["orderCount"]:
                unavailable(item, "scan_limit")
        return result
    seen = {identity: 0 for identity in doctor_ids}
    inspected = 0
    try:
        with crypto_scope(db) as keys:
            for kind, model, service, clauses in queries:
                rows = db.execute(select(model.id, model.doctor_id, model.snapshot_ciphertext)
                                  .where(*clauses).limit(MAX_SNAPSHOTS - inspected + 1)
                                  .execution_options(yield_per=25))
                for identity, doctor_id, ciphertext in rows:
                    inspected += 1
                    if inspected > MAX_SNAPSHOTS:
                        for item in result.values():
                            if item["orderCount"]:
                                unavailable(item, "scope_changed")
                        return result
                    seen[doctor_id] += 1
                    item = result[doctor_id]
                    if item["valueAvailability"] != "available":
                        continue
                    try:
                        snapshot = service.unseal(keys, "orders", identity, ciphertext)
                        amount = minor_value(kind, snapshot)
                        if amount is None:
                            item["unpricedOrders"] += 1
                        else:
                            item["pricedOrders"] += 1
                            item["knownValueMinor"] = str(int(item["knownValueMinor"]) + amount)
                    except (DirectoryCryptoError, ValueError, KeyError, TypeError):
                        unavailable(item, "snapshot_unreadable")
    except DirectoryCryptoError:
        for item in result.values():
            if item["orderCount"]:
                unavailable(item, "snapshot_unreadable")
    for identity, item in result.items():
        if item["valueAvailability"] == "available" and seen[identity] != item["orderCount"]:
            unavailable(item, "scope_changed")
    return result


def unavailable(item, reason):
    item.update(valueAvailability="unavailable", valueUnavailableReason=reason,
                knownValueMinor=None, pricedOrders=None, unpricedOrders=None)
