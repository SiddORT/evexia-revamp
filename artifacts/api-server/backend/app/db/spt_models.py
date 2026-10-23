"""SPT operational identifiers only; all personal and monetary data is encrypted."""
import uuid
from datetime import date, datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class SptPatient(Base):
    __tablename__ = "spt_patients"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(48), unique=True)
    snapshot_ciphertext: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SptOrder(Base):
    __tablename__ = "spt_orders"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_spt_version"),
        CheckConstraint("status IN ('Draft','Saved')", name="ck_spt_status"),
        CheckConstraint("status <> 'Saved' OR (doctor_id IS NOT NULL AND mr_id IS NOT NULL)", name="ck_spt_saved_people"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    source_id: Mapped[uuid.UUID] = mapped_column(unique=True)
    number: Mapped[str] = mapped_column(String(48), unique=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    doctor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("doctor_directory.id"), index=True)
    mr_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mr_directory.id"), index=True)
    status: Mapped[str] = mapped_column(String(8), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot_ciphertext: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SptMembership(Base):
    __tablename__ = "spt_order_patients"
    __table_args__ = (
        CheckConstraint("position >= 0 AND position < 200", name="ck_spt_position"),
        CheckConstraint("(master_patient_id IS NULL) <> (spt_patient_id IS NULL)", name="ck_spt_patient_source"),
        UniqueConstraint("order_id", "master_patient_id"),
        UniqueConstraint("order_id", "spt_patient_id"),
    )
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spt_orders.id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    master_patient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("patient_directory.id"), index=True)
    spt_patient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("spt_patients.id"), index=True)


class SptRequest(Base):
    __tablename__ = "spt_requests"
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    response_ciphertext: Mapped[str] = mapped_column(Text)
