"""Recipient-bound feeds and separate protected template/delivery administration."""
from uuid import UUID
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.api.deps import current_identity, require_permissions
from app.core.config import get_settings, Settings
from app.db.session import get_db
from app.schemas.order_notifications import (
    OrderNotificationFeed as Feed, OrderNotificationReadInput as ReadInput,
    OrderNotificationReadResult as ReadResult, OrderNotificationTarget as Target,
    OrderNotificationTemplateInput as TemplateInput, OrderNotificationTemplateEdit as TemplateEdit,
    OrderNotificationTemplateRecord as TemplateRecord, OrderNotificationTemplatePage as TemplatePage,
    OrderNotificationVersion as Version, OrderNotificationDeliveryPage as DeliveryPage,
)
from app.services.auth import Identity
from app.services import order_notifications as service, order_event_templates as templates

router = APIRouter(tags=["order-notifications"])
manager = require_permissions("admin.access")


@router.get("/notifications", response_model=Feed, operation_id="listOrderNotifications")
def feed(actor: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    return service.feed(db, actor)


@router.post("/notifications/{identity}/read", response_model=ReadResult, operation_id="readOrderNotification")
def read(identity: UUID, body: ReadInput, actor: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    return service.mark_read(db, actor, identity, body.read)


@router.post("/notifications/{identity}/open", response_model=Target, operation_id="openOrderNotification")
def target(identity: UUID, actor: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    return service.target(db, actor, identity)


@router.get("/admin/order-notification-deliveries", response_model=DeliveryPage, operation_id="listOrderNotificationDeliveries")
def deliveries(offset: int = Query(0, ge=0, le=10000), limit: int = Query(25, ge=1, le=50),
               actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return service.delivery_report(db, actor, offset=offset, limit=limit)


@router.get("/admin/order-event-templates", response_model=TemplatePage, operation_id="listOrderEventTemplates")
def listing(actor: Identity = Depends(manager), db: Session = Depends(get_db),
            settings: Settings = Depends(get_settings)):
    return templates.listing(db, actor, settings)


@router.post("/admin/order-event-templates", response_model=TemplateRecord, operation_id="createOrderEventTemplate", status_code=201)
def create(body: TemplateInput, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return templates.mutate(db, actor, body)


@router.post("/admin/order-event-templates/{identity}/edit", response_model=TemplateRecord, operation_id="editOrderEventTemplate")
def edit(identity: UUID, body: TemplateEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return templates.mutate(db, actor, body, identity)


@router.post("/admin/order-event-templates/{identity}/delete", operation_id="deleteOrderEventTemplate")
def delete(identity: UUID, body: Version, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return templates.mutate(db, actor, body, identity, delete=True)
