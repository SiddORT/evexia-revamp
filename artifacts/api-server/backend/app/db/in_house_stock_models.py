"""Manufactured concentrate snapshots and separate append-only consumption."""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, Numeric, UniqueConstraint
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


class InHousePosting(Base):
    """Append-only location transfers/consumption; original reserve is untouched."""
    __tablename__ = "in_house_postings"
    __table_args__ = (
        UniqueConstraint("movement_id", "reserve_id", "location_id", name="uq_reserve_posting"),
        CheckConstraint("delta <> 0 AND abs(delta) <= 1000000 AND delta = round(delta,3)", name="ck_reserve_delta"),
        CheckConstraint("before >= 0 AND after >= 0 AND before <= 1000000 AND after <= 1000000 AND before = round(before,3) AND after = round(after,3) AND after = before + delta", name="ck_reserve_balance"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    reserve_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("in_house_stock.id"), index=True)
    movement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("inventory_movements.id"), index=True)
    location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("storage_locations.id"))
    delta: Mapped[Decimal] = mapped_column(Numeric())
    before: Mapped[Decimal] = mapped_column(Numeric())
    after: Mapped[Decimal] = mapped_column(Numeric())
