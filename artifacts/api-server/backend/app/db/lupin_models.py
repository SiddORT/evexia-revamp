"""Operational references only; all personal order documents are encrypted."""
import uuid
from datetime import date, datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class LupinOrder(Base):
    __tablename__ = "lupin_orders"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_lupin_version"),
        CheckConstraint("status IN ('Confirmed','Approved','In process','Shipped','Delivered','Rejected','Returned')", name="ck_lupin_status"),
        CheckConstraint("payment_status IN ('Unpaid','Paid','Partial')", name="ck_lupin_payment"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(48), unique=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor_directory.id"), index=True)
    mr_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_directory.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), index=True)
    payment_status: Mapped[str] = mapped_column(String(16), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot_ciphertext: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LupinPatient(Base):
    __tablename__ = "lupin_order_patients"
    __table_args__ = (
        CheckConstraint("position >= 0 AND position < 200", name="ck_lupin_position"),
        UniqueConstraint("order_id", "patient_id"),
    )
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lupin_orders.id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patient_directory.id"), index=True)


class LupinAttachment(Base):
    __tablename__ = "lupin_attachments"
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lupin_orders.id"), primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), primary_key=True, unique=True)


class LupinRequest(Base):
    __tablename__ = "lupin_requests"
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    response_ciphertext: Mapped[str] = mapped_column(Text)
