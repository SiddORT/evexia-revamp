"""Append-only physical stock initialization, not financial opening balances."""
import uuid
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class OpeningStock(Base):
    __tablename__ = "opening_stock"
    __table_args__ = (UniqueConstraint("source_id", "row_id", name="uq_opening_source_row"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    source_id: Mapped[uuid.UUID] = mapped_column(index=True)
    row_id: Mapped[uuid.UUID] = mapped_column()
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_events.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class OpeningStockRequest(Base):
    __tablename__ = "opening_stock_requests"
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    digest: Mapped[str] = mapped_column(String(64))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
