"""Manufactured concentrate reserves; deliberately no inventory-lot relationship."""
import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class InHouseStock(Base):
    __tablename__ = "in_house_stock"
    __table_args__ = (CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_in_house_cipher"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_events.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class InHouseStockRequest(Base):
    __tablename__ = "in_house_stock_requests"
    __table_args__ = (CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_in_house_request_cipher"),)
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    digest: Mapped[str] = mapped_column(String(64))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
