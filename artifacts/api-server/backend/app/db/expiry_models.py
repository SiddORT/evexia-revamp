"""Forward-only encrypted cost, disposal and daily delivery evidence."""
import uuid
from datetime import date, datetime
from sqlalchemy import Date, DateTime, ForeignKey, String, Text, CheckConstraint, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class BatchCost(Base):
    __tablename__ = "inventory_batch_costs"
    __table_args__ = (UniqueConstraint("source_kind", "batch_id", name="uq_batch_cost_source"),
                      CheckConstraint("source_kind IN ('lot','reserve')", name="ck_batch_cost_kind"))
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    source_kind: Mapped[str] = mapped_column(String(7))
    batch_id: Mapped[uuid.UUID] = mapped_column(index=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class ExpiryDisposal(Base):
    __tablename__ = "inventory_expiry_disposals"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    source_kind: Mapped[str] = mapped_column(String(7))
    batch_id: Mapped[uuid.UUID] = mapped_column(index=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_events.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class ExpiryRequest(Base):
    __tablename__ = "inventory_expiry_requests"
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    digest: Mapped[str] = mapped_column(String(64))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class ExpiryScan(Base):
    __tablename__ = "inventory_expiry_scans"
    source_kind: Mapped[str] = mapped_column(String(7), primary_key=True)
    cursor: Mapped[uuid.UUID | None] = mapped_column()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ExpirySeparation(Base):
    __tablename__ = "inventory_expiry_separations"
    source_kind: Mapped[str] = mapped_column(String(7), primary_key=True)
    batch_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ExpiryDigest(Base):
    __tablename__ = "inventory_expiry_digests"
    __table_args__ = (CheckConstraint("status IN ('preparing','sending','blocked','failed','unknown','accepted')", name="ck_expiry_digest_status"),)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    status: Mapped[str] = mapped_column(String(12))
    category: Mapped[str | None] = mapped_column(String(80))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    token: Mapped[uuid.UUID] = mapped_column()


class ExpiryTemplate(Base):
    __tablename__ = "inventory_expiry_templates"
    key: Mapped[str] = mapped_column(String(30), primary_key=True)
    subject: Mapped[str] = mapped_column(String(200))
    introduction: Mapped[str] = mapped_column(Text)
