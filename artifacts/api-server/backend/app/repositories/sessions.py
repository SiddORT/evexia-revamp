import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.models import AuditEvent, AuthSession, RefreshSession, User


_SAFE_LITERAL = re.compile(r"^[a-z][a-z0-9_]*$")
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]*$")
_SAFE_SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def get_session(db: Session, session_id: str, lock: bool = False) -> AuthSession | None:
    query = select(AuthSession).where(AuthSession.id == session_id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    return db.scalar(query)


def get_credential(db: Session, digest: str, lock: bool = False) -> RefreshSession | None:
    query = select(RefreshSession).where(
        RefreshSession.token_hash == digest,
    ).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    return db.scalar(query)


def lock_user(db: Session, user_id: Any) -> User | None:
    return db.scalar(
        select(User).where(User.id == user_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )


def sessions_for_user(
    db: Session, user_id: Any, limit: int, offset: int,
) -> list[AuthSession]:
    bounded_limit = min(max(int(limit), 1), 100)
    bounded_offset = max(int(offset), 0)
    return list(db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == user_id)
        .order_by(AuthSession.created_at.desc(), AuthSession.id.asc())
        .limit(bounded_limit)
        .offset(bounded_offset)
    ))


def _validate_literal(value: str | None, field: str, maximum: int, nullable: bool = False) -> None:
    if value is None and nullable:
        return
    if (not isinstance(value, str) or len(value) > maximum
            or not _SAFE_LITERAL.fullmatch(value)):
        raise ValueError(f"{field} must be a bounded lowercase safe literal")


def event(
    db: Session,
    action: str,
    outcome: str,
    request_id: str | None,
    user_id: Any = None,
    session_id: str | None = None,
    reason: str | None = None,
) -> AuditEvent:
    _validate_literal(action, "action", 80)
    _validate_literal(outcome, "outcome", 16)
    _validate_literal(reason, "reason", 40, nullable=True)
    if request_id is not None and (
        not isinstance(request_id, str) or len(request_id) > 64
        or not _SAFE_REQUEST_ID.fullmatch(request_id)
    ):
        raise ValueError("request_id must be a bounded safe identifier")
    if session_id is not None and (
        not isinstance(session_id, str) or not _SAFE_SESSION_ID.fullmatch(session_id)
    ):
        raise ValueError("session_id must be a bounded opaque identifier")

    row = AuditEvent(
        actor_id=user_id,
        action=action,
        outcome=outcome,
        request_id=request_id,
        session_id=session_id,
        reason=reason,
    )
    db.add(row)
    return row


def revoke_session(
    db: Session,
    session: AuthSession,
    reason: str,
    request_id: str,
) -> bool:
    _validate_literal(reason, "reason", 40)
    now = datetime.now(timezone.utc)
    transitioned = db.execute(
        update(AuthSession)
        .where(AuthSession.id == session.id, AuthSession.status != "REVOKED")
        .values(status="REVOKED", revoked_at=now)
        .returning(AuthSession.id)
        .execution_options(synchronize_session=False)
    ).scalar_one_or_none() is not None

    credentials_revoked = db.execute(
        update(RefreshSession)
        .where(
            RefreshSession.session_id == session.id,
            RefreshSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
        .execution_options(synchronize_session=False)
    ).rowcount > 0

    if transitioned:
        session.status = "REVOKED"
        session.revoked_at = now
        event(
            db, "session_revoked", "success", request_id,
            user_id=session.user_id, session_id=session.id, reason=reason,
        )
    if credentials_revoked:
        event(
            db, "refresh_revoked", "success", request_id,
            user_id=session.user_id, session_id=session.id, reason=reason,
        )
    return transitioned


def revoke_user_sessions(
    db: Session,
    user_id: Any,
    reason: str,
    request_id: str,
) -> list[AuthSession]:
    sessions = list(db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == user_id)
        .order_by(AuthSession.created_at.asc(), AuthSession.id.asc())
        .with_for_update()
    ))
    for session in sessions:
        revoke_session(db, session, reason, request_id)
    return sessions