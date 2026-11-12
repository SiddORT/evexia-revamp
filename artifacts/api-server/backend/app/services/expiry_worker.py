"""Lifecycle-managed expiry scan and one current Kolkata-day SMTP handoff."""
import asyncio
import logging
import smtplib
import uuid
from datetime import timedelta
from html import escape
from types import SimpleNamespace
from urllib.parse import urlsplit
from sqlalchemy import select, text
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.session import session_factory
from app.db.models import User
from app.db.expiry_models import ExpiryScan, ExpirySeparation, ExpiryDigest, ExpiryTemplate
from app.db.in_house_stock_models import InHouseStock
from app.services import inventory as inv
from app.services.expiry_policy import state, today
from app.services.inventory_expiry import current_rows
from app.services.order_notification_transport import configuration, destination, Blocked
from app.services.email_rendering import RenderedEmail
from app.services.recovery_mail import send_smtp, validate_link_configuration

logger = logging.getLogger(__name__)
DIGEST_LOCK = 145581


def scan():
    """Persist bounded separation evidence; use-time checks remain authoritative."""
    with session_factory()() as db:
        inv.lock(db)
        db.execute(text("SELECT pg_advisory_xact_lock(145579)"))
        crypto = inv.InventoryCrypto(get_settings(), db)
        day, now = today(), utcnow()
        for kind, model in (("lot", inv.Lot), ("reserve", InHouseStock)):
            progress = db.get(ExpiryScan, kind)
            if not progress:
                progress = ExpiryScan(source_kind=kind, cursor=None, updated_at=now)
                db.add(progress)
            stmt = select(model).order_by(model.id)
            if kind == "lot":
                stmt = stmt.where(model.product_id.is_not(None), model.combo_id.is_(None))
            if progress.cursor:
                stmt = stmt.where(model.id > progress.cursor)
            rows = list(db.scalars(stmt.limit(100)))
            for row in rows:
                meta = crypto.open(row.id, "lot" if kind == "lot" else "in_house_reserve", row.payload_ciphertext)
                if state(meta.get("expiryDate"), day) in ("today", "expired") and not db.get(ExpirySeparation, (kind, row.id)):
                    db.add(ExpirySeparation(source_kind=kind, batch_id=row.id, detected_at=now))
            progress.cursor = rows[-1].id if len(rows) == 100 else None
            progress.updated_at = now
        db.commit()


def claim(db):
    now, day = utcnow(), today()
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": DIGEST_LOCK})
    # A crash after the durable sending boundary is uncertain forever, not a
    # retry. Settle old dates too, without replaying historical missed days.
    for old in db.scalars(select(ExpiryDigest).where(
            ExpiryDigest.status.in_(("preparing", "sending")),
            ExpiryDigest.lease_until < now).order_by(ExpiryDigest.day).limit(100).with_for_update()):
        old.status = "unknown" if old.status == "sending" else "failed"
        old.category = "transport_interrupted" if old.status == "unknown" else "preparation_interrupted"
        old.updated_at = now
    row = db.get(ExpiryDigest, day)
    if row:
        db.commit()
        return None
    token = uuid.uuid4()
    db.add(ExpiryDigest(day=day, token=token, status="preparing", category=None,
        updated_at=now, lease_until=now + timedelta(minutes=10)))
    db.commit()
    return day, token


def finish(db, day, token, status, category=None):
    row = db.scalar(select(ExpiryDigest).where(ExpiryDigest.day == day).with_for_update()
                    .execution_options(populate_existing=True))
    if row and row.token == token and row.status in ("preparing", "sending", "unknown"):
        row.status, row.category, row.updated_at = status, category, utcnow()
        db.commit()
    else:
        db.rollback()


def prepare(db, day):
    settings = get_settings()
    # Reuse the explicitly configured trusted portal origin, never a request
    # Host header, bearer link or a guessed deployment hostname.
    try:
        validate_link_configuration(settings)
        url = urlsplit(settings.password_recovery_url)
        origin = f"{url.scheme}://{url.netloc}"
    except Exception:
        raise Blocked("trusted_portal_origin_required") from None
    admins = list(db.scalars(select(User).where(User.is_protected_system_admin.is_(True),
        User.system_role == "super_admin", User.is_active.is_(True)).limit(2)))
    if len(admins) != 1:
        raise Blocked("protected_admin_unavailable")
    recipient = destination(db, settings, SimpleNamespace(kind="allergen_expiry", event="daily",
        placer_user_id=None, placer_mr_id=None), admins[0].id, "email")
    _, transport = configuration(db, settings, "email")
    template = db.get(ExpiryTemplate, "daily_admin")
    if not template:
        raise Blocked("expiry_template_required")
    inv.lock(db)
    db.execute(text("SELECT pg_advisory_xact_lock(145579)"))
    rows = [r for r in current_rows(db, inv.InventoryCrypto(settings, db), day) if r["status"] in ("today", "next15")]
    sections, text_sections = [], []
    for group, heading in (("today", "Expiring today — already unusable"), ("next15", "Tomorrow through day 15 inclusive")):
        matching = [r for r in rows if r["status"] == group]
        lines = [" | ".join(str(r[k]) for k in ("productName", "category", "batchNo", "expiryDate", "quantity", "unit", "locationName")) for r in matching]
        text_sections.append(heading + "\n" + ("\n".join(lines) or "None"))
        sections.append("<h2>" + escape(heading) + "</h2><ul>" + "".join("<li>" + escape(line) + "</li>" for line in lines) + "</ul>")
    # No partial digest when the complete bounded scan cannot be represented.
    soon = origin + "/admin/inventory/expiring"
    expired = origin + "/admin/inventory/expired"
    content = template.introduction + "\n\n" + "\n\n".join(text_sections) + f"\n\nExpiring Soon: {soon}\nExpired Products: {expired}"
    html = "<p>" + escape(template.introduction) + "</p>" + "".join(sections) + (
        f'<p><a href="{escape(soon, quote=True)}">Expiring Soon</a> · '
        f'<a href="{escape(expired, quote=True)}">Expired Products</a></p>')
    rendered = RenderedEmail(template.subject + " — " + day.isoformat(), content, html)
    return lambda: send_smtp(transport, recipient, rendered, sender_name=transport.sender_name)


def process_digest():
    with session_factory()() as db:
        claimed = claim(db)
        if not claimed:
            return
        day, token = claimed
        sending, send = False, None
        try:
            send = prepare(db, day)
            row = db.scalar(select(ExpiryDigest).where(ExpiryDigest.day == day).with_for_update()
                            .execution_options(populate_existing=True))
            if today() != day or row.token != token or row.status != "preparing" or row.lease_until <= utcnow():
                raise Blocked("dispatch_window_expired")
            row.status, row.updated_at, row.lease_until = "sending", utcnow(), utcnow() + timedelta(minutes=10)
            db.commit()
            sending = True
            send()
            finish(db, day, token, "accepted")
        except Blocked as exc:
            db.rollback()
            finish(db, day, token, "blocked", exc.category)
        except Exception as exc:
            db.rollback()
            definite = isinstance(exc, (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused,
                smtplib.SMTPAuthenticationError, smtplib.SMTPDataError))
            finish(db, day, token, "failed" if not sending or definite else "unknown",
                "preparation_failed" if not sending else "provider_rejected" if definite else "transport_uncertain")
        finally:
            send = None


async def run(stop):
    while not stop.is_set():
        try:
            await asyncio.to_thread(scan)
        except Exception:
            logger.warning("Allergen expiry scan unavailable; use-time expiry protection remains fail-closed.")
        try:
            await asyncio.to_thread(process_digest)
        except Exception:
            logger.warning("Allergen expiry digest unavailable; inventory protection does not depend on email.")
        try:
            await asyncio.wait_for(stop.wait(), timeout=60)
        except asyncio.TimeoutError:
            pass
