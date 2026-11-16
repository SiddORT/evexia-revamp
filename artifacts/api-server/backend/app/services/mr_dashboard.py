"""MR-self dashboard: current directories, selected orders, full-year achievement."""
from time import monotonic
from decimal import Decimal
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from app.db.doctor_models import DoctorDirectory
from app.db.patient_models import PatientDirectory
from app.services import doctors, mr_orders, mr_sales
from app.services.directory_inventory import DirectoryCryptoError
from app.services.directory_runtime import crypto_scope
from app.services.immunotherapy import ImmError
from app.services.order_lifecycle import status
from app.services.settlements import fmt
from app.services.shipments import SOURCES

KINDS = ("IT", "Kit", "SPT", "Lupin")
STATUSES = ("Pending", "In process", "Shipped", "Delivered", "Rejected", "Returned")
RECENT_LIMIT = 6


def presented_status(value):
    value = "Pending" if value in ("Confirmed", "Saved") else status(value)
    if value not in STATUSES:
        raise ImmError("An order has an unsupported saved status. Dashboard counts are unavailable.",
                       503, "mr_dashboard_status")
    return value


def count_card(label, counts):
    total = sum(counts.values())
    return dict(label=label, total=total, byType=[
        dict(kind=kind, count=counts[kind],
             percentage=mr_sales.percentage(Decimal(counts[kind]), Decimal(total)) if total else "0.00")
        for kind in KINDS])


def begin_snapshot(db):
    # Before the first query/authorization lock: every widget is read from one
    # PostgreSQL snapshot, including targets whose writers use different locks.
    # This is a SELECT-only operation, but not SET TRANSACTION READ ONLY because
    # existing authorization deliberately uses row/advisory locks.
    try:
        db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
        db.execute(text("SET LOCAL statement_timeout = '15s'"))
        db.info["mr_dashboard_snapshot"] = True
    except SQLAlchemyError:
        db.rollback()
        raise ImmError("Dashboard is unavailable. Refresh or retry; no estimates are shown.",
                       503, "mr_dashboard_unavailable") from None


def report(db, actor, start_year=None, period="all"):
    if db.info.pop("mr_dashboard_snapshot", False) is not True:
        raise ImmError("Dashboard snapshot was not initialized. Retry later.",
                       503, "mr_dashboard_unavailable")

    def work(current):
        year = mr_sales.current_year() if start_year is None else start_year
        start, end = mr_sales.bounds(year, period)
        full_start, full_end = mr_sales.bounds(year, "all")
        mr_id = current.mr.id
        # Match the ordinary MR Doctor listing (including inactive nondeleted
        # Doctors), not historical order associations or active order choices.
        doctor_count = db.scalar(select(func.count()).select_from(DoctorDirectory).where(
            *doctors.predicates(), *doctors.owned_clauses(current)))
        # MR has no generic Patient-master grant. Its Patient directory is the
        # active order-reference surface: active Patient owner and Directory,
        # active nondeleted assigned Doctor, and matching saved MR ownership.
        patient_count = db.scalar(select(func.count()).select_from(PatientDirectory).where(
            PatientDirectory.deleted_at.is_(None), PatientDirectory.status == "active",
            *mr_orders.reference_scope(db, "patients")))
        counts = {kind: 0 for kind in KINDS}
        status_counts = {value: {kind: 0 for kind in KINDS} for value in STATUSES}
        recent = []
        for kind in KINDS:
            model = SOURCES[kind].Order
            clauses = (model.mr_id == mr_id, model.date >= start, model.date <= end,
                       model.status != "Draft")
            # SQL aggregates count every submitted order, including Kits-to-MR;
            # there is intentionally no Doctor join or recipient restriction.
            for saved_status, total in db.execute(select(model.status, func.count()).where(
                    *clauses).group_by(model.status)):
                label = presented_status(saved_status)
                counts[kind] += total
                status_counts[label][kind] += total
            rows = db.execute(select(model.id, model.number, model.date, model.status, model.snapshot_ciphertext).where(
                *clauses).order_by(model.date.desc(), model.id.desc()).limit(RECENT_LIMIT))
            with crypto_scope(db) as keys:
                for row in rows:
                    from app.services.free_kits import is_free
                    free = kind == "Kit" and is_free(SOURCES[kind].unseal(keys, "orders", row.id, row.snapshot_ciphertext))
                    recent.append(dict(key=f"{kind}:{row.id}", number=row.number, kind=kind,
                        classification="Free kit" if free else None,
                        date=row.date.isoformat(), status=presented_status(row.status)))
        recent.sort(key=lambda row: (row["date"], row["key"]), reverse=True)

        target_row, target_state = mr_sales.target_for_year(db, mr_id, year)
        months = [dict(month=f"{year + (i >= 9):04d}-{(i + 3) % 12 + 1:02d}",
                       known=mr_sales.ZERO, unavailable=0, total=0) for i in range(12)]
        by_month = {row["month"]: row for row in months}
        sources, scanned = [], 0
        for kind in KINDS:
            source = SOURCES[kind]
            model = source.Order
            clauses = (model.mr_id == mr_id, model.date >= full_start, model.date <= full_end,
                       model.status.in_(mr_sales.APPROVED))
            if kind == "Kit":
                from app.services.free_kits import chargeable_clause
                clauses += (chargeable_clause(model),)
            scanned += db.scalar(select(func.count()).select_from(model).where(*clauses))
            if scanned > mr_sales.SCAN_LIMIT:
                raise ImmError("Full-year achievement exceeds the safe 20,000-order limit. "
                               "The dashboard is unavailable; use the Targets page for a shorter period. "
                               "No partial dashboard totals are shown.", 422, "mr_dashboard_limit")
            sources.append((kind, source, clauses))
        deadline = monotonic() + 15
        with crypto_scope(db) as keys:
            for kind, source, clauses in sources:
                model = source.Order
                rows = db.execute(select(model.id, model.date, model.snapshot_ciphertext).where(
                    *clauses).order_by(model.id).execution_options(yield_per=200))
                try:
                    for row in rows:
                        if monotonic() > deadline:
                            raise ImmError("Dashboard achievement exceeded its read budget. Retry later; "
                                           "no partial dashboard is shown.", 503, "mr_dashboard_budget")
                        month = by_month[row.date.isoformat()[:7]]
                        try:
                            saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
                            amount = mr_sales.achievement_amount(kind, saved)
                        except (DirectoryCryptoError, ImmError, ValueError, KeyError, TypeError,
                                AttributeError, ArithmeticError):
                            amount = None
                        month["total"] += 1
                        if amount is None:
                            month["unavailable"] += 1
                        else:
                            month["known"] += amount
                finally:
                    rows.close()

        def achievement(name, selected):
            known = sum((row["known"] for row in selected), mr_sales.ZERO)
            unavailable = sum(row["unavailable"] for row in selected)
            target = (target_row.annual_target if name == "all" else getattr(target_row, name.lower())) \
                if target_state == "active" else None
            a, b = mr_sales.bounds(year, name)
            return dict(period=name, dateFrom=a.isoformat(), dateTo=b.isoformat(),
                        targetState=target_state, target=fmt(target) if target is not None else None,
                        knownSales=fmt(known), complete=unavailable == 0, unavailableOrders=unavailable,
                        total=sum(row["total"] for row in selected),
                        remaining=fmt(max(mr_sales.ZERO, target - known))
                        if unavailable == 0 and target is not None else None,
                        percentage=mr_sales.percentage(known, target) if unavailable == 0 else None)

        from app.services.mr_dashboard_financials import financial_cards
        financial = financial_cards(db, mr_id, start, end)
        return dict(mrId=str(mr_id), startYear=year, currentYear=mr_sales.current_year(), period=period,
                    dateFrom=start.isoformat(), dateTo=end.isoformat(),
                    directory=dict(doctors=doctor_count, patients=patient_count),
                    orders=count_card("Total Orders", counts),
                    statuses=[count_card(label, status_counts[label]) for label in STATUSES],
                    recent=recent[:RECENT_LIMIT], recentLimit=RECENT_LIMIT,
                    financial=financial, annual=achievement("all", months),
                    quarters=[achievement(f"Q{i + 1}", months[i * 3:i * 3 + 3]) for i in range(4)],
                    monthly=[dict(month=row["month"], knownSales=fmt(row["known"]),
                                  amount=None if row["unavailable"] else fmt(row["known"]),
                                  unavailableOrders=row["unavailable"]) for row in months])
    return mr_sales.transaction(db, actor, work)
