"""Operational references only; all historical personal/order details are encrypted."""
import uuid
from datetime import date, datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class ImmunotherapyOrder(Base):
    __tablename__ = "immunotherapy_orders"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_imm_version"),
        CheckConstraint(
            "status IN ('Confirmed','Approved','In process','Shipped','Delivered','Rejected','Returned')",
            name="ck_imm_status",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(48), unique=True)
    date: Mapped[date] = mapped_column(Date)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patient_directory.id"), index=True)
    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor_directory.id"), index=True)
    mr_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_directory.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    snapshot_ciphertext: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ImmunotherapyItem(Base):
    __tablename__ = "immunotherapy_items"
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("immunotherapy_orders.id"), primary_key=True)
    bottle: Mapped[int] = mapped_column(Integer, primary_key=True)
    allergen_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("allergen_products.id"), primary_key=True)


class ImmunotherapyAttachment(Base):
    __tablename__ = "immunotherapy_attachments"
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("immunotherapy_orders.id"), primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), primary_key=True)


class ImmunotherapyRequest(Base):
    __tablename__ = "immunotherapy_requests"
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    response_ciphertext: Mapped[str] = mapped_column(Text)
