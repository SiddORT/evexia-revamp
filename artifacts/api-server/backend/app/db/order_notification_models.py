"""Minimal encrypted order events; feed state and at-most-once transport intent."""
import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class OrderNotificationOrigin(Base):
    """Immutable placing identity outlives feed retention and order reassignment."""
    __tablename__ = "order_notification_origins"
    __table_args__ = (UniqueConstraint("kind", "order_id", name="uq_order_notification_origin"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))
    order_id: Mapped[uuid.UUID] = mapped_column()
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    mr_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mr_profiles.id"))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class OrderEvent(Base):
    __tablename__ = "order_notification_events"
    __table_args__ = (
        UniqueConstraint("kind", "order_id", "source_key", name="uq_order_notification_source"),
        CheckConstraint("kind IN ('immunotherapy','spt','lupin','kits')", name="ck_order_notification_kind"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_order_notification_cipher"),
        Index("ix_order_notification_retention", "created_at", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))
    order_id: Mapped[uuid.UUID] = mapped_column()
    source_key: Mapped[str] = mapped_column(String(100))
    event: Mapped[str] = mapped_column(String(40))
    placer_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    placer_mr_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mr_profiles.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class OrderAlert(Base):
    __tablename__ = "order_notification_alerts"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_order_alert_recipient"),
        Index("ix_order_alert_recent", "user_id", "created_at", "id"),
        Index("ix_order_alert_unread", "user_id", "read", "created_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("order_notification_events.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    read: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OrderDelivery(Base):
    __tablename__ = "order_notification_deliveries"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", "channel", name="uq_order_delivery_recipient"),
        CheckConstraint("channel IN ('email','sms','waba')", name="ck_order_delivery_channel"),
        CheckConstraint("status IN ('pending','leased','sending','accepted','failed','unknown','blocked')",
                        name="ck_order_delivery_status"),
        Index("ix_order_delivery_work", "status", "created_at", "id"),
        Index("ix_order_delivery_recent", "created_at", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("order_notification_events.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    channel: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(12))
    category: Mapped[str | None] = mapped_column(String(60))
    configuration_id: Mapped[uuid.UUID | None] = mapped_column()
    configuration_version: Mapped[int | None] = mapped_column(Integer)
    template_id: Mapped[uuid.UUID | None] = mapped_column()
    template_version: Mapped[int | None] = mapped_column(Integer)
    destination_index: Mapped[str | None] = mapped_column(String(64))
    lease_token: Mapped[uuid.UUID | None] = mapped_column()
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class OrderEventTemplate(Base):
    """Order assignments are separate from recovery/invitation transport purposes."""
    __tablename__ = "order_event_templates"
    __table_args__ = (
        UniqueConstraint("channel", "event_key", name="uq_order_template_event"),
        Index("uq_order_template_name", "channel", text("lower(name)"), unique=True),
        CheckConstraint("channel IN ('email','sms','waba')", name="ck_order_template_channel"),
        CheckConstraint("version BETWEEN 1 AND 2147483647", name="ck_order_template_version"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    channel: Mapped[str] = mapped_column(String(8))
    event_key: Mapped[str | None] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(100))
    enabled: Mapped[bool] = mapped_column()
    version: Mapped[int] = mapped_column(Integer)
    subject: Mapped[str] = mapped_column(String(200))
    html: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    dlt_id: Mapped[str] = mapped_column(String(60))
    provider_template: Mapped[str] = mapped_column(String(100))
    language: Mapped[str] = mapped_column(String(20))
    parameters: Mapped[list] = mapped_column(JSONB)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
