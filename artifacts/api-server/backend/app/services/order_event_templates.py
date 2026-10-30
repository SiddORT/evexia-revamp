"""Protected shared authoring; no configuration change requeues blocked history."""
import uuid
from sqlalchemy import select, func, text
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from app.db.order_notification_models import OrderEventTemplate as Template
from app.db.models import AuditEvent
from app.services.communication import authorize
from app.services.order_event_contract import EVENTS, VARIABLES
from app.schemas.order_notifications import OrderNotificationTemplateInput as TemplateInput

FIELDS = {"eventKey": "event_key", "dltId": "dlt_id", "providerTemplate": "provider_template"}


def present(row, readiness="not_assigned"):
    return dict(id=row.id, channel=row.channel, eventKey=row.event_key, name=row.name,
                enabled=row.enabled, version=row.version, subject=row.subject, html=row.html,
                text=row.text, dltId=row.dlt_id, providerTemplate=row.provider_template,
                language=row.language, parameters=row.parameters, readiness=readiness)


def listing(db, actor, settings):
    authorize(db, actor)
    from app.services.order_notification_transport import readiness
    rows = list(db.scalars(select(Template).order_by(Template.channel, Template.name).limit(101)))
    if len(rows) > 100:
        raise HTTPException(503, "The shared template library exceeds its safe limit.")
    items = []
    for row in rows:
        code = readiness(db, settings, row.channel, row)[0] if row.event_key else "not_assigned"
        items.append(present(row, code or "ready"))
    db.commit()
    return dict(items=items, events=[dict(key=k, label=v) for k, v in EVENTS.items()], variables=list(VARIABLES))


def mutate(db, actor, body, identity=None, *, delete=False):
    try:
        current = authorize(db, actor)
        # One bounded global lock covers creates, deletes and nullable assignment
        # changes; the unique index is an independent competing-writer guard.
        db.execute(text("SELECT pg_advisory_xact_lock(89750975)"))
        row = db.scalar(select(Template).where(Template.id == identity).with_for_update()) if identity else None
        if identity and not row:
            raise HTTPException(404, "Template unavailable. Your draft is preserved.")
        if row and row.version != body.version:
            raise HTTPException(409, "Template changed. Your draft is preserved; load latest separately and reconcile.")
        if delete:
            db.delete(row)
        else:
            if row and row.channel != body.channel:
                raise HTTPException(422, "Channel cannot change. Create a separate template.")
            if not row:
                if db.scalar(select(func.count()).select_from(Template)) >= 100:
                    raise HTTPException(422, "The shared library supports at most 100 templates.")
                row = Template(id=uuid.uuid4(), version=1, created_by=current.user.id)
                db.add(row)
            else:
                row.version += 1
            for field in TemplateInput.model_fields:
                setattr(row, FIELDS.get(field, field), getattr(body, field))
            row.updated_by = current.user.id
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                         action="order_template_deleted" if delete else "order_template_saved",
                         resource_type="order_event_template", resource_id=row.id, outcome="success",
                         request_id=db.info.get("request_id")))
        db.flush()
        result = {"deleted": True} if delete else present(row, "load_readiness")
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "That channel already has this name or event assignment. Your draft is preserved.") from None
    except Exception:
        db.rollback()
        raise
