"""Bounded post-commit worker; a committed handoff is never automatically retried."""
import asyncio
import logging
import smtplib
import uuid
from datetime import timedelta
from sqlalchemy import select, or_
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.session import session_factory
from app.db.order_notification_models import OrderEvent as Event, OrderDelivery as Delivery, OrderEventTemplate as Template
from app.services.directory_runtime import crypto_scope
from app.services.order_notification_crypto import unseal
from app.services.order_notification_transport import prepare, Blocked, ProviderRejected
from app.services.order_event_contract import variables
from app.services.order_notifications import RETENTION_DAYS, financial_payload

logger = logging.getLogger(__name__)


def claim(db):
    now = utcnow()
    # Reclaim only work that never crossed the durable sending boundary.
    row = db.scalar(select(Delivery).where(or_(
        Delivery.status == "pending",
        (Delivery.status == "leased") & (Delivery.lease_until < now),
        (Delivery.status == "sending") & (Delivery.lease_until < now),
    )).order_by(Delivery.created_at, Delivery.id).limit(1).with_for_update(skip_locked=True))
    if not row:
        db.rollback()
        return None
    if row.status == "sending":
        row.status, row.category, row.updated_at = "unknown", "transport_interrupted", now
        db.commit()
        return None
    if row.created_at < now - timedelta(hours=24):
        row.status, row.category, row.updated_at = "blocked", "dispatch_window_expired", now
        db.commit()
        return None
    row.status, row.lease_token = "leased", uuid.uuid4()
    row.lease_until, row.updated_at = now + timedelta(minutes=2), now
    identity, token = row.id, row.lease_token
    db.commit()
    return identity, token


def finish(db, identity, token, status, category=None):
    row = db.scalar(select(Delivery).where(Delivery.id == identity).with_for_update()
                    .execution_options(populate_existing=True))
    # A paused/competing worker cannot overwrite a reclaimed lease or an
    # already-terminal outcome. A late observed acceptance may settle its OWN
    # interrupted sending marker, but never cause a second external submission.
    if not row or row.lease_token != token or row.status not in ("leased", "sending", "unknown"):
        db.rollback()
        return
    row.status, row.category = status, category
    row.updated_at, row.lease_until = utcnow(), None
    db.commit()


def process_one():
    """One durable lease, one channel, at most one external handoff."""
    with session_factory()() as db:
        claimed = claim(db)
        if not claimed:
            return
        identity, token = claimed
        submitting = False
        try:
            row = db.scalar(select(Delivery).where(Delivery.id == identity).with_for_update()
                            .execution_options(populate_existing=True))
            if row.status != "leased" or row.lease_token != token or row.lease_until <= utcnow():
                db.rollback()
                return
            event = db.scalar(select(Event).where(Event.id == row.event_id).with_for_update())
            from app.services.immunotherapy_placement_notification import scoped
            if scoped(event):
                from app.db.email_template_models import EmailTemplate
                from app.services.order_notification_transport import destination
                destination(db, get_settings(), event, row.user_id, row.channel)
                template = db.get(EmailTemplate, row.template_id) if row.template_id else None
            else:
                template = db.get(Template, row.template_id) if row.template_id else None
            with crypto_scope(db) as keys:
                data = unseal(keys, event.id, event.payload_ciphertext)
                if scoped(event) and (not data.get("patientName") or not data.get("placementDate")):
                    raise Blocked("placement_facts_unavailable")
                if scoped(event):
                    from app.services.immunotherapy_placement_notification import email_values
                    try:
                        scoped_values = email_values(data)
                    except ValueError:
                        raise Blocked("placement_facts_unavailable") from None
                data = financial_payload(db, event, row.user_id, data)
                send = prepare(db, get_settings(), row, event, template,
                               scoped_values if scoped(event) else variables(event, data, event.created_at))
            # Preparation stays inside the lease transaction; only the sending
            # marker is committed before calling an external provider.
            row.status, row.updated_at = "sending", utcnow()
            row.lease_until = utcnow() + timedelta(minutes=10)
            db.commit()
            submitting = True
            send()
            finish(db, identity, token, "accepted")
        except Blocked as error:
            db.rollback()
            finish(db, identity, token, "blocked", error.category)
        except Exception as error:
            db.rollback()
            if submitting:
                definite = isinstance(error, (ProviderRejected, smtplib.SMTPRecipientsRefused,
                    smtplib.SMTPSenderRefused, smtplib.SMTPAuthenticationError, smtplib.SMTPDataError))
                finish(db, identity, token, "failed" if definite else "unknown",
                       "provider_rejected" if definite else "transport_uncertain")
            else:
                # Pre-send failures are safe but not automatically looped.
                # Recovery retries a crashed lease, not invalid configuration.
                finish(db, identity, token, "failed", "preparation_failed")
        finally:
            # Never cache decrypted payloads, rendered messages or credentials.
            send = None


def prune():
    with session_factory()() as db:
        # Bounded deletion; cascades remove feeds/attempts. Unfinished handoffs
        # are settled first by the worker, never silently erased.
        ids = list(db.scalars(select(Event.id).where(
            Event.created_at < utcnow() - timedelta(days=RETENTION_DAYS),
            ~select(Delivery.id).where(Delivery.event_id == Event.id,
                Delivery.status.in_(["pending", "leased", "sending"])).exists())
            .order_by(Event.created_at, Event.id).limit(100).with_for_update(skip_locked=True)))
        for identity in ids:
            db.delete(db.get(Event, identity))
        db.commit()


async def run(stop):
    """One bounded serial loop per API process; SQL leases coordinate processes."""
    cycles = 0
    while not stop.is_set():
        try:
            await asyncio.to_thread(process_one)
            cycles += 1
            if cycles % 300 == 0:
                await asyncio.to_thread(prune)
        except Exception:
            # Fixed message only: driver/provider exceptions may contain PII.
            logger.warning("Order notification worker unavailable; committed business records are unaffected.")
        try:
            await asyncio.wait_for(stop.wait(), timeout=2)
        except asyncio.TimeoutError:
            pass
