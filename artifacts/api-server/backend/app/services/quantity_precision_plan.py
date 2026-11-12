"""Pure, unconnected preparation for a stock precision boundary.

This is NOT an Alembic migration or an operational reader. It performs no I/O.
The eventual locked migration must supply authenticated, complete source data,
retain this plan as evidence, and implement all dependency checks listed in the
handoff before changing any balance. A plan alone does not authorize activation.
"""
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import json

from app.schemas.quantities import rounded_quantity

ZERO = Decimal("0")
MAXIMUM = Decimal("1000000")


class PrecisionPlanError(ValueError):
    """A missing or inconsistent source is not permission to estimate stock."""


def historical(value, *, signed=False):
    """Authenticate old exact thousandths; do not round them while validating."""
    if not isinstance(value, (str, Decimal, int)) or isinstance(value, bool):
        raise PrecisionPlanError("Historical quantity must be an exact decimal.")
    if isinstance(value, str) and (len(value) > 32 or value.strip() != value):
        raise PrecisionPlanError("Historical quantity is outside the bounded source contract.")
    try:
        with localcontext() as context:
            context.prec = 80
            amount = Decimal(value)
            if (
                not amount.is_finite()
                or abs(amount) > MAXIMUM
                or not signed and amount < 0
                or amount != amount.quantize(Decimal("0.001"))
            ):
                raise PrecisionPlanError("Historical quantity is outside exact thousandths.")
            return amount
    except InvalidOperation:
        raise PrecisionPlanError("Historical quantity is unreadable.") from None


def exact_text(value):
    """Residual evidence keeps its exact source scale, not a business formatter."""
    return format(value, "f")


def two_text(value):
    return format(rounded_quantity(value), ".2f")


def _identity(value):
    if not isinstance(value, str) or not value or len(value) > 200:
        raise PrecisionPlanError("Source identity is missing or unbounded.")
    return value


def _location(value):
    return None if value is None else _identity(value)


def _source_key(lot):
    """Never guess a source from current catalogue membership."""
    sources = []
    for field, prefix in (
        ("receiptId", "receipt:"),
        ("openingId", "opening:"),
        ("adjustmentId", "adjustment:"),
        ("reserveMovementId", "dilution:"),
        ("assemblyId", "assembly:"),
    ):
        if lot.get(field) is not None:
            sources.append((prefix, _identity(lot[field])))
    if len(sources) != 1:
        raise PrecisionPlanError("Each lot needs one authenticated original source.")
    prefix, identity = sources[0]
    return prefix + identity + (":" if prefix == "receipt:" else "")


def plan_inventory_boundary(lots, balances, postings, *, dependencies_complete=False):
    """Produce explicit per-location residuals without rewriting any posting.

    Inputs are complete authorized snapshots, not pages. `postings` must already
    be in authoritative recorded-time order, including exhausted lots. The caller
    must authenticate the source documents, paired reserve/dilution evidence,
    current encrypted snapshots, receipt consumption and order consumption before
    asserting dependencies_complete. This function checks the numeric chains and
    ordinary transfer conservation; it cannot establish those business links.
    """
    if dependencies_complete is not True:
        raise PrecisionPlanError("The complete encrypted dependency preflight is required.")
    with localcontext() as context:
        context.prec = 80
        return _inventory_plan(lots, balances, postings)


def _inventory_plan(lots, balances, postings):
    by_lot = {}
    for lot in lots:
        identity = _identity(lot["id"])
        if identity in by_lot:
            raise PrecisionPlanError("Duplicate lot identity.")
        accepted = historical(lot["accepted"])
        if lot.get("whole") and accepted != accepted.to_integral_value():
            raise PrecisionPlanError("Whole-combo source evidence has a fractional quantity.")
        by_lot[identity] = (lot, accepted, _source_key(lot))

    chain = defaultdict(lambda: ZERO)
    credits = defaultdict(lambda: ZERO)
    transfers = defaultdict(list)
    seen_postings = set()
    last_order = None
    original_postings = []
    for row in postings:
        pid = _identity(row["id"])
        lot_id = _identity(row["lotId"])
        location = _location(row["locationId"])
        if pid in seen_postings or lot_id not in by_lot:
            raise PrecisionPlanError("Duplicate posting or unavailable retained lot.")
        seen_postings.add(pid)
        if by_lot[lot_id][0].get("whole") and any(
                Decimal(str(row[field])) != Decimal(str(row[field])).to_integral_value()
                for field in ("before", "delta", "after")):
            raise PrecisionPlanError("Whole-combo history contains a fractional movement or balance.")
        recorded_at = _identity(row["at"])
        try:
            timestamp = datetime.fromisoformat(recorded_at)
        except ValueError:
            raise PrecisionPlanError("Posting recorded time is unreadable.") from None
        if timestamp.tzinfo is None or timestamp.utcoffset() is None:
            raise PrecisionPlanError("Posting recorded time must include its timezone.")
        order = (timestamp, pid)
        if last_order is not None and order <= last_order:
            raise PrecisionPlanError("Postings must be complete and strictly recorded-time ordered.")
        last_order = order
        before = historical(row["before"])
        delta = historical(row["delta"], signed=True)
        after = historical(row["after"])
        key = (lot_id, location)
        if delta == 0 or before != chain[key] or after != before + delta:
            raise PrecisionPlanError("Retained lot/location chain is inconsistent.")
        lot, _, source = by_lot[lot_id]
        if lot.get("whole") and any(n != n.to_integral_value() for n in (before, delta, after)):
            raise PrecisionPlanError("Whole-combo posting evidence contains fractions.")
        chain[key] = after
        reference = _identity(row["source"])
        is_credit = reference.startswith(source) if source.startswith("receipt:") else reference == source
        if is_credit:
            credits[lot_id] += delta
        elif not reference.startswith("move:"):
            if not reference.startswith(("assembly:", "adjustment:", "disposal:", "it-approval:")) or delta >= 0:
                raise PrecisionPlanError("A posting has an unsupported source or unauthorized positive credit.")
        movement = row.get("movementId")
        if reference.startswith("move:"):
            if not movement:
                raise PrecisionPlanError("A transfer is missing its movement identity.")
            transfers[(_identity(movement), lot_id)].append((location, delta))
        original_postings.append({
            "id": pid, "lotId": lot_id, "locationId": location, "at": recorded_at,
            "source": reference, "movementId": movement,
            "before": exact_text(before), "delta": exact_text(delta), "after": exact_text(after),
        })
    for legs in transfers.values():
        if len(legs) != 2 or legs[0][0] == legs[1][0] or sum((n for _, n in legs), ZERO) != 0:
            raise PrecisionPlanError("A retained transfer is missing its conserved opposite leg.")
    for lot_id, (_, accepted, _) in by_lot.items():
        if credits[lot_id] != accepted:
            raise PrecisionPlanError("Accepted quantity does not reconcile to original source credits.")

    actual = {}
    seen_balances = set()
    for row in balances:
        identity = _identity(row["id"])
        key = (_identity(row["lotId"]), _location(row["locationId"]))
        if key[0] not in by_lot or key in actual or identity in seen_balances:
            raise PrecisionPlanError("Balance identity/location is duplicated or its lot is missing.")
        seen_balances.add(identity)
        actual[key] = (identity, historical(row["quantity"]))
    for key in chain.keys() | actual.keys():
        if chain[key] != actual.get(key, (None, ZERO))[1]:
            raise PrecisionPlanError("Retained postings do not reconcile to authoritative current stock.")

    boundary_balances = []
    for (lot_id, location), (identity, original) in sorted(
        actual.items(), key=lambda pair: (pair[0][0], pair[0][1] or "")
    ):
        normalized = rounded_quantity(original)
        boundary_balances.append({
            "balanceId": identity, "lotId": lot_id, "locationId": location,
            "original": exact_text(original), "normalized": two_text(normalized),
            "residual": exact_text(normalized - original),
        })
    source_boundaries = []
    for identity, (_, accepted, source) in sorted(by_lot.items()):
        current = [row for row in boundary_balances if row["lotId"] == identity]
        original_on_hand = sum((Decimal(row["original"]) for row in current), ZERO)
        normalized_on_hand = sum((Decimal(row["normalized"]) for row in current), ZERO)
        accepted_normalized = rounded_quantity(accepted)
        source_boundaries.append({
            "lotId": identity, "source": source,
            "originalAccepted": exact_text(accepted),
            "normalizedAccepted": two_text(accepted_normalized),
            "acceptedResidual": exact_text(accepted_normalized - accepted),
            "originalOnHand": exact_text(original_on_hand),
            "normalizedOnHand": two_text(normalized_on_hand),
            "onHandResidual": exact_text(normalized_on_hand - original_on_hand),
            # Normalized source minus normalized current is not evidence that a
            # historical order consumed a different amount. Keep the difference
            # at the boundary, rather than altering consumption/transfer history.
            "sourceToBalanceResidual": exact_text(
                normalized_on_hand - original_on_hand - (accepted_normalized - accepted)
            ),
        })
    evidence = {
        "policy": "business_quantity_hundredths_half_up_v1",
        "sources": source_boundaries, "balances": boundary_balances,
        "originalPostings": original_postings,
    }
    digest = hashlib.sha256(json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {**evidence, "evidenceDigest": digest}
