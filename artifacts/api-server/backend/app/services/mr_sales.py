"""Read-only MR achievement over saved ownership, date and exact monetary facts."""
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, localcontext
from zoneinfo import ZoneInfo
from sqlalchemy import case, extract, literal, select, union
from sqlalchemy.exc import SQLAlchemyError
from app.db.sales_target_models import SalesTarget
from app.services import mr_orders
from app.services.directory_runtime import crypto_scope
from app.services.directory_inventory import DirectoryCryptoError
from app.services.immunotherapy import ImmError
from app.services.order_lifecycle import status
from app.services.settlements import saved_total, fmt
from app.services.shipments import SOURCES

SCAN_LIMIT = 20000
APPROVED = ("Approved", "In process", "Shipped", "Delivered")
ZERO = Decimal("0.00")


def current_year():
    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    return today.year if today.month >= 4 else today.year - 1


def bounds(year, period):
    if period == "all":
        return date(year, 4, 1), date(year + 1, 3, 31)
    quarter = int(period[1])
    month = {1: 4, 2: 7, 3: 10, 4: 1}[quarter]
    start = date(year + (quarter == 4), month, 1)
    end = date(year + 1, 3, 31) if quarter == 4 else date(year, month + 2, 31 if quarter == 3 else 30)
    return start, end


def percentage(amount, target):
    if target is None or target <= 0:
        return None
    return format((amount * 100 / target).quantize(Decimal(".01"), rounding=ROUND_HALF_UP), ".2f")


def transaction(db, actor, work):
    try:
        # Reuse order identity/graph checks and the shared financial/lifecycle lock.
        # No admin fallback and no caller-supplied MR selector.
        current = mr_orders.authorize(db, actor)
        if current.role != "mr":
            raise ImmError("Only authenticated MRs may read their sales achievement.", 403, "access_denied")
        with localcontext() as ctx:
            ctx.prec = 50
            result = work(current)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise ImmError("Sales achievement is unavailable. Refresh or retry.", 503, "mr_sales_unavailable") from None
    except Exception:
        db.rollback()
        raise


def years(db, actor, offset=0, limit=50):
    def work(current):
        selections = [select(literal(current_year()).label("year")),
                      select(SalesTarget.startYear.label("year")).where(SalesTarget.mrId == current.mr.id)]
        for source in SOURCES.values():
            model = source.Order
            year = extract("year", model.date) - case((extract("month", model.date) < 4, 1), else_=0)
            selections.append(select(year.label("year")).where(model.mr_id == current.mr.id))
        # At most 9,998 possible financial years, grouped in SQL; no order
        # documents or other MRs' historical periods are downloaded.
        choices = union(*selections).subquery()
        from sqlalchemy import func
        valid = select(choices.c.year).where(choices.c.year.between(1, 9998))
        total = db.scalar(select(func.count()).select_from(valid.subquery()))
        items = [int(y) for y in db.scalars(valid.order_by(choices.c.year.desc()).offset(offset).limit(limit))]
        return dict(items=items, total=total, offset=offset, limit=limit, currentYear=current_year())
    return transaction(db, actor, work)


def reporting(db, actor, start_year=None, period="all", offset=0, limit=25):
    def work(current):
        year = start_year if start_year is not None else current_year()
        start, end = bounds(year, period)
        # Active/inactive live records take precedence over retained deletions.
        target_row = db.scalar(select(SalesTarget).where(
            SalesTarget.mrId == current.mr.id, SalesTarget.startYear == year
        ).order_by(SalesTarget.deleted_at.asc().nulls_first(), SalesTarget.updated_at.desc(), SalesTarget.id).limit(1))
        target_state = ("missing" if target_row is None else "deleted" if target_row.deleted_at
                        else target_row.status)
        target = None
        if target_state == "active":
            target = target_row.annual_target if period == "all" else getattr(target_row, period.lower())
        sources, scanned = [], 0
        from sqlalchemy import func
        for kind, source in SOURCES.items():
            model = source.Order
            clauses = (model.mr_id == current.mr.id, model.date >= start, model.date <= end,
                       model.status.in_(APPROVED))
            scanned += db.scalar(select(func.count()).select_from(model).where(*clauses))
            if scanned > SCAN_LIMIT:
                raise ImmError("This period exceeds the safe 20,000-order reporting limit. Select a quarter; no partial achievement is shown.",
                               422, "mr_sales_limit")
            # One row per order, never joined to patients, bottles or SUBs.
            sources.append((kind, source, clauses))
        items, known, unavailable = [], ZERO, 0
        with crypto_scope(db) as keys:
            for kind, source, clauses in sources:
                model = source.Order
                # Bounded batches avoid retaining thousands of encrypted/private
                # documents. Only the minimal financial projection survives.
                rows = db.scalars(select(model).where(*clauses)
                                  .order_by(model.date.desc(), model.id.desc()).limit(SCAN_LIMIT + 1)
                                  .execution_options(yield_per=200))
                for row in rows:
                    if len(items) >= SCAN_LIMIT:
                        raise ImmError("This period exceeds the safe reporting limit. Select a quarter.",
                                       422, "mr_sales_limit")
                    try:
                        saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
                        amount = saved_total(kind, saved)
                    except (DirectoryCryptoError, ImmError, ValueError, KeyError, TypeError, AttributeError, ArithmeticError):
                        # Per-order unreadable prices stay visible, never zero.
                        amount = None
                    if amount is None:
                        unavailable += 1
                    else:
                        known += amount
                    items.append(dict(key=f"{kind}:{row.id}", number=row.number, kind=kind,
                                      date=row.date.isoformat(), status=status(row.status),
                                      amount=fmt(amount) if amount is not None else None,
                                      contribution=percentage(amount, target) if amount is not None else None))
        items.sort(key=lambda item: (item["date"], item["key"]), reverse=True)
        complete = unavailable == 0
        return dict(mrId=str(current.mr.id), startYear=year, currentYear=current_year(), period=period,
                    dateFrom=start.isoformat(), dateTo=end.isoformat(), targetState=target_state,
                    target=fmt(target) if target is not None else None, knownSales=fmt(known),
                    complete=complete, unavailableOrders=unavailable,
                    remaining=fmt(max(ZERO, target - known)) if complete and target is not None else None,
                    percentage=percentage(known, target) if complete else None,
                    total=len(items), items=items[offset:offset + limit], offset=offset, limit=limit)
    return transaction(db, actor, work)
