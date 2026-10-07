import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class MRDirectory(Timestamps, Base):
    """One-to-one business extension; existing identity-only profiles stay empty."""
    __tablename__ = "mr_directory"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_mr_directory_version"),
        CheckConstraint("status IN ('active','inactive')", name="ck_mr_directory_status"),
        CheckConstraint('"contactRequirement" IN (\'required\',\'optional\')', name="ck_mr_directory_contact"),
        CheckConstraint('"contactRequirement" = \'optional\' OR (phone <> \'\' AND email <> \'\')', name="ck_mr_directory_required_contact"),
        CheckConstraint('"paymentLimit" >= 0 AND "doctorDaysLimit" BETWEEN 0 AND 3650', name="ck_mr_directory_limits"),
        CheckConstraint('"reportingManagerId" IS NULL OR "reportingManagerId" <> id', name="ck_mr_directory_self_manager"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_mr_directory_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_profiles.id"), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(20))
    email: Mapped[str] = mapped_column(String(320))
    contactRequirement: Mapped[str] = mapped_column(String(8))
    hq: Mapped[uuid.UUID] = mapped_column(ForeignKey("headquarters.id"), index=True)
    zoneId: Mapped[uuid.UUID] = mapped_column(ForeignKey("zones.id"), index=True)
    employeeCode: Mapped[str] = mapped_column(String(64))
    dateOfJoining: Mapped[date] = mapped_column(Date)
    designation: Mapped[str] = mapped_column(String(200))
    reportingManagerId: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mr_directory.id"), index=True)
    paymentLimit: Mapped[Decimal] = mapped_column(Numeric(11, 2))
    doctorDaysLimit: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(8))
    pincode: Mapped[str] = mapped_column(String(6))
    addressLine1: Mapped[str] = mapped_column(String(300))
    addressLine2: Mapped[str] = mapped_column(String(300))
    landmark: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_mr_directory_employee", func.lower(MRDirectory.employeeCode), unique=True)


class AccountIdentifierReservation(Base):
    __tablename__ = "account_identifier_reservations"
    identifier: Mapped[str] = mapped_column(String(320), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
