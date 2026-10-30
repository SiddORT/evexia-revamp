"""Immutable, encrypted settlement receipts; no legacy payment flag backfill."""
import uuid
from datetime import date, datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class SettlementBatch(Base):
    __tablename__ = "settlement_batches"
    __table_args__ = (CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_settlement_batch_cipher"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    mr_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_directory.id"))
    date: Mapped[date] = mapped_column(Date, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class SettlementEntry(Base):
    __tablename__ = "settlement_entries"
    __table_args__ = (
        UniqueConstraint("batch_id", "kind", "order_id", name="uq_settlement_batch_order"),
        CheckConstraint("kind IN ('IT','Kit','SPT','Lupin')", name="ck_settlement_kind"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_settlement_entry_cipher"),
        CheckConstraint("(verified_at IS NULL) = (verified_by IS NULL)", name="ck_settlement_verification"),
        Index("ix_settlement_order", "kind", "order_id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("settlement_batches.id"), index=True)
    kind: Mapped[str] = mapped_column(String(8))
    order_id: Mapped[uuid.UUID] = mapped_column()
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class SettlementRejection(Base):
    """Durable terminal outcomes stop a delayed original request from posting."""
    __tablename__ = "settlement_rejections"
    __table_args__ = (CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_settlement_rejection_cipher"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    mr_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_directory.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
