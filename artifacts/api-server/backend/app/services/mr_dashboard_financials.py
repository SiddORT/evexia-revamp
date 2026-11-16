"""Configured contributions to shared dashboard cards; no ledger policy changes."""
from time import monotonic
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from app.services import mr_sales, settlements
from app.services.directory_inventory import DirectoryCryptoError
from app.services.directory_runtime import crypto_scope
from app.services.immunotherapy import ImmError
from app.services.order_eligibility import ACTIVE, EXCLUDED
from app.services.order_financial_review import pending_pricing
from app.services.shipments import SOURCES

FIELDS = ("totalSales", "grossSales", "actualSales", "dueAmount")
EVIDENCE_ERRORS = (DirectoryCryptoError, ImmError, ValueError, KeyError,
                   TypeError, AttributeError, ArithmeticError)


def metric(amount=None):
    return dict(amount=settlements.fmt(amount) if amount is not None else None,
                complete=amount is not None)


def financial_cards(db, mr_id, start, end):
    # A caller-owned repeatable-read snapshot and financial authorization lock
    # cover orders, receipt verification, credits and all existing widgets.
    # Savepoints isolate an unavailable financial surface from valid counts and
    # achievement; never swallow a SQL failure in an aborted outer transaction.
    totals = {field: metric() for field in FIELDS}
    deadline = monotonic() + 15

    def budget():
        if monotonic() > deadline:
            raise ImmError("Financial cards exceeded their read budget. Retry.",
                           503, "mr_dashboard_financial_budget")

    try:
        with db.begin_nested(), crypto_scope(db) as keys:
            source = SOURCES["Kit"]
            model = source.Order
            # Own saved orders, including Doctor-less Kits-to-MR. No current
            # Doctor assignment or receipt-date filter participates in scope.
            from app.services.free_kits import chargeable_clause
            clauses = (model.mr_id == mr_id, model.date >= start, model.date <= end,
                       model.status != "Draft", chargeable_clause(model))
            count = db.scalar(select(func.count()).select_from(model).where(*clauses))
            if count > settlements.SCAN_LIMIT:
                raise ImmError("Financial period exceeds the safe reporting size.",
                               422, "mr_dashboard_financial_limit")
            budget()
            sales = {field: settlements.ZERO for field in FIELDS[:3]}
            complete = {field: True for field in FIELDS[:3]}
            obligations = []
            rows = db.execute(select(model.id, model.status, model.snapshot_ciphertext)
                .where(*clauses).order_by(model.id).limit(settlements.SCAN_LIMIT + 1)
                .execution_options(yield_per=200))
            scanned = 0
            try:
                for row in rows:
                    budget()
                    scanned += 1
                    if scanned > settlements.SCAN_LIMIT:
                        raise ImmError("Financial scan exceeded its limit.", 422, "mr_dashboard_financial_limit")
                    if row.status not in ACTIVE and row.status not in EXCLUDED:
                        raise ImmError("Unknown financial lifecycle.", 503, "mr_dashboard_financial_status")
                    if row.status in EXCLUDED:
                        continue
                    try:
                        saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
                    except EVIDENCE_ERRORS:
                        saved = None
                    from app.services.free_kits import is_free
                    if saved is not None and is_free(saved):
                        continue
                    # Keep only minimal monetary evidence for the later debt
                    # pass, not thousands of protected decrypted snapshots.
                    invoice, pricing_state = None, "unavailable"
                    try:
                        invoice = settlements.saved_total("Kit", saved)
                        if invoice is not None:
                            pricing_state = "known"
                        elif pending_pricing("Kit", saved, row.status):
                            pricing_state = "pending"
                    except EVIDENCE_ERRORS:
                        pass  # Explicit unavailable evidence, not a zero.
                    obligations.append((row.id, invoice, pricing_state))
                    if row.status not in mr_sales.APPROVED:
                        continue
                    # Read independently: valid Parking needs no invoice, and a
                    # missing Parking must not hide valid Gross/Actual amounts.
                    try:
                        parking = mr_sales.achievement_amount("Kit", saved)
                        if parking is None:
                            complete["totalSales"] = False
                        else:
                            sales["totalSales"] += parking
                    except EVIDENCE_ERRORS:
                        complete["totalSales"] = False
                    if invoice is None:
                        complete["grossSales"] = complete["actualSales"] = False
                    else:
                        sales["grossSales"] += invoice
                        sales["actualSales"] += invoice
            finally:
                rows.close()
            for field in sales:
                totals[field] = metric(sales[field]) if complete[field] else metric()

            # Debt includes pending obligations and Returned, independently of
            # achievement exclusions. Complete committed history, not a page.
            try:
                with db.begin_nested():
                    history = settlements.history(db, keys, {
                        "Kit": [identity for identity, _, _ in obligations]})
                    budget()
                    due, due_complete = settlements.ZERO, True
                    for identity, total, pricing_state in obligations:
                        budget()
                        try:
                            receipts = history[("Kit", identity)]
                            paid = sum((settlements.exact(r["amount"]) for r in receipts),
                                       settlements.ZERO)
                            credit = settlements.credited(history, "Kit", identity)
                            settlements.payment_position(total, paid, credit)
                            if total is None:
                                # Pending pricing is still incomplete, not zero;
                                # missing/corrupt pricing is never estimated.
                                if pricing_state != "pending":
                                    raise ValueError("Unreadable financial evidence")
                                due_complete = False
                                continue
                            unverified = sum((
                                settlements.exact(r["amount"]) for r in receipts
                                if r["verification"] == "Not verified"), settlements.ZERO)
                            if any(r["verification"] not in ("Verified", "Not verified")
                                   for r in receipts):
                                raise ValueError("Unreadable verification")
                            # Each allocation once, even for mixed verification:
                            # unpaid + unverified = total - verified - credits.
                            due += total - paid - credit + unverified
                        except EVIDENCE_ERRORS:
                            due_complete = False
                    totals["dueAmount"] = metric(due) if due_complete else metric()
            except (*EVIDENCE_ERRORS, SQLAlchemyError):
                totals["dueAmount"] = metric()
    except (*EVIDENCE_ERRORS, SQLAlchemyError):
        # An incomplete scan cannot publish a truncated configured subtotal.
        totals = {field: metric() for field in FIELDS}

    return dict(scope="configured-subtotal", totals=totals, contributions=[
        dict(kind=kind, state="configured" if kind == "Kit" else "unconfigured",
             totals=totals if kind == "Kit" else None)
        for kind in ("IT", "Kit", "SPT", "Lupin")])
