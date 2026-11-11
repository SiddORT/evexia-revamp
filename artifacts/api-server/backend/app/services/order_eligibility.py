"""MR-only credit policy over saved obligations and committed settlements.

Call after authorization and before any order write, inside the caller's
transaction. Authorization takes the financial lock before identity/domain
locks, including for Admin writers; idempotent replay stays ahead of enforce().
"""
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy import select, text
from app.services.immunotherapy import ImmError
from app.services.directory_inventory import DirectoryCryptoError

LOCK = 145580  # Same transaction lock as settlement posting.
ACTIVE = frozenset({"Confirmed", "Saved", "Approved", "In process", "Shipped", "Delivered", "Returned"})
EXCLUDED = frozenset({"Draft", "Rejected", "Void", "Voided", "Cancelled", "Canceled"})
LABELS = {"immunotherapy": "IT", "kits": "Kit", "spt": "SPT", "lupin": "Lupin"}


def lock(db):
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})


def today():
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def unavailable(message):
    raise ImmError(message + " Your order is not placed; retain this draft and ask Admin to review the saved financial evidence.",
                   409, "mr_eligibility_unavailable")


def proposed_total(kind, data, previous=None):
    """Never use stale protected pricing after a composition correction.

    SPT and Lupin resolve exact totals from their submitted/saved amount basis.
    IT rate/SUB resolution also computes its total. Kits and legacy IT can
    retain an old total even when the protected composition needs review.
    Compare that basis, not the broad clinical pricingNeedsReview flag.
    """
    from app.services.settlements import saved_total
    if previous:
        if kind == "kits" and any(data.get(k) != previous.get(k) for k in ("kit", "lancets", "applicators", "tray")):
            return None
        if kind == "immunotherapy" and data.get("pricingBasis", "legacy_bottle_mrp") == "legacy_bottle_mrp":
            if previous.get("pricingNeedsReview"):
                return None  # No priced basis survives earlier legacy corrections.
            def basis(value):
                return [(g["id"], g.get("mrp"), [(i["allergenId"], i.get("rate")) for i in g["items"]])
                        for g in value["groups"]]
            if basis(data) != basis(previous):
                return None
    # Kits correction saves retain the historical price over multiple edits.
    # Revalidate it against the proposed composition without adopting a new
    # catalogue/rate total. A mismatch is unavailable, never that old price.
    if kind == "kits" and data.get("pricing"):
        from app.schemas.kits import KitsInput
        from app.schemas.kits_pricing import KitsPricingInput, calculate
        raw = data["pricing"]
        try:
            body = KitsInput.model_validate({k: data[k] for k in KitsInput.model_fields
                                            if k in data and k not in {"pricing", "businessParking", "poNumber"}}
                                           | {"attachmentIds": [f["id"] for f in data.get("attachments", [])]})
            price = KitsPricingInput.model_validate({k: raw[k] for k in KitsPricingInput.model_fields if k in raw})
            if calculate(body, price, raw["taxPercentage"]) != raw:
                return None
        except (ValueError, KeyError, TypeError):
            return None
    return saved_total(LABELS[kind], data)


def _evaluate(db, keys, kind, data, *, row=None, order_date=None, previous=None):
    from app.services.mr_orders import scope_identity
    from app.db.mr_models import MRDirectory
    from app.services import settlements
    from app.services.shipments import SOURCES
    identity = scope_identity(db)
    business_date = today()
    governed_it = kind == "immunotherapy" and data.get("pricingPolicy") == "configured_material_ml_v1"
    result = dict(eligible=True, reasons=[], paymentLimit=None, doctorDaysLimit=None,
                  outstanding=None, proposedBalance=None, resultingOutstanding=None, businessDate=business_date.isoformat(),
                  doctorPendingBalance=None, oldestDoctorUnpaidAgeDays=None, oldestDoctorUnpaidDate=None)
    if not identity or data["status"] in EXCLUDED:
        return result
    if data["status"] not in ACTIVE:
        unavailable("The proposed order's financial status is unavailable.")
    settings = db.scalar(select(MRDirectory).where(MRDirectory.id == identity)
                         .execution_options(populate_existing=True))
    if not settings or settings.deleted_at or settings.status != "active":
        unavailable("Your current saved MR settings are unavailable.")
    limit = settlements.exact(settings.paymentLimit)
    days = settings.doctorDaysLimit
    if isinstance(days, bool) or not isinstance(days, int) or not 0 <= days <= 3650:
        unavailable("Your saved MR Doctor Days Limit is unreadable.")
    result.update(paymentLimit=settlements.fmt(limit), doctorDaysLimit=days)
    if not limit and not days and not governed_it:
        return result

    def incomplete(message):
        unavailable(f"{message} MR Payment Limit ₹{limit:.2f}; MR Doctor Days Limit {days} days.")

    doctor_id = data.get("doctorId")
    candidates, scoped, scanned = [], defaultdict(list), 0
    # Read by order, never a patient join. No date/status narrowing that could
    # omit old, pending, delivered or returned unpaid obligations.
    for label, source in SOURCES.items():
        clauses = [source.Order.mr_id == identity]
        if not limit and not governed_it:
            clauses.append(source.Order.doctor_id == doctor_id)
        rows = list(db.scalars(select(source.Order).where(*clauses).order_by(source.Order.id)
                               .limit(settlements.SCAN_LIMIT + 1)))
        scanned += len(rows)
        if scanned > settlements.SCAN_LIMIT:
            incomplete("Complete MR financial history exceeds the safe evaluation size.")
        for saved_row in rows:
            if saved_row.status in EXCLUDED:
                # Keep the replaced row's receipts available even on resubmit.
                if row is not None and label == LABELS[kind] and saved_row.id == row.id:
                    scoped[label].append(saved_row.id)
                continue
            if saved_row.status not in ACTIVE:
                incomplete("A saved order has an unknown financial status.")
            candidates.append((label, source, saved_row))
            scoped[label].append(saved_row.id)
    if row is not None and row.id not in scoped[LABELS[kind]]:
        scoped[LABELS[kind]].append(row.id)
    exposure_complete, doctor_complete = True, True
    if governed_it and not limit:
        # Disabled amount restriction must not become a requirement to repair
        # unrelated Doctors' financial history merely to place this IT order.
        from sqlalchemy.exc import SQLAlchemyError
        try:
            with db.begin_nested():
                receipts = settlements.history(db, keys, scoped)
        except (ImmError, DirectoryCryptoError, SQLAlchemyError):
            required_scope = defaultdict(list)
            if days:
                for label, _, saved_row in candidates:
                    if str(saved_row.doctor_id) == str(doctor_id):
                        required_scope[label].append(saved_row.id)
                if row:
                    required_scope[LABELS[kind]].append(row.id)
            receipts = settlements.history(db, keys, required_scope) if days else defaultdict(list)
            exposure_complete, doctor_complete = False, bool(days)
    else:
        receipts = settlements.history(db, keys, scoped)
    outstanding = settlements.ZERO
    overdue = []
    doctor_pending, oldest_date = settlements.ZERO, None

    def remaining(label, saved, saved_row):
        nonlocal exposure_complete, doctor_complete
        total = settlements.saved_total(label, saved)
        if total is None:
            if not governed_it or limit or (days and str(saved_row.doctor_id) == str(doctor_id)):
                incomplete("An applicable order has no authoritative saved total.")
            exposure_complete = False
            if str(saved_row.doctor_id) == str(doctor_id):
                doctor_complete = False
            return None
        paid = sum((settlements.exact(r["amount"]) for r in receipts[(label, saved_row.id)]), settlements.ZERO)
        if paid > total:
            incomplete("Committed payments exceed an applicable saved order total.")
        return total - paid

    def aged(balance, date, selected):
        if days and selected and balance > 0:
            age = (business_date - date).days
            if age > days:
                overdue.append((age, balance))

    for label, source, saved_row in candidates:
        if row is not None and label == LABELS[kind] and saved_row.id == row.id:
            continue  # Replacement, never old plus new.
        try:
            saved = source.unseal(keys, "orders", saved_row.id, saved_row.snapshot_ciphertext)
            balance = remaining(label, saved, saved_row)
        except (ImmError, DirectoryCryptoError):
            if not governed_it or limit or (days and str(saved_row.doctor_id) == str(doctor_id)):
                raise
            exposure_complete = False
            if str(saved_row.doctor_id) == str(doctor_id):
                doctor_complete = False
            continue
        if balance is None:
            continue
        outstanding += balance
        selected = str(saved_row.doctor_id) == str(doctor_id)
        if selected:
            doctor_pending += balance
            if balance > 0:
                oldest_date = min(oldest_date, saved_row.date) if oldest_date else saved_row.date
        aged(balance, saved_row.date, selected)

    total = proposed_total(kind, data, previous)
    if total is None:
        incomplete("The proposed order has no authoritative total for the enabled MR financial rule; its pricing may require Admin review.")
    paid = sum((settlements.exact(r["amount"]) for r in receipts[(LABELS[kind], row.id)]), settlements.ZERO) if row else settlements.ZERO
    if paid > total:
        incomplete("The proposed replacement total is below committed payments.")
    proposed = total - paid
    aged(proposed, row.date if row else order_date or business_date, True)
    result.update(outstanding=settlements.fmt(outstanding) if (limit or governed_it) and exposure_complete else None,
                  proposedBalance=settlements.fmt(proposed),
                  resultingOutstanding=settlements.fmt(outstanding + proposed) if (limit or governed_it) and exposure_complete else None,
                  doctorPendingBalance=settlements.fmt(doctor_pending) if doctor_complete else None,
                  oldestDoctorUnpaidDate=oldest_date.isoformat() if oldest_date and doctor_complete else None,
                  oldestDoctorUnpaidAgeDays=(business_date - oldest_date).days if oldest_date and doctor_complete else None)
    if limit and (outstanding + proposed >= limit if governed_it else outstanding + proposed > limit):
        result["reasons"].append(dict(code="mr_payment_limit", limit=settlements.fmt(limit),
            balance=settlements.fmt(outstanding), proposed=settlements.fmt(proposed),
            message=f"MR Payment Limit ₹{limit:.2f}: existing unpaid balance ₹{outstanding:.2f} plus proposed unpaid amount ₹{proposed:.2f} totals ₹{outstanding + proposed:.2f}. " +
                    ("This Immunotherapy exposure must be strictly below the limit; equality is not permitted." if governed_it else "This exceeds the limit.")))
    if overdue:
        age, balance = max(overdue)
        result["reasons"].append(dict(code="mr_doctor_days_limit", limit=str(days), balance=settlements.fmt(balance),
            ageDays=age, message=f"MR Doctor Days Limit {days} days: this Doctor has an unpaid order aged {age} days with ₹{balance:.2f} remaining. Days run from the saved order date."))
    result["eligible"] = not result["reasons"]
    return result


def evaluate(db, keys, kind, data, *, row=None, order_date=None, previous=None):
    from sqlalchemy.exc import SQLAlchemyError
    from app.services.directory_inventory import DirectoryCryptoError
    try:
        return _evaluate(db, keys, kind, data, row=row, order_date=order_date, previous=previous)
    except ImmError as error:
        if error.code.startswith("settlement_"):
            unavailable("Complete trustworthy saved totals and committed payments are unavailable for MR eligibility. " + error.message)
        raise
    except DirectoryCryptoError:
        raise ImmError("MR financial eligibility could not be checked because saved financial evidence is unreadable. Your draft and uploads remain available; ask Admin to review.",
                       503, "mr_eligibility_unavailable") from None
    except SQLAlchemyError:
        raise ImmError("MR financial eligibility could not be checked against the saved orders and committed settlements. Your draft and uploads remain available; retry the same submission.",
                       503, "mr_eligibility_unavailable") from None


def enforce(db, keys, kind, data, *, row=None, order_date=None, previous=None):
    result = evaluate(db, keys, kind, data, row=row, order_date=order_date, previous=previous)
    if not result["eligible"]:
        raise ImmError(" ".join(r["message"] for r in result["reasons"]) + " Your draft and verified attachments are retained.",
                       409, result["reasons"][0]["code"])
    return result


def stock_advice(db, kind, data):
    # Only IT currently saves actual allergen component references. No inferred
    # recipes for kit names, SPT patients or Lupin counts.
    if kind != "immunotherapy":
        return []
    from app.services import inventory
    identities = {item["allergenId"] for group in data["groups"] for item in group["items"]}
    if data.get("pricingPolicy") == "configured_material_ml_v1":
        identities.update(component["materialId"] for group in data["pricingEvidence"]["groups"]
                          for component in group["components"] if component["kind"] == "dilution")
    return inventory.selected_allergen_advice(db, identities)


def preview(db, actor, kind, body):
    """Read-only preview; final write still enforces under the same lock."""
    from app.services import immunotherapy, kits, spt, lupin
    from app.services.mr_orders import scope_identity
    services = {"immunotherapy": immunotherapy, "kits": kits, "spt": spt, "lupin": lupin}
    service = services[kind]

    def work(current, keys):
        if not scope_identity(db) and not (kind == "immunotherapy" and getattr(body.values, "refreshQuote", False)):
            raise ImmError("Eligibility advice is limited to the signed-in MR.", 403, "access_denied")
        # Do not retroactively reject or re-warn an already committed request.
        # The write endpoint alone verifies and replays its original payload.
        prior = db.get(service.Retry, body.values.idempotencyKey)
        if prior:
            if prior.actor_id != current.user.id:
                raise ImmError("Submission is unavailable for your current identity.", 409, "mr_order_retry")
            return dict(eligible=True, reasons=[], stockAdvice=[], replay=True)
        row = service.find(db, body.orderId) if body.orderId else None
        if row and row.version != getattr(body.values, "expected_version", None):
            raise ImmError("This saved order changed. Your draft is preserved.", 409, "order_stale")
        previous = service.project(keys, row) if row else None
        values = body.values
        if body.resubmit:
            if not row or previous["status"] != "Rejected" or not previous.get("correctionSaved"):
                raise ImmError("Save corrections before resubmitting.", 409, "order_resubmit")
            data = service.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
            data = {**data, "status": "Saved" if kind == "spt" else "Confirmed"}
        else:
            if kind == "immunotherapy":
                db.info["imm_actor"] = current.user.id
                data = service.resolved(db, values, previous)
            elif kind == "spt":
                data = service.resolve(db, keys, values, previous, row.date if row else values.orderDate or today())
            else:
                data = service.resolved(db, current, keys, values, previous)
            from app.services.order_approval import preserve
            preserve(current, kind, data, previous)
        quoted = False
        if kind == "immunotherapy" and not body.resubmit:
            from app.services.immunotherapy_material_pricing import prepare_quote
            quoted = prepare_quote(db, keys, data, values, row.date if row else values.orderDate or today(), previous)
        result = evaluate(db, keys, kind, data, row=row, order_date=getattr(values, "orderDate", None), previous=previous)
        if quoted:
            from app.services.immunotherapy_material_pricing import token
            result["quoteToken"] = token(data, row.date if row else values.orderDate or today(), current.user.id, dict(result))
            result["priceQuote"] = data["pricingEvidence"]
        result["stockAdvice"] = stock_advice(db, kind, data) if result["eligible"] and data["status"] in ACTIVE else []
        return result
    return service.transaction(db, actor, work)
