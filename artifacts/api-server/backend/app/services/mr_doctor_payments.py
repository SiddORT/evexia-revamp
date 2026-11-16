"""Read-only current Doctor balances; no new ledger or eligibility policy."""
from collections import defaultdict
from decimal import localcontext
from sqlalchemy import select
from app.db.doctor_models import DoctorDirectory
from app.services import doctors, mr_sales, settlements
from app.services.directory_inventory import DirectoryCryptoError
from app.services.directory_runtime import crypto_scope
from app.services.immunotherapy import ImmError
from app.services.order_eligibility import ACTIVE, EXCLUDED, today
from app.services.order_financial_review import pending_pricing, settings
from app.services.shipments import SOURCES


def unavailable(message):
    raise ImmError(message, 503, "mr_doctor_payments_unavailable")


def report(db, actor, *, search="", offset=0, limit=25):
    # The route initializes REPEATABLE READ before authentication's first query.
    if db.info.pop("mr_dashboard_snapshot", False) is not True:
        unavailable("Doctor payments snapshot is unavailable. Refresh to retry.")

    def work(current):
        with crypto_scope(db) as keys, localcontext() as context:
            context.prec = 50
            policy = settings(db, current.mr.id)
            business_date = today()
            assigned = list(db.scalars(select(DoctorDirectory).where(
                *doctors.predicates(), *doctors.owned_clauses(current))
                .order_by(DoctorDirectory.id).limit(settlements.SCAN_LIMIT + 1)))
            if len(assigned) > settlements.SCAN_LIMIT:
                unavailable("The assigned Doctor directory exceeds the safe reporting size. No partial balances are shown.")
            identities = [doctor.id for doctor in assigned]
            candidates, scope = [], defaultdict(list)
            # Filter ownership and current Doctor assignment in SQL, before any
            # decryption. MR-supply orders, drafts and other MRs never enter.
            for kind, source in SOURCES.items():
                from app.services.free_kits import chargeable_clause
                rows = list(db.scalars(select(source.Order).where(
                    source.Order.mr_id == current.mr.id,
                    source.Order.doctor_id.in_(identities),
                    *([chargeable_clause(source.Order)] if kind == "Kit" else []),
                    source.Order.status != "Draft").order_by(source.Order.id)
                    .limit(settlements.SCAN_LIMIT + 1)))
                if len(candidates) + len(rows) > settlements.SCAN_LIMIT:
                    unavailable("Complete Doctor order history exceeds the safe reporting size. No partial balances are shown.")
                for row in rows:
                    if row.status not in ACTIVE and row.status not in EXCLUDED:
                        unavailable("A saved order has an unknown financial status.")
                    candidates.append((kind, source, row))
                    scope[kind].append(row.id)
            receipts = settlements.history(db, keys, scope)
            positions = {identity: dict(received=settlements.ZERO, due=settlements.ZERO,
                                        pending=0, oldest=None) for identity in identities}
            for kind, source, row in candidates:
                saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
                from app.services.free_kits import is_free
                if kind == "Kit" and is_free(saved):
                    continue
                paid = sum((settlements.exact(item["amount"])
                            for item in receipts[(kind, row.id)]), settlements.ZERO)
                credit = settlements.credited(receipts, kind, row.id)
                total = settlements.saved_total(kind, saved)
                settlements.payment_position(total, paid, credit)
                position = positions[row.doctor_id]
                # Committed cash is received once, independently of verification;
                # credits only reduce obligations and are never receipts.
                position["received"] += paid
                if row.status in EXCLUDED:
                    continue
                if total is None:
                    if not pending_pricing(kind, saved, row.status):
                        unavailable("Saved financial evidence is unreadable; this is not pending pricing.")
                    position["pending"] += 1
                    continue
                balance = total - paid - credit
                position["due"] += balance
                if balance > 0:
                    position["oldest"] = min(position["oldest"], row.date) if position["oldest"] else row.date

            # Aggregate the complete authorized evidence BEFORE search/paging.
            # Only names are searched/returned: no contact or account metadata.
            items = []
            query = search.strip().casefold()
            for doctor in assigned:
                name = doctor.name
                if not isinstance(name, str) or not name.strip():
                    unavailable("A currently assigned Doctor's name is unavailable.")
                if query not in name.casefold():
                    continue
                position = positions[doctor.id]
                oldest = position["oldest"]
                age = (business_date - oldest).days if oldest else None
                days = policy.doctorDaysLimit
                items.append(dict(
                    doctorId=str(doctor.id), doctorName=name,
                    received=settlements.fmt(position["received"]),
                    knownDue=settlements.fmt(position["due"]),
                    due=None if position["pending"] else settlements.fmt(position["due"]),
                    pendingPricingOrders=position["pending"],
                    oldestUnpaidDate=oldest.isoformat() if oldest else None,
                    oldestUnpaidAgeDays=age,
                    daysRemaining=max(0, days - age) if days and age is not None else None,
                    overdueDays=max(0, age - days) if days and age is not None and age >= days else None))
            items.sort(key=lambda item: (item["doctorName"].casefold(), item["doctorId"]))
            return dict(mrId=str(current.mr.id), businessDate=business_date.isoformat(),
                        doctorDaysLimit=policy.doctorDaysLimit, total=len(items),
                        offset=offset, limit=limit, items=items[offset:offset + limit])
    try:
        return mr_sales.transaction(db, actor, work)
    except DirectoryCryptoError:
        unavailable("Doctor payments could not be read securely. No balances are estimated.")
    except (KeyError, TypeError, ValueError, ArithmeticError):
        unavailable("Doctor payments evidence is inconsistent. No balances are estimated.")
