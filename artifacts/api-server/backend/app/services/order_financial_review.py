"""Financial evidence for deferred-price submissions; never a payment or decision."""
from collections import defaultdict
from sqlalchemy import select
from app.db.doctor_models import DoctorDirectory
from app.db.mr_models import MRDirectory
from app.services.immunotherapy import ImmError
from app.services import settlements
from app.services.order_eligibility import ACTIVE, EXCLUDED, today

DEFERRED = frozenset({"kits", "spt", "lupin"})


def pending_pricing(label, saved, status):
    """Only deliberate, undecided absence is pending; damaged pricing is not."""
    if status not in {"Confirmed", "Saved", "Draft", "Rejected"} or saved.get("approval"):
        return False
    if label == "Kit":
        return saved.get("pricing") is None
    if saved.get("pricingState") != "Pending pricing" or saved.get("total") is not None:
        return False
    if label == "SPT":
        patients = saved.get("patients")
        if not isinstance(patients, list) or not patients or not all(isinstance(p, dict) and "amount" in p for p in patients):
            return False
        for patient in patients:
            if patient["amount"] != "":
                settlements.exact(patient["amount"])
        return any(p["amount"] == "" for p in patients)
    return (label == "Lupin" and saved.get("price") is None
            and type(saved.get("patientCount")) is int and 1 <= saved["patientCount"] <= 1000000)


def settings(db, identity):
    row = db.scalar(select(MRDirectory).where(MRDirectory.id == identity)
                    .execution_options(populate_existing=True))
    if not row or row.deleted_at:
        raise ImmError("Current MR financial settings are unavailable.", 409, "mr_eligibility_unavailable")
    settlements.exact(row.paymentLimit)
    if isinstance(row.doctorDaysLimit, bool) or not isinstance(row.doctorDaysLimit, int) or not 0 <= row.doctorDaysLimit <= 3650:
        raise ImmError("Current inherited Doctor Days Limit is unavailable.", 409, "mr_eligibility_unavailable")
    return row


def effective_days(db, doctor_id):
    doctor = db.get(DoctorDirectory, doctor_id)
    if not doctor or doctor.deleted_at:
        raise ImmError("The Doctor's current assignment is unavailable.", 409, "mr_eligibility_unavailable")
    return doctor, settings(db, doctor.mrId).doctorDaysLimit


def obligations(db, keys, mr_id, *, exclude=None, doctor_id=None):
    """Bounded, owner-scoped saved orders and committed allocations, once per order."""
    from app.services.shipments import SOURCES
    candidates, scope, scanned = [], defaultdict(list), 0
    for label, source in SOURCES.items():
        clauses = [source.Order.mr_id == mr_id]
        if doctor_id:
            clauses.append(source.Order.doctor_id == doctor_id)
        rows = list(db.scalars(select(source.Order).where(*clauses).order_by(source.Order.id)
                               .limit(settlements.SCAN_LIMIT + 1)))
        scanned += len(rows)
        if scanned > settlements.SCAN_LIMIT:
            raise ImmError("Complete financial history exceeds the safe evaluation size.", 409, "mr_eligibility_unavailable")
        for row in rows:
            if exclude == (label, row.id) or row.status in EXCLUDED:
                continue
            if row.status not in ACTIVE:
                raise ImmError("A saved order's financial status is unavailable.", 409, "mr_eligibility_unavailable")
            candidates.append((label, source, row))
            scope[label].append(row.id)
    receipts = settlements.history(db, keys, scope)
    result, pending = [], []
    for label, source, row in candidates:
        saved = source.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
        paid = sum((settlements.exact(r["amount"]) for r in receipts[(label, row.id)]), settlements.ZERO)
        total = settlements.saved_total(label, saved)
        if total is None:
            if pending_pricing(label, saved, row.status) and not paid:
                pending.append(dict(kind=label, id=str(row.id), number=row.number, date=row.date.isoformat()))
                continue
            raise ImmError(f"Saved financial evidence is unavailable for {row.number}; this is not pending pricing.",
                           409, "mr_eligibility_unavailable")
        if paid > total:
            raise ImmError("Committed payments exceed a saved total.", 409, "mr_eligibility_unavailable")
        result.append((row, saved, total - paid))
    return result, pending


def doctor_position(records, doctor_id, days, business_date):
    relevant = [(row, saved, balance) for row, saved, balance in records
                if row.doctor_id == doctor_id and balance > 0]
    oldest = min((row.date for row, _, _ in relevant), default=None)
    age = (business_date - oldest).days if oldest else None
    balance = sum((balance for _, _, balance in relevant), settlements.ZERO)
    return dict(doctorPendingBalance=settlements.fmt(balance),
                oldestDoctorUnpaidDate=oldest.isoformat() if oldest else None,
                oldestDoctorUnpaidAgeDays=age, doctorDaysLimit=days,
                blocked=bool(days and age is not None and age >= days))


def submission(db, keys, kind, data, *, row=None):
    from app.services.mr_orders import scope_identity
    from app.services.order_eligibility import LABELS
    identity = scope_identity(db)
    business_date = today()
    policy = settings(db, identity)
    doctor, days = effective_days(db, data["doctorId"])
    # Disabled days do not require prices, or unrelated financial repair.
    records, pending = obligations(db, keys, identity, exclude=(LABELS[kind], row.id) if row else None,
                                  doctor_id=doctor.id) if days else ([], [])
    position = doctor_position(records, doctor.id, days, business_date)
    if not days:
        position["doctorPendingBalance"] = None  # Disabled, not a zero-balance assertion.
    reasons = []
    if position["blocked"]:
        reasons.append(dict(code="mr_doctor_days_limit", limit=str(days), balance=position["doctorPendingBalance"],
            ageDays=position["oldestDoctorUnpaidAgeDays"],
            message=f'{doctor.name}: unpaid balance ₹{position["doctorPendingBalance"]}; oldest relevant saved order '
                    f'{position["oldestDoctorUnpaidDate"]}, aged {position["oldestDoctorUnpaidAgeDays"]} days; '
                    f'inherited Doctor Days Limit {days} days has been reached.'))
    return dict(eligible=not reasons, reasons=reasons, paymentLimit=settlements.fmt(policy.paymentLimit),
                businessDate=business_date.isoformat(), **{k: v for k, v in position.items() if k != "blocked"})


def review(db, keys, kind, row, data, previous):
    from app.services.order_eligibility import LABELS, proposed_total
    business_date = today()
    if not row.mr_id:
        raise ImmError("An MR assignment is required for financial review.", 409, "mr_eligibility_unavailable")
    policy = settings(db, row.mr_id)
    records, pending = obligations(db, keys, row.mr_id, exclude=(LABELS[kind], row.id))
    outstanding = sum((balance for _, _, balance in records), settlements.ZERO)
    # Resolved Admin input already validates pricing against the proposed basis.
    # Passing the old composition here would reject an intentional repricing.
    total = proposed_total(kind, data)
    receipts = settlements.history(db, keys, {LABELS[kind]: [row.id]})
    paid = sum((settlements.exact(r["amount"]) for r in receipts[(LABELS[kind], row.id)]), settlements.ZERO)
    if total is not None and paid > total:
        raise ImmError("Proposed pricing is below committed payments.", 409, "order_pricing")
    limit = settlements.exact(policy.paymentLimit)
    exposure = outstanding + total - paid if total is not None else None
    state = ("Pending pricing" if exposure is None else "Disabled" if not limit else
             "Exceeded" if exposure > limit else "Reached" if exposure == limit else "Below limit")
    evidence = dict(orderId=str(row.id), version=row.version, paymentLimit=settlements.fmt(limit),
        outstanding=settlements.fmt(outstanding), proposedAmount=settlements.fmt(total) if total is not None else None,
        committedTargetPayments=settlements.fmt(paid),
        resultingExposure=settlements.fmt(exposure) if exposure is not None else None,
        amountLimitState=state, pendingPricingOrders=pending,
        exposureComplete=not pending and (kind != "kits" or total is not None),
        businessDate=business_date.isoformat())
    # Equal payable totals are not interchangeable pricing/parking decisions.
    # Bind draft evidence to the complete Kits financial basis as well as the
    # saved version, current limits, payments and scoped history above.
    basis = [{k: data.get(k) for k in (
        "pricing", "businessParking", "mrId", "kit", "lancets", "applicators", "tray",
    )}] if kind == "kits" else []
    evidence["token"] = keys._index("order-financial-review:v1", [kind, evidence, *basis])
    return evidence


def saved_review(db, actor, identity, kind):
    from app.services import kits, spt, lupin
    from app.services.capability_policy import is_super_admin
    service = {"kits": kits, "spt": spt, "lupin": lupin}[kind]
    def work(current, keys):
        if current.role == "mr" or (kind in {"kits", "lupin"} and not is_super_admin(current)):
            raise ImmError("Admin review access is required.", 403, "access_denied")
        row = service.find(db, identity)
        saved = service.project(keys, row)
        return review(db, keys, kind, row, saved, saved)
    return service.transaction(db, actor, work, action=None if kind == "lupin" else "edit")


def dashboard(db, actor, *, offset=0, limit=25):
    def work(current, keys):
        if current.role != "mr":
            raise ImmError("MR dashboard access is required.", 403, "access_denied")
        business_date = today()
        policy = settings(db, current.mr.id)
        records, pending = obligations(db, keys, current.mr.id) if policy.doctorDaysLimit else ([], [])
        identities = {row.doctor_id for row, _, balance in records if balance > 0}
        doctors = list(db.scalars(select(DoctorDirectory).where(
            DoctorDirectory.id.in_(identities), DoctorDirectory.mrId == current.mr.id,
            DoctorDirectory.deleted_at.is_(None)).order_by(DoctorDirectory.id)))
        blocked = []
        for doctor in doctors:
            position = doctor_position(records, doctor.id, policy.doctorDaysLimit, business_date)
            if position.pop("blocked"):
                blocked.append(dict(doctorId=str(doctor.id), doctorName=doctor.name, **position))
        return dict(paymentLimit=settlements.fmt(policy.paymentLimit), doctorDaysLimit=policy.doctorDaysLimit,
                    businessDate=business_date.isoformat(), items=blocked[offset:offset + limit],
                    total=len(blocked), offset=offset, limit=limit, pendingPricingOrders=pending)
    return settlements.transaction(db, actor, work)
