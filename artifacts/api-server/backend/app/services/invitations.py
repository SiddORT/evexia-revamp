"""Explicit invitations never change roles, identity types or access enablement."""
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import select, func
from app.core.security import utcnow
from app.db.models import User, MRProfile, AuditEvent
from app.db.staff_models import StaffProfile
from app.db.mr_models import MRDirectory
from app.db.email_delivery_models import EmailAttempt
from app.repositories.sessions import lock_user
from app.services import auth, password_recovery, email_delivery


def invite(db, actor, settings, kind, record_id, version):
    current = auth.revalidate_identity(db, actor, lock=True)
    if current.role != "super_admin" or "admin.access" not in current.permissions:
        raise HTTPException(403, "Invitations are restricted to Super Admin.")
    model = StaffProfile if kind == "staff" else MRDirectory
    saved = db.get(model, record_id)
    if not saved or saved.deleted_at:
        raise HTTPException(404, "Record is missing or deleted. Refresh the directory.")
    owner_id = saved.user_id if kind == "staff" else db.get(MRProfile, record_id).user_id
    user = lock_user(db, owner_id)
    saved = db.get(model, record_id, populate_existing=True, with_for_update=True)
    if saved.version != version:
        raise HTTPException(409, "Record changed. Refresh before inviting.")
    if saved.deleted_at or saved.status != "active" or not user or not user.is_active:
        raise HTTPException(409, "Activate the saved account before inviting.")
    if kind == "staff" and (not saved.workspace_login_enabled or saved.custom_role_id is None):
        raise HTTPException(409, "Set up staff workspace access and choose a custom role first. Inviting does not grant access.")
    try:
        identity = auth._load_identity(db, user, lock=True, allow_password_setup=True)
        if not password_recovery._eligible(identity) or ((identity.staff is not None) != (kind == "staff")):
            raise auth.AuthError()
        recipient = password_recovery._recipient(identity, settings)
    except auth.AuthError:
        raise HTTPException(409, "This account is not invitation-eligible. Check its email, status and access setup.") from None
    recent = list(db.scalars(select(EmailAttempt).where(
        EmailAttempt.user_id == user.id, EmailAttempt.purpose == "account_invitation",
        EmailAttempt.created_at > utcnow() - timedelta(minutes=15))))
    if any(row.status in ("pending", "sending") and row.updated_at > utcnow() - timedelta(minutes=2) for row in recent):
        raise HTTPException(409, "An invitation is pending. Check Email Logs before sending again.")
    if len(recent) >= 5:
        raise HTTPException(429, "Invitation limit reached. Retry after 15 minutes.")
    db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
        action="account_invitation", resource_type=kind, resource_id=record_id,
        outcome="success", request_id=db.info.get("request_id")))
    attempt_id = email_delivery.record(db, settings, "account_invitation",
        password_recovery._kind(identity), user_id=user.id, actor_id=current.user.id, recipient=recipient)
    try:
        password_recovery.send_identity(db, settings, identity, recipient, "account_invitation", attempt_id)
    except Exception:
        # Could include a failure recording the SMTP result. Never call that a
        # definite pre-send failure or erase already committed acceptance.
        email_delivery.preparation_interrupted(db, attempt_id)
    row = db.get(EmailAttempt, attempt_id)
    messages = {
        "smtp_accepted": "Invitation accepted by SMTP. This does not confirm inbox delivery. The link expires in 15 minutes.",
        "failed": "Invitation was not sent. Check Email Logs and SMTP/template configuration before explicitly sending again.",
        "unknown": "Submission outcome is uncertain. Do not automatically send again. Check Email Logs and request a new link only when needed.",
    }
    return dict(id=attempt_id, status=row.status, message=messages.get(row.status, "Invitation recorded. Check Email Logs."))
