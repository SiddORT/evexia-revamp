"""Transactional intent only. No transport, manager lookups or historical scans."""
import uuid
from datetime import timedelta
from sqlalchemy import select, func
from fastapi import HTTPException
from app.core.security import utcnow
from app.core.config import get_settings
from app.db.models import User, MRProfile
from app.db.mr_models import MRDirectory
from app.db.order_notification_models import OrderEvent as Event, OrderAlert as Alert, OrderDelivery as Delivery, OrderEventTemplate as Template
from app.db.order_notification_models import OrderNotificationOrigin as Origin
from app.services.order_notification_crypto import seal, unseal
from app.services.order_event_contract import EVENTS
from app.services.auth import revalidate_identity
from app.services.capability_policy import is_super_admin

RETENTION_DAYS = 180


def placing_identity(db, keys, kind, row):
    # Retain creation-time identity across edits/reassignment. Never interpret
    # today's assigned MR or latest editor as the person who placed the order.
    prior = db.scalar(select(Origin).where(Origin.kind == kind, Origin.order_id == row.id))
    if prior:
        return prior
    user_id, mr_id = None, None
    profile = db.scalar(select(MRProfile).where(MRProfile.user_id == row.created_by))
    if profile and profile.id == row.mr_id:
        user = db.get(User, profile.user_id)
        if user and user.system_role == "mr":
            user_id, mr_id = user.id, profile.id
    mr = db.get(MRDirectory, mr_id) if mr_id else None
    identity = uuid.uuid4()
    prior = Origin(id=identity, kind=kind, order_id=row.id, user_id=user_id, mr_id=mr_id,
        payload_ciphertext=seal(keys, identity, {"mrName": mr.name if mr else "Not placed by an MR"}))
    db.add(prior)
    db.flush()
    return prior


def emit(db, keys, kind, row, event, source_key, *, amount=None, snapshot=None):
    """Call under the existing business row lock, before its commit.

    Natural source keys + SQL uniqueness protect competing/replayed intent.
    Configuration is inspected NOW; blocked records are terminal, not a backlog.
    """
    if event not in EVENTS:
        raise ValueError("Unknown order event")
    if db.scalar(select(Event.id).where(Event.kind == kind, Event.order_id == row.id,
                                        Event.source_key == source_key)):
        return
    settings = get_settings()
    origin = placing_identity(db, keys, kind, row)
    placer_user, placer_mr = origin.user_id, origin.mr_id
    mr = db.get(MRDirectory, placer_mr) if placer_mr else None
    name = unseal(keys, origin.id, origin.payload_ciphertext)["mrName"]
    state = {"order_placed": "Awaiting review", "order_confirmed": "Confirmed",
             "order_rejected": "Rejected", "order_resubmitted": "Awaiting review",
             "order_shipped": "Shipped", "order_delivered": "Delivered",
             "order_returned": "Returned", "order_transaction": "Transaction recorded"}[event]
    now, identity = utcnow(), uuid.uuid4()
    from app.services.immunotherapy_placement_notification import scoped, facts, ASSIGNMENT
    row_event = Event(id=identity, kind=kind, order_id=row.id, source_key=source_key,
                      event=event, placer_user_id=placer_user, placer_mr_id=placer_mr,
                      created_at=now)
    payload = dict(number=row.number, status=state, mrName=name, amount=amount)
    special = scoped(row_event)
    if special and snapshot is not None:
        payload.update(facts(snapshot, now))
    link_category = None
    if special:
        from app.services.immunotherapy_placement_notification import order_url
        try:
            payload["orderDetailsUrl"] = order_url(db, settings, row.id)
        except (ValueError, PermissionError):
            link_category = "trusted_portal_origin_required"
    row_event.payload_ciphertext = seal(keys, identity, payload)
    db.add(row_event)
    db.flush()
    recipients = set(db.scalars(select(User.id).where(User.is_protected_system_admin.is_(True),
        User.system_role == "super_admin", User.is_active.is_(True)).limit(1)))
    if placer_user:
        user = db.get(User, placer_user)
        profile = db.get(MRProfile, placer_mr)
        if (user and user.is_active and profile and profile.is_active and mr
                and not mr.deleted_at and mr.status == "active"):
            recipients.add(placer_user)
    from app.services.order_notification_transport import readiness, destination, Blocked
    seen_destinations = set()
    for user_id in sorted(recipients):
        db.add(Alert(id=uuid.uuid4(), event_id=identity, user_id=user_id, read=False, created_at=now))
        for channel in ("email", "sms", "waba"):
            if special and (channel != "email" or user_id == placer_user):
                # Preserve MR bell behavior without creating prohibited handoffs.
                continue
            if special:
                from app.db.email_template_models import EmailTemplate, IMMUNOTHERAPY_TEMPLATE_ID
                template = db.get(EmailTemplate, IMMUNOTHERAPY_TEMPLATE_ID)
                if template and template.event_key != ASSIGNMENT:
                    template = None
            else:
                template = db.scalar(select(Template).where(Template.channel == channel, Template.event_key == event))
            category, config = readiness(db, settings, channel, template)
            if special and link_category:
                category = link_category
            if not category:
                try:
                    recipient = destination(db, settings, row_event, user_id, channel)
                    key = (channel, recipient.casefold() if channel == "email" else recipient)
                    if key in seen_destinations:
                        category = "duplicate_destination"
                    seen_destinations.add(key)
                except Blocked as error:
                    category = error.category
            db.add(Delivery(id=uuid.uuid4(), event_id=identity, user_id=user_id, channel=channel,
                status="blocked" if category else "pending", category=category,
                configuration_id=config.id if config else None, configuration_version=config.version if config else None,
                template_id=template.id if template else None, template_version=template.version if template else None,
                created_at=now, updated_at=now))
    db.flush()


def placed(db, keys, kind, row, previous=None, *, snapshot=None):
    # SPT's unsubmitted Draft is not placement. Draft→Saved is the first event,
    # even when a correction or an Admin submitted the creator's original draft.
    if not previous:
        placing_identity(db, keys, kind, row)
    if row.status == "Draft" or (previous and previous.get("status") != "Draft"):
        return
    emit(db, keys, kind, row, "order_placed", "placed", snapshot=snapshot)


def authorize(db, actor):
    current = revalidate_identity(db, actor)
    if not is_super_admin(current) and not (
            current.role == "mr" and current.mr and current.mr.is_active):
        raise HTTPException(403, "Order notifications are restricted to Super Admin and the placing MR.")
    return current


def alert_row(db, current, identity):
    row = db.scalar(select(Alert).where(Alert.id == identity, Alert.user_id == current.user.id,
        Alert.created_at >= utcnow() - timedelta(days=RETENTION_DAYS)))
    if not row:
        raise HTTPException(404, "Notification unavailable.")
    return row


def feed(db, actor):
    current = authorize(db, actor)
    since = utcnow() - timedelta(days=RETENTION_DAYS)
    clauses = (Alert.user_id == current.user.id, Alert.created_at >= since)
    rows = db.execute(select(Alert, Event).join(Event, Event.id == Alert.event_id)
                      .where(*clauses).order_by(Alert.created_at.desc(), Alert.id.desc()).limit(25))
    from app.services.directory_runtime import crypto_scope
    with crypto_scope(db) as keys:
        items = []
        for alert, event in rows:
            payload = unseal(keys, event.id, event.payload_ciphertext)
            from app.services.immunotherapy_placement_notification import scoped, message
            admin_message = message(payload) if is_super_admin(current) and scoped(event) else None
            # Patient facts are restricted to this Super Admin projection.
            payload = {k: payload[k] for k in ("number", "status", "mrName", "amount") if k in payload}
            payload = financial_payload(db, event, current.user.id, payload)
            items.append(dict(id=alert.id, event=event.event, kind=event.kind,
                **payload, message=admin_message, createdAt=event.created_at, read=alert.read))
    count = db.scalar(select(func.count()).select_from(Alert).where(*clauses, Alert.read.is_(False)))
    db.commit()
    return dict(items=items, unreadCount=count)


def financial_payload(db, event, user_id, payload):
    """A historical bell does not restore current order financial authority."""
    if not payload.get("amount") or user_id != event.placer_user_id:
        return payload
    from app.services import immunotherapy, kits, lupin, spt
    source = {"immunotherapy": immunotherapy, "kits": kits, "lupin": lupin, "spt": spt}[event.kind]
    row = db.get(source.Order, event.order_id)
    if not row or row.mr_id != event.placer_mr_id:
        return {**payload, "amount": None}
    return payload


def mark_read(db, actor, identity, value):
    current = authorize(db, actor)
    row = alert_row(db, current, identity)
    row.read = value
    db.commit()
    return dict(id=row.id, read=row.read)


def target(db, actor, identity):
    current = authorize(db, actor)
    alert = alert_row(db, current, identity)
    event = db.get(Event, alert.event_id)
    kind, order_id = event.kind, event.order_id
    from app.services import immunotherapy, kits, lupin, spt
    from app.services.immunotherapy import ImmError
    source = {"immunotherapy": immunotherapy, "kits": kits, "lupin": lupin, "spt": spt}[kind]
    try:
        # Reuse the actual saved-order permission/ownership and availability
        # boundary. A bell record is never a capability or a document grant.
        source.detail(db, current, order_id)
    except ImmError as error:
        if error.status in (403, 404):
            raise HTTPException(404, "This saved order is no longer available in your authorized workspace.") from None
        raise
    return dict(kind=kind, orderId=order_id)


def delivery_report(db, actor, *, offset=0, limit=25):
    current = authorize(db, actor)
    if not is_super_admin(current):
        raise HTTPException(403, "Delivery status is restricted to Super Admin.")
    rows = list(db.execute(select(Delivery, Event).join(Event, Event.id == Delivery.event_id).where(
        Delivery.created_at >= utcnow() - timedelta(days=RETENTION_DAYS))
        .order_by(Delivery.created_at.desc(), Delivery.id.desc()).offset(offset).limit(limit + 1)))
    now = utcnow()
    items = []
    from app.services.directory_runtime import crypto_scope
    with crypto_scope(db) as keys:
        for row, event in rows[:limit]:
            payload = unseal(keys, event.id, event.payload_ciphertext)
            stale = row.status == "sending" and row.lease_until and row.lease_until < now
            items.append(dict(id=row.id, eventId=row.event_id, channel=row.channel, event=event.event,
                kind=event.kind, number=payload["number"],
                recipient="Placing MR" if row.user_id == event.placer_user_id else "Super Admin",
                status="unknown" if stale else ("pending" if row.status == "leased" else row.status),
                category="transport_interrupted" if stale else row.category,
                createdAt=row.created_at, updatedAt=row.updated_at))
    db.commit()
    return dict(items=items, offset=offset, limit=limit, hasMore=len(rows) > limit)
