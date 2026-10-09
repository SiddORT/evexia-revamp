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
        CheckConstraint('"contactRequirement" = \'optional\' OR (phone <> \'\' AND email <> \'\')', name="ck_doctor_required_contact"),
        CheckConstraint('"orderDiscount" BETWEEN 0 AND 100 AND "daysLimit" >= 0 AND "paymentLimit" >= 0', name="ck_doctor_limits"),
        CheckConstraint('"invoiceType" IN (\'normal\',\'gst\') AND ("invoiceType" <> \'gst\' OR "gstNumber" <> \'\')', name="ck_doctor_invoice"),
        CheckConstraint('"dialCountry" IN (\'IN\',\'US\',\'GB\',\'AE\')', name="ck_doctor_dial"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(20))
    dialCountry: Mapped[str] = mapped_column(String(2))
    alternatePhone: Mapped[str] = mapped_column(String(20))
    email: Mapped[str] = mapped_column(String(320))
    contactRequirement: Mapped[str] = mapped_column(String(8))
    dateOfJoining: Mapped[date | None] = mapped_column(Date)
    registrationNumber: Mapped[str] = mapped_column(String(100))
    qualification: Mapped[str] = mapped_column(String(200))
    clinicName: Mapped[str] = mapped_column(String(200))
    mrId: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_directory.id"), index=True)
    invoiceType: Mapped[str] = mapped_column(String(6))
    gstNumber: Mapped[str] = mapped_column(String(20))
    drugLicenceNumber: Mapped[str] = mapped_column(String(100))
    orderDiscount: Mapped[Decimal] = mapped_column(Numeric(5, 2))
    daysLimit: Mapped[int] = mapped_column(Integer)
    paymentLimit: Mapped[Decimal] = mapped_column(Numeric(15, 2))
    status: Mapped[str] = mapped_column(String(8))
    verification: Mapped[str] = mapped_column(String(10))
    pincode: Mapped[str] = mapped_column(String(12))
    addressLine1: Mapped[str] = mapped_column(String(300))
    addressLine2: Mapped[str] = mapped_column(String(300))
    landmark: Mapped[str] = mapped_column(String(200))
    country: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(100), index=True)
    city: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_doctor_registration", func.lower(func.btrim(DoctorDirectory.registrationNumber)), unique=True)
