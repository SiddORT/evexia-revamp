"""Kits operational references; personal documents and retries are ciphertext."""
import uuid
from datetime import date, datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class KitsOrder(Base):
    __tablename__ = "kits_orders"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_kits_version"),
        CheckConstraint("order_for IN ('doctor','mr') AND (order_for <> 'mr' OR mr_id IS NOT NULL)", name="ck_kits_order_for"),
        CheckConstraint("status IN ('Confirmed','In process','Shipped','Delivered','Rejected','Returned')", name="ck_kits_status"),
        CheckConstraint("payment_status IN ('Unpaid','Paid','Partial')", name="ck_kits_payment"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(48), unique=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor_directory.id"), index=True)
    mr_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mr_directory.id"), index=True)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("patient_directory.id"), index=True)
    order_for: Mapped[str] = mapped_column(String(8), index=True)
    status: Mapped[str] = mapped_column(String(16), index=True)
    payment_status: Mapped[str] = mapped_column(String(16), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot_ciphertext: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class KitsAttachment(Base):
    __tablename__ = "kits_attachments"
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kits_orders.id"), primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), primary_key=True, unique=True)


class KitsRequest(Base):
    __tablename__ = "kits_requests"
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    response_ciphertext: Mapped[str] = mapped_column(Text)
