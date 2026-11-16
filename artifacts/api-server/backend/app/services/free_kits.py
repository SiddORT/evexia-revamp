"""Irreversible free KIT classification. Never infer free from absent/zero money."""
from calendar import monthrange
from datetime import date
from sqlalchemy import select, func, text
from app.core.security import utcnow
from app.db.free_kit_models import FreeKitPolicy as Policy, FreeKitUse as Use
from app.db.models import AuditEvent
from app.schemas.free_kits import FreeKitEvidence
from app.services.immunotherapy import ImmError
from app.services.capability_policy import is_super_admin

LOCK = 145581


def chargeable_clause(model):
    """Exclude permanent free rows before financial scan budgets/pagination."""
    return ~model.id.in_(select(Use.order_id))


def is_free(saved):
    if not isinstance(saved, dict) or saved.get("freeKit") is None:
        return False
    # Damaged evidence is not silently treated as ordinary financial business.
    try:
        FreeKitEvidence.model_validate(saved["freeKit"])
    except ValueError:
        raise ImmError("Saved Free kit evidence is unavailable; ask Admin to review.",
                       503, "free_kit_evidence") from None
    return True


def protect_edit(saved):
    if is_free(saved):
        raise ImmError("Free kit classification is permanent. Editing, pricing, attachment changes and resubmission are locked.",
                       409, "free_kit_locked")


def protect_financial(kind, saved):
    if kind in ("Kit", "kits") and is_free(saved):
        raise ImmError("Free kits cannot receive payments, credits, invoices or IRNs.",
                       409, "free_kit_financial")


def lock(db):
    # Always after mr_orders.authorize's shared policy/financial/identity locks,
    # before retry and order row locks. Settings participate in the same order.
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})


def ready(db):
    db.execute(text("SELECT version,request_id,actor_id,mr_cap,mr_period,doctor_cap,doctor_period,recorded_at,request_payload FROM free_kit_policy LIMIT 0"))
    db.execute(text("SELECT order_id,mr_id,doctor_id,order_date,policy_version,order_version,actor_id,marked_at FROM free_kit_use LIMIT 0"))
    for table in ("free_kit_policy", "free_kit_use"):
        for suffix, kind in (("immutable", 27), ("no_truncate", 34)):
            if not db.scalar(text("""SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
                WHERE t.tgrelid=to_regclass(:table) AND t.tgname=:name AND t.tgtype=:kind
                AND NOT t.tgisinternal AND t.tgenabled='O' AND p.proname='inventory_immutable')"""),
                {"table": table, "name": f"{table}_{suffix}", "kind": kind}):
                raise ImmError("Free kit quota storage is unavailable.", 503, "free_kit_unavailable")


def policy(db):
    ready(db)
    return db.scalar(select(Policy).order_by(Policy.version.desc()).limit(1))


def caps(row):
    return dict(mrCap=row.mr_cap, mrPeriod=row.mr_period,
                doctorCap=row.doctor_cap, doctorPeriod=row.doctor_period)


def protected(actor):
    if not is_super_admin(actor):
        raise ImmError("Only the protected Super Admin may manage Free kits.", 403, "access_denied")


def settings(db, actor, body=None):
    from app.services import kits
    def work(current, keys):
        protected(current)
        lock(db)
        row = policy(db)
        if body is not None:
            prior = db.scalar(select(Policy).where(Policy.request_id == body.idempotencyKey))
            request = body.model_dump(mode="json")
            if prior:
                if prior.actor_id != current.user.id or prior.request_payload != request:
                    raise ImmError("Retry the original unchanged settings save.", 409, "free_kit_retry")
            else:
                if body.expected_version != (row.version if row else 0):
                    raise ImmError("Free kit settings changed. Your entries are preserved; load saved settings separately to compare.",
                                   409, "free_kit_settings_stale")
                row = Policy(version=(row.version if row else 0) + 1,
                    request_id=body.idempotencyKey, actor_id=current.user.id,
                    mr_cap=body.mrCap, mr_period=body.mrPeriod,
                    doctor_cap=body.doctorCap, doctor_period=body.doctorPeriod,
                    request_payload=request)
                db.add(row)
                db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                    action="free_kit_settings_saved", resource_type="free_kit_policy",
                    outcome="success", request_id=db.info.get("request_id"), created_at=utcnow()))
                db.flush()
        return dict(configured=row is not None, version=row.version if row else 0,
                    caps=caps(row) if row else None,
                    recordedAt=row.recorded_at.isoformat() if row else None,
                    recordedBy=str(row.actor_id) if row else None,
                    confirmedRequest=str(body.idempotencyKey) if body else None)
    return kits.transaction(db, actor, work)


def window(day, period):
    if period == "month":
        return day.replace(day=1), day.replace(day=monthrange(day.year, day.month)[1])
    year = day.year if day.month >= 4 else day.year - 1
    return date(year, 4, 1), date(year + 1, 3, 31)


def usage(db, row, dimension, cap, period):
    start, end = window(row.date, period)
    identity = getattr(row, f"{dimension}_id")
    used = db.scalar(select(func.count()).select_from(Use).where(
        getattr(Use, f"{dimension}_id") == identity, Use.order_date >= start, Use.order_date <= end))
    return dict(cap=cap, period=period, dateFrom=start.isoformat(), dateTo=end.isoformat(),
                timezone="Asia/Kolkata", used=used, remaining=max(0, cap - used))


def eligibility(db, keys, row, saved):
    from app.db.settlement_models import SettlementEntry
    from app.db.credit_note_models import CreditNote
    if is_free(saved):
        return "This order is already permanently classified Free kit."
    if row.status != "Confirmed" or saved.get("status") != "Confirmed":
        return "Only a saved Confirmed order can be marked Free kit."
    if saved.get("approval") or saved.get("rejection") or saved.get("reviewDecision") or saved.get("reviewHistory"):
        return "This order has saved review decisions and cannot become Free kit."
    # Explicit zero pricing is pricing. Keep every historical financial fact.
    if (saved.get("pricing") is not None or saved.get("financialHistory") or
        saved.get("financialContribution") is not None or saved.get("businessParking") is not None or
        saved.get("irn") or saved.get("invoiceAuthority") or
        row.payment_status != "Unpaid" or saved.get("paymentStatus") != "Unpaid"):
        return "Saved or historical rates/financial evidence prevent Free kit classification; nothing has been erased."
    if (db.scalar(select(SettlementEntry.id).where(SettlementEntry.kind == "Kit", SettlementEntry.order_id == row.id).limit(1)) or
        db.scalar(select(CreditNote.id).where(CreditNote.kind == "Kit", CreditNote.order_id == row.id).limit(1))):
        return "Saved receipts or credit history prevent Free kit classification."
    if not row.mr_id or saved.get("mrId") != str(row.mr_id):
        return "Save a valid MR attribution on this unpriced order before marking Free kit."
    if not row.doctor_id or saved.get("doctorId") != str(row.doctor_id):
        return "Save a valid Doctor attribution on this unpriced order before marking Free kit."
    if db.get(Use, row.id):
        return "Permanent quota evidence already exists; ask Admin to review this order."
    return ""


def preview_value(db, keys, row, saved, config):
    mr = usage(db, row, "mr", config.mr_cap, config.mr_period) if config and row.mr_id and saved.get("mrId") == str(row.mr_id) else None
    doctor = usage(db, row, "doctor", config.doctor_cap, config.doctor_period) if config and row.doctor_id and saved.get("doctorId") == str(row.doctor_id) else None
    reason = eligibility(db, keys, row, saved)
    if not reason and not config:
        reason = "Configure both Free kit caps and their periods in Admin Settings first. No initial allowance is assumed."
    if not reason and (not mr["remaining"] or not doctor["remaining"]):
        reason = "Both the saved MR and Doctor must have remaining Free kit allowance in their applicable periods."
    return dict(eligible=not reason, reason=reason, orderVersion=row.version,
                settingsVersion=config.version if config else 0, mr=mr, doctor=doctor)


def action(db, actor, identity, body=None):
    from app.services import kits
    def work(current, keys):
        protected(current)
        lock(db)
        config = policy(db)
        def write():
            row = kits.find(db, identity)
            saved = kits.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
            if body is not None and row.version != body.expected_version:
                raise ImmError("Order changed. Your screen is preserved; open the saved order separately before preparing another mark.",
                               409, "kits_stale")
            quote = preview_value(db, keys, row, saved, config)
            if body is None:
                return quote
            if not quote["eligible"]:
                raise ImmError(quote["reason"], 409, "free_kit_ineligible")
            if config.version != body.settingsVersion:
                raise ImmError("Free kit settings changed. Refresh the allowance preview and confirm again.",
                               409, "free_kit_settings_stale")
            now = utcnow()
            saved["freeKit"] = dict(classification="Free kit", actorId=str(current.user.id),
                markedAt=now.isoformat(), orderVersion=row.version + 1, policyVersion=config.version,
                mrId=str(row.mr_id), doctorId=str(row.doctor_id), orderDate=row.date.isoformat(),
                mr=quote["mr"], doctor=quote["doctor"])
            db.add(Use(order_id=row.id, mr_id=row.mr_id, doctor_id=row.doctor_id, order_date=row.date,
                policy_version=config.version, order_version=row.version + 1, actor_id=current.user.id, marked_at=now))
            row.version += 1
            row.updated_by, row.updated_at = current.user.id, now
            row.snapshot_ciphertext = kits.seal(keys, "orders", row.id, saved)
            db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                action="kits_marked_free", resource_type="kits_order", resource_id=row.id,
                outcome="success", request_id=db.info.get("request_id"), created_at=now))
            db.flush()
            return kits.project(keys, row)
        if body is None:
            return write()
        return kits.idempotent(db, current, keys, body.idempotencyKey,
            {"operation": "mark_free_kit", "id": str(identity), "body": body.model_dump(mode="json")}, write)
    return kits.transaction(db, actor, work)
