"""Monday 10:00 Asia/Kolkata, current week only; never retry a consumed claim."""
import asyncio
import logging
import smtplib
import uuid
from datetime import timedelta
from html import escape
from types import SimpleNamespace
from zoneinfo import ZoneInfo
from sqlalchemy import select, text
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.session import session_factory
from app.db.models import User
from app.db.low_stock_models import LowStockWeek, LowStockDelivery
from app.services import inventory as inv
from app.services.low_stock import snapshot
from app.services.low_stock_settings import current, ready
from app.services.account_crypto import AccountCrypto
from app.services.order_notification_transport import configuration, destination, Blocked
from app.services.email_rendering import RenderedEmail
from app.services.recovery_mail import send_smtp

logger = logging.getLogger(__name__)
ZONE = ZoneInfo("Asia/Kolkata")
LOCK = 145589


def due_week(now):
    local = now.astimezone(ZONE)
    monday = local.date() - timedelta(days=local.weekday())
    if local.weekday() == 0 and local.hour < 10:
        return None
    return monday


def portal_link(db, settings):
    # Reuse server-owned admission policy, not request headers, CORS, recipient
    # input, or a guessed deployment address. This is an ordinary protected URL.
    from app.services.immunotherapy_placement_notification import order_url
    origin = order_url(db, settings, uuid.UUID(int=0)).split("/admin/", 1)[0]
    return origin + "/admin/inventory/low-stock-alerts"


def resolve_recipient(db, settings, crypto, slot):
    if slot == "additional":
        email = current(db, crypto)["additional_email"]
        if not email:
            raise Blocked("additional_recipient_not_set")
        from pydantic import EmailStr, TypeAdapter
        return str(TypeAdapter(EmailStr).validate_python(email))
    admins = list(db.scalars(select(User).where(User.is_protected_system_admin.is_(True),
        User.system_role == "super_admin", User.is_active.is_(True)).limit(2)))
    if len(admins) != 1:
        raise Blocked("protected_admin_unavailable")
    return destination(db, settings, SimpleNamespace(kind="low_stock", event="weekly",
        placer_user_id=None, placer_mr_id=None), admins[0].id, "email")


def claim(db):
    now = utcnow()
    week = due_week(now)
    if week is None:
        return None
    from app.core.schema import SCHEMA_REVISION
    revisions = list(db.scalars(text("SELECT version_num FROM alembic_version")))
    if revisions != [SCHEMA_REVISION]:
        return None
    ready(db)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
    # Settle interrupted handoffs, never resume or resend them.
    old = list(db.scalars(select(LowStockDelivery).where(
        LowStockDelivery.status.in_(("preparing", "sending")),
        LowStockDelivery.lease_until < now).limit(100).with_for_update()))
    for row in old:
        row.status = "unknown" if row.status == "sending" else "failed"
        row.category = "transport_interrupted" if row.status == "unknown" else "preparation_interrupted"
        row.payload_ciphertext = None
    if db.get(LowStockWeek, week):
        db.commit()
        return None
    db.add(LowStockWeek(week=week, created_at=now))
    db.flush()
    settings = get_settings()
    from app.services.purchase_received_crypto import ReceiptCrypto
    crypto = ReceiptCrypto(settings)
    tokens, addresses = {}, set()
    for slot in ("super_admin", "additional"):
        token = uuid.uuid4()
        row = LowStockDelivery(week=week, recipient=slot, token=token, status="preparing",
            lease_until=now + timedelta(minutes=10))
        try:
            # A broken optional setting or account decrypt never poisons the
            # other slot's transaction, and addresses are never logged.
            with db.begin_nested():
                email = resolve_recipient(db, settings, crypto, slot)
                index = AccountCrypto(settings).lookup_index("low-stock-weekly:" + email.casefold())
                if index in addresses:
                    row.status = "duplicate"
                else:
                    row.destination_index = index
                    row.payload_ciphertext = crypto.seal(token, "low-stock-recipient", {"email": email})
                    addresses.add(index)
        except Exception as exc:
            row.status = "blocked"
            row.category = exc.category if isinstance(exc, Blocked) else "recipient_unavailable"
        db.add(row)
        if row.status == "preparing":
            tokens[slot] = token
    db.commit()
    return week, tokens


def rendered(data, link):
    instant = data["asOf"]
    lines = [
        " | ".join((r["name"], r["category"], r["quantity"] + " " + r["unit"],
                    "Threshold: " + (r["thresholdLimit"] if r["thresholdLimit"] is not None else "Not set"),
                    r["reason"]))
        for r in data["items"]
    ]
    text_body = f"Weekly low stock alerts\nSnapshot: {instant} (UTC)\n\n" + "\n".join(lines) + "\n\nSign in to inventory: " + link
    html = ("<h1>Weekly low stock alerts</h1><p>Snapshot: " + escape(instant) +
        " (UTC)</p><ul>" + "".join("<li>" + escape(line) + "</li>" for line in lines) +
        '</ul><p><a href="' + escape(link, quote=True) + '">Sign in to inventory</a></p>')
    return RenderedEmail("EVEXIA weekly low stock alerts", text_body, html)


def finish(db, week, slot, token, status, category=None):
    try:
        row = db.get(LowStockDelivery, (week, slot), with_for_update=True, populate_existing=True)
        if row and row.token == token and row.status in ("preparing", "sending", "unknown"):
            row.status, row.category, row.payload_ciphertext = status, category, None
            db.commit()
        else:
            db.rollback()
    except Exception:
        db.rollback()
        # A failed outcome write must not prevent the other mailbox. The week
        # is already consumed; a sending lease later becomes unknown, not retry.
        logger.warning("Weekly low-stock outcome persistence unavailable; the delivery will not be resent.")


def process_digest():
    with session_factory()() as db:
        claimed = claim(db)
        if not claimed:
            return
        week, tokens = claimed
        if not tokens:
            return
        settings = get_settings()
        try:
            data = snapshot(db, inv.InventoryCrypto(settings))
            content = rendered(data, portal_link(db, settings)) if data["items"] else None
            db.commit()  # release inventory lock before any network work
        except Exception:
            db.rollback()
            for slot, token in tokens.items():
                finish(db, week, slot, token, "blocked", "complete_inventory_or_link_unavailable")
            return
        for slot, token in tokens.items():
            sending = False
            try:
                if content is None:
                    finish(db, week, slot, token, "empty")
                    continue
                # Transport preparation is independent for each recipient.
                _, transport = configuration(db, settings, "email")
                row = db.get(LowStockDelivery, (week, slot), with_for_update=True, populate_existing=True)
                if (not row or row.token != token or row.status != "preparing"
                        or row.lease_until <= utcnow() or due_week(utcnow()) != week):
                    raise Blocked("dispatch_window_expired")
                from app.services.purchase_received_crypto import ReceiptCrypto
                email = ReceiptCrypto(settings).open(token, "low-stock-recipient", row.payload_ciphertext)["email"]
                row.status, row.lease_until = "sending", utcnow() + timedelta(minutes=10)
                db.commit()  # durable boundary BEFORE entering SMTP
                sending = True
                send_smtp(transport, email, content, sender_name=transport.sender_name)
                finish(db, week, slot, token, "accepted")
            except Exception as exc:
                db.rollback()
                definite = isinstance(exc, (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused,
                    smtplib.SMTPAuthenticationError, smtplib.SMTPDataError))
                status = "blocked" if isinstance(exc, Blocked) else "failed" if not sending or definite else "unknown"
                category = exc.category if isinstance(exc, Blocked) else "preparation_failed" if not sending else "provider_rejected" if definite else "transport_uncertain"
                finish(db, week, slot, token, status, category)


async def run(stop):
    while not stop.is_set():
        try:
            await asyncio.to_thread(process_digest)
        except Exception:
            logger.warning("Weekly low-stock digest unavailable; no delivery retry or backlog was scheduled.")
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
        except asyncio.TimeoutError:
            pass
