"""Session-bound, idempotent browser reports; never a proof of a record mutation."""
import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.core.security import utcnow
from app.db.models import AuditEvent
from app.repositories import sessions
from app.services.auth import _effective_session


def record_activity(db, identity, batch, request_id):
    # Serialize with logout/security changes using the established lock order.
    user = sessions.lock_user(db, identity.user.id)
    session = sessions.get_session(db, identity.session_id, lock=True)
    if (not user or not user.is_active or user.system_role != "super_admin"
            or not _effective_session(db, session, user, request_id)):
        db.rollback()
        raise HTTPException(401, "Authentication required")
    # Bounded ingestion, including across tabs sharing the current session.
    ids = {item.event_id: uuid.uuid5(uuid.NAMESPACE_URL, f"evexia:{session.id}:{item.event_id}") for item in batch.events}
    existing = set(db.scalars(select(AuditEvent.id).where(AuditEvent.id.in_(ids.values()))))
    recent = db.scalar(select(func.count()).select_from(AuditEvent).where(
        AuditEvent.session_id == session.id,
        AuditEvent.reason == "browser_reported",
        AuditEvent.created_at >= utcnow() - timedelta(minutes=1),
    ))
    if recent + len(set(ids.values()) - existing) > 120:
        db.rollback()
        raise HTTPException(429, "Activity reporting limit reached")
    for item in batch.events:
        # A supplied event UUID is only a deduplication key. Ownership and
        # session binding always come from the live authenticated server context.
        event_id = ids[item.event_id]
        db.execute(insert(AuditEvent).values(
            id=event_id, actor_id=user.id, session_id=session.id,
            action=f"browser_{item.action}", resource_type=item.resource,
            reason="browser_reported", outcome="reported", request_id=request_id,
        ).on_conflict_do_nothing(index_elements=[AuditEvent.id]))
    db.commit()
