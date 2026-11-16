"""Read-only Kits payment projection. Never attach receipt details or persist it."""
import uuid
from collections import defaultdict
from sqlalchemy import select
from app.db.kits_models import KitsOrder
from app.db.settlement_models import SettlementEntry as Entry, SettlementBatch as Batch
from app.services.mr_orders import scope


def with_status(db, keys, records, *, budget=None):
    # Lazy import: Accounts' source registry includes the Kits service.
    from app.services.settlements import HISTORY_LIMIT, ZERO, exact, fail, saved_total, payment_position
    from app.services.settlement_crypto import unseal

    if not records:
        return []
    budget = budget if budget is not None else {"remaining": HISTORY_LIMIT}
    identities = [uuid.UUID(record["id"]) for record in records]
    paid = defaultdict(lambda: ZERO)
    # Only already-authorized Kits IDs; repeat ownership at the query boundary.
    # No verification predicate: an unverified allocation is still recorded money.
    query = (select(Entry).join(Batch, Batch.id == Entry.batch_id)
             .join(KitsOrder, KitsOrder.id == Entry.order_id)
             .where(Entry.kind == "Kit", Entry.order_id.in_(identities), *scope(db, KitsOrder))
             .limit(budget["remaining"] + 1).execution_options(yield_per=25))
    rows = db.scalars(query)
    try:
        for entry in rows:
            if budget["remaining"] <= 0:
                fail("Payment history exceeds the safe search size. Narrow the order dates or filters.",
                     422, "settlement_history_limit")
            budget["remaining"] -= 1
            amount = exact(unseal(keys, "entries", entry.id, entry.payload_ciphertext)["amount"])
            if amount <= ZERO:
                fail("A saved transaction is unreadable.", 503, "settlement_saved_value")
            paid[entry.order_id] += amount
    finally:
        rows.close()
    from app.services.order_financial_review import pending_pricing
    from app.services.credit_notes import history, active_total
    credits = history(db, keys, {"Kit": identities})
    result = []
    for record, identity in zip(records, identities):
        from app.services.free_kits import is_free
        if is_free(record):
            if paid[identity] or credits[("Kit", identity)]:
                fail("Free kit has conflicting financial history. Ask Admin to investigate.",
                     503, "free_kit_evidence")
            result.append({**record, "ledgerPaymentStatus": "Free kit",
                           "ledgerCredited": None, "ledgerPaid": None})
            continue
        credit = active_total(credits[("Kit", identity)])
        total = saved_total("Kit", record)
        state = payment_position(total, paid[identity], credit)
        if total is None and not paid[identity] and not credit and pending_pricing("Kit", record, record["status"]):
            state = "Pending pricing"
        from app.services.settlements import fmt
        result.append({**record, "ledgerPaymentStatus": state, "ledgerCredited": fmt(credit), "ledgerPaid": fmt(paid[identity])})
    return result


def read_result(db, keys, result):
    """Enrich public saved responses only, after retry snapshots/writes are done.

    Import reviews deliberately retain their legacy decision comparison fields.
    Listing sections already calculate status before their filtering/pagination.
    """
    if not isinstance(result, dict):
        return result
    if {"id", "number", "version", "kit"}.issubset(result):
        return with_status(db, keys, [result])[0]
    if "orders" in result:
        return {**result, "orders": with_status(db, keys, result["orders"])}
    return result
