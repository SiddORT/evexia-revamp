"""Append-only credit evidence, separate from money received."""
import uuid
from datetime import date, datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, BigInteger, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class CreditNote(Base):
    __tablename__ = "settlement_credit_notes"
    __table_args__ = (
        CheckConstraint("kind IN ('IT','Kit','SPT','Lupin')", name="ck_credit_kind"),
        CheckConstraint("sequence > 0", name="ck_credit_sequence"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_credit_cipher"),
        Index("ix_credit_order", "kind", "order_id"),
        Index("ix_credit_date", "date", "id"),
        Index("ix_credit_mr_date", "mr_id", "date", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    sequence: Mapped[int] = mapped_column(BigInteger, unique=True)
    kind: Mapped[str] = mapped_column(String(8))
    order_id: Mapped[uuid.UUID] = mapped_column()
    mr_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mr_directory.id"))
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class CreditReversal(Base):
    __tablename__ = "settlement_credit_reversals"
    __table_args__ = (CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_credit_reversal_cipher"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    note_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("settlement_credit_notes.id"), unique=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class CreditRequest(Base):
    __tablename__ = "settlement_credit_requests"
    __table_args__ = (CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_credit_request_cipher"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
