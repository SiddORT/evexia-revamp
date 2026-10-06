"""Read-only bounded reports. Never load credentials or mutate lifecycle history."""
import re

from sqlalchemy import String, and_, case, cast, exists, func, or_, select

from app.db.models import AuditEvent, AuthSession, MRProfile, User
from app.repositories.report_labels import BROWSER_ACTIONS, RESOURCE_NAMES


def eligible():
    # Same eligibility as auth._load_identity; legacy memberships grant nothing.
    mr = exists(select(MRProfile.id).where(
        MRProfile.user_id == User.id, MRProfile.is_active.is_(True),
    ))
    return and_(User.is_active.is_(True), or_(
        and_(User.system_role == "super_admin", User.is_protected_system_admin.is_(True)),
        and_(User.system_role == "mr", User.is_protected_system_admin.is_(False), mr),
    ))


def valid_session(now):
    return and_(
        eligible(), AuthSession.status == "ACTIVE", AuthSession.expires_at > now,
        AuthSession.token_version == User.token_version,
        AuthSession.identity_version == User.identity_version,
    )


def user_columns():
    return [
        User.id.label("user_id"),
        func.coalesce(User.username, User.email).label("label"),
        User.system_role.label("role"),
        case(
            (User.is_active.is_(False), "disabled"),
            (User.system_role.is_(None), "unmapped"),
            (eligible(), "enabled"), else_="ineligible",
        ).label("account_state"),
    ]


def public_user(row):
    if row["user_id"] is None:
        return None
    # Identity text is rendered only as text, never as markup.
    return dict(id=row["user_id"], label=row["label"], role=row["role"],
                account_state=row["account_state"])


def session_query(now):
    state = effective_state(now)
    return select(
        AuthSession.id, AuthSession.created_at, AuthSession.last_refreshed_at,
        AuthSession.expires_at, AuthSession.revoked_at, AuthSession.persistent,
        state.label("state"), *user_columns(),
    ).select_from(AuthSession).outerjoin(User, User.id == AuthSession.user_id)


def effective_state(now):
    return case(
        (AuthSession.status == "REVOKED", "REVOKED"),
        (or_(AuthSession.status == "EXPIRED", AuthSession.expires_at <= now), "EXPIRED"),
        (valid_session(now), "ACTIVE"), else_="INVALIDATED",
    )


def public_session(row, current_id):
    fields = ("id", "state", "created_at", "last_refreshed_at", "expires_at",
              "revoked_at", "persistent")
    return {**{field: row[field] for field in fields}, "user": public_user(row),
            "is_current": row["id"] == current_id}


def summary(db, now, current_id):
    active = select(func.count(func.distinct(AuthSession.user_id))).select_from(
        AuthSession,
    ).join(User, User.id == AuthSession.user_id).where(valid_session(now)).scalar_subquery()
    total = select(func.count(User.id)).scalar_subquery()
    counts = db.execute(select(total.label("total_users"), active.label("active_users"))).mappings().one()
    current = db.execute(session_query(now).where(AuthSession.id == current_id)).mappings().one()
    return {**dict(counts), "refreshed_at": now, "current_session": public_session(current, current_id)}


def bounded_page(db, query, limit, offset, convert):
    rows = db.execute(query.limit(limit + 1).offset(offset)).mappings().all()
    return {"items": [convert(row) for row in rows[:limit]],
            "limit": limit, "offset": offset, "has_more": len(rows) > limit}


def users(db, limit, offset, q):
    query = select(*user_columns()).select_from(User)
    if q:
        query = query.where(or_(
            User.username.icontains(q, autoescape=True), User.email.icontains(q, autoescape=True),
        ))
    return bounded_page(db, query.order_by(User.created_at.desc(), User.id.desc()),
                        limit, offset, public_user)


def filtered(query, user_column, date_column, user_id, start, end):
    if user_id is not None:
        query = query.where(user_column == user_id)
    if start is not None:
        query = query.where(date_column >= start)
    if end is not None:
        query = query.where(date_column < end)
    return query.order_by(date_column.desc())


def sessions(db, now, current_id, limit, offset, user_id, start, end, q="", state=None):
    query = filtered(session_query(now), AuthSession.user_id, AuthSession.created_at,
                     user_id, start, end).order_by(AuthSession.id.desc())
    if q:
        query = query.where(or_(
            User.username.icontains(q, autoescape=True),
            User.email.icontains(q, autoescape=True),
            and_(AuthSession.id.op("~")(r"^[A-Za-z0-9_-]{1,64}$"),
                 AuthSession.id.icontains(q, autoescape=True)),
        ))
    if state:
        query = query.where(effective_state(now) == state)
    return bounded_page(db, query, limit, offset, lambda row: public_session(row, current_id))


def safe_literal(value, maximum):
    # Older writers were less strict. Never echo unrestricted legacy strings.
    return value if value and len(value) <= maximum and re.fullmatch(r"[a-z][a-z0-9_]*", value) else None


def safe_ref(value):
    return value if value and len(value) <= 64 and re.fullmatch(r"[A-Za-z0-9._:\-]+", value) else None


def safe_session_ref(value):
    # Use exactly the audit writer's URL-safe opaque session alphabet. Session
    # references are public IDs, not refresh tokens or refresh-family UUIDs.
    return value if value and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value) else None


def public_event(row):
    return dict(
        id=row["id"], user=public_user(row), actor_id=row["actor_id"],
        action=safe_literal(row["action"], 80) or "unavailable",
        outcome=safe_literal(row["outcome"], 16) or "unavailable",
        reason=safe_literal(row["reason"], 40),
        resource_type=safe_literal(row["resource_type"], 60), resource_id=row["resource_id"],
        session_id=safe_session_ref(row["session_id"]), request_id=safe_ref(row["request_id"]),
        created_at=row["created_at"],
    )


def event_search(q):
    # Match the public projection, never hidden/unsafe legacy values. NULL actors
    # remain searchable and are not removed by an inner join.
    def literal(column, maximum, fallback=None):
        return case((and_(func.length(column) <= maximum,
                         column.op("~")(r"^[a-z][a-z0-9_]*$")), column), else_=fallback)

    action = literal(AuditEvent.action, 80, "unavailable")
    outcome = literal(AuditEvent.outcome, 16, "unavailable")
    reason = literal(AuditEvent.reason, 40)
    resource = literal(AuditEvent.resource_type, 60)
    session = case((AuditEvent.session_id.op("~")(r"^[A-Za-z0-9_-]{1,64}$"),
                    AuditEvent.session_id))
    request = case((and_(func.length(AuditEvent.request_id) <= 64,
                        AuditEvent.request_id.op("~")(r"^[A-Za-z0-9._:\-]+$")),
                    AuditEvent.request_id))
    fields = [
        case((User.id.is_(None), "Unknown/System"),
             else_=func.coalesce(User.username, User.email)),
        User.email, action, outcome, reason, resource, session, request,
        cast(AuditEvent.resource_id, String),
        case(BROWSER_ACTIONS, value=action, else_=action),
        case(RESOURCE_NAMES, value=resource, else_=resource),
        case((reason == "browser_reported", "Browser-reported"), else_="Server-recorded"),
    ]
    return or_(*(field.icontains(q, autoescape=True) for field in fields))


def events(db, limit, offset, user_id, start, end, q=""):
    query = select(
        AuditEvent.id, AuditEvent.actor_id, AuditEvent.action, AuditEvent.outcome,
        AuditEvent.reason, AuditEvent.resource_type, AuditEvent.resource_id,
        AuditEvent.session_id, AuditEvent.request_id, AuditEvent.created_at, *user_columns(),
    ).select_from(AuditEvent).outerjoin(User, User.id == AuditEvent.actor_id)
    query = filtered(query, AuditEvent.actor_id, AuditEvent.created_at, user_id, start, end)
    if q:
        query = query.where(event_search(q))
    return bounded_page(db, query.order_by(AuditEvent.id.desc()), limit, offset, public_event)
