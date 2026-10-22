"""Persist-before-send, no replay. Uncertain transport submissions stay unknown."""
import logging
import smtplib
import uuid
from datetime import timedelta
from sqlalchemy import select, func, case, text
from app.core.security import utcnow
from app.db.email_delivery_models import EmailAttempt
from app.db.models import AuditEvent
from app.services.account_crypto import AccountCrypto
from app.services.staff_crypto import StaffCrypto
from app.services import recovery_mail, email_templates, auth, template_test_mail

logger = logging.getLogger(__name__)


class MailCrypto(AccountCrypto):
    @staticmethod
    def aad(record_id, field):
        if field != "email":
            raise ValueError()
        return f"evexia:email-attempt:v1:{record_id}:{field}".encode()

    def lookup_index(self, normalized):
        return super().lookup_index("email-attempt:" + normalized.lower())


def record(db, settings, purpose, portal, *, user_id=None, actor_id=None, recipient=None,
           template_id=None, template_version=None):
    row = EmailAttempt(id=uuid.uuid4(), user_id=user_id, actor_id=actor_id,
                       purpose=purpose, portal=portal, status="pending",
                       template_id=template_id, template_version=template_version)
    if recipient:
        crypto = MailCrypto(settings)
        row.recipient_ciphertext = crypto.encrypt(row.id, "email", recipient)
        row.recipient_index = crypto.lookup_index(recipient)
    db.add(row)
    db.commit()  # Fail closed: never send without a durable attempt.
    return row.id


def outcome(db, attempt_id, status, category=None):
    row = db.get(EmailAttempt, attempt_id, populate_existing=True, with_for_update=True)
    row.status, row.failure_category, row.updated_at = status, category, utcnow()
    db.add(AuditEvent(actor_id=row.actor_id, action="email_" + status,
                      resource_type="email_attempt", resource_id=row.id,
                      outcome="failure" if status in ("failed", "unknown") else "success",
                      request_id=db.info.get("request_id")))
    db.commit()
    logger.info("Transactional email outcome correlation=%s status=%s category=%s",
                attempt_id, status, category or "none")


def preparation_interrupted(db, attempt_id):
    """Do not turn uncertain post-handoff persistence into a definitive failure."""
    db.rollback()
    row = db.get(EmailAttempt, attempt_id, populate_existing=True, with_for_update=True)
    if row.status == "pending":
        outcome(db, attempt_id, "failed", "preparation")
    elif row.status == "sending":
        outcome(db, attempt_id, "unknown", "interrupted")
    else:
        db.rollback()  # Preserve an already committed terminal result.


def dispatch(db, settings, attempt_id, recipient, render, *, event=None, snapshot=None):
    """One explicit submission. Network loss after handoff is not definite failure."""
    category, submitting = "configuration", False
    test_transport = None
    try:
        row = db.get(EmailAttempt, attempt_id, populate_existing=True, with_for_update=True)
        if row.status != "pending":
            return  # Never replay accepted, failed or uncertain work.
        is_test = row.purpose == "template_test"
        if is_test:
            test_transport = template_test_mail.resolve(db, settings)
        else:
            recovery_mail.validate_configuration(settings)
        category = "template"
        if is_test:
            if snapshot is None:
                raise ValueError("Saved test snapshot required.")
            template, template_id, version = snapshot
            if (row.template_id, row.template_version) != (template_id, version):
                raise ValueError("Test snapshot mismatch.")
        else:
            if snapshot is not None or event not in ("password_recovery", "account_invitation", "mr_invitation"):
                raise ValueError("Verified event required.")
            if (row.purpose == "password_recovery" and event != "password_recovery"
                    or row.purpose == "account_invitation" and event != (
                        "mr_invitation" if row.portal == "mr" else "account_invitation")):
                raise ValueError("Invitation event mismatch.")
            template, template_id, version = email_templates.resolve_event(db, event)
        row.template_id, row.template_version = template_id, version
        row.status, row.updated_at = "sending", utcnow()
        db.commit()
        rendered = render(template)
        outcome(db, attempt_id, "sending")
        submitting = True
        if is_test:
            recovery_mail.send_smtp(test_transport, recipient, rendered,
                                    sender_name=test_transport.sender_name)
        else:
            recovery_mail.send(settings, recipient, rendered)
    except Exception as error:
        db.rollback()
        if submitting:
            # SMTP refusals are definitive. Other exceptions may occur after DATA.
            definitive = isinstance(error, (smtplib.SMTPRecipientsRefused,
                smtplib.SMTPSenderRefused, smtplib.SMTPAuthenticationError,
                smtplib.SMTPDataError, recovery_mail.RecoveryUnavailable))
            status = "failed" if definitive else "unknown"
            category = "smtp_rejected" if definitive else "transport_uncertain"
        else:
            status = "failed"
            if isinstance(error, template_test_mail.SavedSMTPUnavailable):
                category = error.category
        outcome(db, attempt_id, status, category)
        return
    finally:
        # Do not retain a decrypted transport beyond this explicit attempt.
        test_transport = None
    outcome(db, attempt_id, "smtp_accepted")


def report(db, actor, settings, *, start=None, end=None, purpose=None, status=None,
           recipient="", limit=20, offset=0):
    current = auth.revalidate_identity(db, actor)
    if current.role != "super_admin" or "admin.access" not in current.permissions:
        from fastapi import HTTPException
        raise HTTPException(403, "Email Logs are restricted to Super Admin.")
    # A stale pending/sending state means the in-process operation was interrupted
    # or could not record its result. Never infer failure or resubmit it.
    effective = case(
        ((EmailAttempt.status.in_(["pending", "sending"])) &
         (EmailAttempt.updated_at < utcnow() - timedelta(minutes=2)), "unknown"),
        else_=EmailAttempt.status)
    clauses = []
    if start: clauses.append(EmailAttempt.created_at >= start)
    if end: clauses.append(EmailAttempt.created_at < end)
    if purpose: clauses.append(EmailAttempt.purpose == purpose)
    if status: clauses.append(effective == status)
    crypto = MailCrypto(settings)
    if recipient.strip():
        clauses.append(EmailAttempt.recipient_index == crypto.lookup_index(recipient.strip()))
    # One SQL statement: page and all aggregates share a statement snapshot,
    # including an empty/out-of-range page.
    matched = select(EmailAttempt.id, effective.label("effective")).where(*clauses).cte("matched")
    counts_query = select(matched.c.effective, func.count().label("n")).group_by(matched.c.effective).cte("counts")
    page = select(EmailAttempt).join(matched, matched.c.id == EmailAttempt.id).order_by(
        EmailAttempt.created_at.desc(), EmailAttempt.id.desc()).limit(limit).offset(offset).cte("page")
    count_json = select(func.jsonb_object_agg(counts_query.c.effective, counts_query.c.n)).scalar_subquery()
    page_json = select(func.jsonb_agg(func.to_jsonb(page.table_valued()))).scalar_subquery()
    counts, data = db.execute(select(count_json, page_json)).one()
    counts, data = counts or {}, data or []
    items = []
    from types import SimpleNamespace
    from datetime import datetime
    for data_row in data:
        row = SimpleNamespace(**data_row)
        row.id = uuid.UUID(row.id)
        row.created_at = datetime.fromisoformat(row.created_at)
        row.updated_at = datetime.fromisoformat(row.updated_at)
        stale = row.status in ("pending", "sending") and row.updated_at < utcnow() - timedelta(minutes=2)
        items.append(dict(id=row.id, created_at=row.created_at,
            recipient=crypto.decrypt(row.id, "email", row.recipient_ciphertext) if row.recipient_ciphertext else None,
            purpose=row.purpose, portal=row.portal, template_id=row.template_id, template_version=row.template_version,
            origin="Administrator" if row.actor_id else "Self-service", actor_id=row.actor_id,
            status="unknown" if stale else row.status,
            failure_category="interrupted" if stale else row.failure_category))
    db.commit()
    return dict(items=items, total=sum(counts.values()), counts=counts, limit=limit, offset=offset)
