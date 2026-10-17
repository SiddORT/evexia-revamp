"""Super Admin management with bounded snapshots and transactional metadata-only audit."""
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.db.email_template_models import EmailTemplate, RECOVERY_EVENT, RECOVERY_TEMPLATE_ID
from app.db.models import AuditEvent
from app.schemas.email_templates import EmailTemplateInput
from app.services.auth import revalidate_identity
from app.services.email_rendering import VARIABLES

EVENTS = [dict(key=RECOVERY_EVENT, label="Password recovery", required=True, variables=list(VARIABLES))]


class EmailTemplateNotFound(HTTPException):
    """Distinct from an absent route on a stale running API."""
    def __init__(self):
        super().__init__(404, "Template no longer exists. Reload the library.")


def reject(status, message):
    raise HTTPException(status, message)


def public(row):
    # Validate stored source too; damaged rows must never masquerade as usable.
    data = EmailTemplateInput(**{k: getattr(row, k) for k in EmailTemplateInput.model_fields}).model_dump()
    return dict(**data, id=row.id, version=row.version, protected=row.id == RECOVERY_TEMPLATE_ID)


def resolve_recovery(db):
    rows = list(db.scalars(select(EmailTemplate).where(
        EmailTemplate.event_key == RECOVERY_EVENT).limit(2)))
    if len(rows) != 1 or rows[0].id != RECOVERY_TEMPLATE_ID:
        raise ValueError("Recovery template unavailable.")
    # Immutable source snapshot; no ORM instance is needed during SMTP.
    return EmailTemplateInput(**{k: getattr(rows[0], k) for k in EmailTemplateInput.model_fields})


def operation(db, actor, *, body=None, row_id=None, action=None):
    try:
        current = revalidate_identity(db, actor, lock=True)
        if current.role != "super_admin" or "admin.access" not in current.permissions:
            reject(403, "Email templates are restricted to Super Admin.")
        if action:
            # Serializes capacity, names and assignments, including first create.
            db.execute(text("SELECT pg_advisory_xact_lock(5310043)"))
        row = db.get(EmailTemplate, row_id, populate_existing=True,
                     with_for_update=bool(action)) if row_id else None
        if row_id and row is None:
            raise EmailTemplateNotFound()
        if action:
            if row and row.version != body.version:
                reject(409, "Template changed. Your draft is kept. Reopen the latest version before editing.")
            if action == "delete":
                if row.id == RECOVERY_TEMPLATE_ID:
                    reject(409, "Required password recovery template cannot be deleted.")
                db.delete(row)
            else:
                values = body.model_dump(exclude={"version", "creation_id"})
                if values["event_key"] is not None and (not row or row.id != RECOVERY_TEMPLATE_ID):
                    reject(409, "Password recovery is already assigned to its required template.")
                if row and row.id == RECOVERY_TEMPLATE_ID and values["event_key"] != RECOVERY_EVENT:
                    reject(409, "Required password recovery assignment cannot be changed.")
                if action == "create":
                    if len(list(db.scalars(select(EmailTemplate.id).limit(100)))) >= 100:
                        reject(409, "The email library is full (100 templates). Delete an unassigned template first.")
                    if body.creation_id == RECOVERY_TEMPLATE_ID or db.get(EmailTemplate, body.creation_id):
                        reject(409, "Creation identity already exists. Load latest templates to reconcile.")
                    row = EmailTemplate(id=body.creation_id, **values, version=1, provenance="administrator",
                                        created_by=current.user.id, updated_by=current.user.id)
                    db.add(row)
                else:
                    if row.version >= 2147483647:
                        reject(409, "Template version exhausted. Contact the operator.")
                    for key, value in values.items():
                        setattr(row, key, value)
                    row.version += 1
                    row.updated_by = current.user.id
            db.add(AuditEvent(actor_id=current.user.id, action="email_template_" + action,
                              resource_type="email_template", resource_id=row.id,
                              request_id=db.info.get("request_id"), session_id=current.session_id,
                              outcome="success"))
            db.flush()
        if row_id and action is None:
            result = public(row)
        else:
            rows = list(db.scalars(select(EmailTemplate).order_by(EmailTemplate.id).limit(101)))
            if len(rows) > 100:
                reject(503, "Email library exceeds its bound. Contact the operator.")
            result = dict(items=[public(r) for r in rows], events=EVENTS)
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        reject(409, "Template name or event is already in use. Reload the library and review.")
    except (SQLAlchemyError, ValueError):
        db.rollback()
        reject(503, "Email template storage is unavailable. Ask the operator to check the approved migration and stored content.")
    except Exception:
        db.rollback()
        raise
