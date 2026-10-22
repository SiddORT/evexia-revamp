"""Explicit saved-source test sends. Never calls account or token workflows."""
from fastapi import HTTPException
from app.db.email_template_models import EmailTemplate
from app.db.models import AuditEvent
from app.schemas.email_templates import EmailTemplateInput
from app.services import auth, email_delivery, password_recovery
from app.services.email_rendering import render_test


def send_test(db, actor, settings, template_id, body):
    current = auth.revalidate_identity(db, actor, lock=True)
    if current.role != "super_admin" or "admin.access" not in current.permissions:
        raise HTTPException(403, "Test emails are restricted to Super Admin.")
    # Actor-scoped quota cannot be evaded by changing template or recipient.
    if not password_recovery.rate_limit(db, settings, "template-test", [str(current.user.id)], 10):
        raise HTTPException(429, "Test-email limit reached. Retry after 15 minutes.")
    current = auth.revalidate_identity(db, actor, lock=True)
    if current.role != "super_admin" or "admin.access" not in current.permissions:
        raise HTTPException(403, "Test emails are restricted to Super Admin.")
    row = db.get(EmailTemplate, template_id, populate_existing=True, with_for_update=True)
    if row is None:
        raise HTTPException(404, "Template no longer exists. Load latest.")
    if row.version != body.version:
        raise HTTPException(409, "Saved version changed. Load latest before sending a test.")
    source = EmailTemplateInput(**{k: getattr(row, k) for k in EmailTemplateInput.model_fields})
    snapshot = (source, row.id, row.version)
    db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                      action="email_template_test", resource_type="email_template", resource_id=row.id,
                      outcome="success", request_id=db.info.get("request_id")))
    attempt_id = email_delivery.record(db, settings, "template_test",
        "mr" if source.event_key == "mr_invitation" else "admin", actor_id=current.user.id,
        recipient=str(body.recipient), template_id=row.id, template_version=row.version)
    try:
        email_delivery.dispatch(db, settings, attempt_id, str(body.recipient), render_test, snapshot=snapshot)
    except Exception:
        email_delivery.preparation_interrupted(db, attempt_id)
    from app.db.email_delivery_models import EmailAttempt
    attempt = db.get(EmailAttempt, attempt_id, populate_existing=True)
    messages = {
        "smtp_accepted": "Test email accepted by SMTP. This does not confirm inbox delivery.",
        "failed": "Test email was not sent. Check Email Logs and configuration before a new explicit submission.",
        "unknown": "Test submission outcome is uncertain. Do not automatically resend. Check Email Logs.",
    }
    return dict(id=attempt_id, status=attempt.status,
                message=messages.get(attempt.status, "Test attempt recorded. Check Email Logs; do not resubmit while pending."))
