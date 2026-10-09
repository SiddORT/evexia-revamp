import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class DoctorDirectory(Timestamps, Base):
    __tablename__ = "doctor_directory"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_doctor_version"),
        CheckConstraint("status IN ('active','inactive')", name="ck_doctor_status"),
        CheckConstraint("verification IN ('verified','unverified')", name="ck_doctor_verification"),
        CheckConstraint('"contactRequirement" IN (\'required\',\'optional\')', name="ck_doctor_contact"),
        CheckConstraint('"orderDiscount" BETWEEN 0 AND 100 AND "daysLimit" >= 0 AND "paymentLimit" >= 0', name="ck_doctor_limits"),
        CheckConstraint('"invoiceType" IN (\'normal\',\'gst\')', name="ck_doctor_invoice"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contactRequirement: Mapped[str] = mapped_column(String(8))
    registrationNumber: Mapped[str] = mapped_column(String(100))
    mrId: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_directory.id"), index=True)
    invoiceType: Mapped[str] = mapped_column(String(6))
    orderDiscount: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    daysLimit: Mapped[int] = mapped_column(Integer)
    paymentLimit: Mapped[Decimal] = mapped_column(Numeric(15, 2))
    status: Mapped[str] = mapped_column(String(8))
    verification: Mapped[str] = mapped_column(String(10))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_doctor_registration", func.lower(func.btrim(DoctorDirectory.registrationNumber)), unique=True)

from app.db.directory_fields import install
install(DoctorDirectory)
