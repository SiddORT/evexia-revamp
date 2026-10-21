import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
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
        CheckConstraint('"paymentLimit" >= 0 AND "doctorDaysLimit" BETWEEN 0 AND 3650', name="ck_mr_directory_limits"),
        CheckConstraint('"reportingManagerId" IS NULL OR "reportingManagerId" <> id', name="ck_mr_directory_self_manager"),
        CheckConstraint('("reportingManagerId" IS NULL) = (reporting_manager_name_ciphertext IS NULL)',
                        name="ck_mr_manager_snapshot"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_mr_directory_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_profiles.id"), primary_key=True)
    contactRequirement: Mapped[str] = mapped_column(String(8))
    hq: Mapped[uuid.UUID] = mapped_column(ForeignKey("headquarters.id"), index=True)
    zoneId: Mapped[uuid.UUID] = mapped_column(ForeignKey("zones.id"), index=True)
    hq_name: Mapped[str] = mapped_column(String(200), nullable=False)
    zone_name: Mapped[str] = mapped_column(String(200), nullable=False)
    employeeCode: Mapped[str] = mapped_column(String(64))
    designation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("designations.id", ondelete="RESTRICT"), nullable=False)
    reportingManagerId: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mr_directory.id"), index=True)
    paymentLimit: Mapped[Decimal] = mapped_column(Numeric(11, 2))
    doctorDaysLimit: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(8))
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_mr_directory_employee", func.lower(MRDirectory.employeeCode), unique=True)

class MRZoneAssignment(Base):
    """Ordered saved assignments; zoneId on the parent remains the primary."""
    __tablename__ = "mr_zone_assignments"
    __table_args__ = (
        CheckConstraint("position >= 0", name="ck_mr_zone_position"),
        Index("uq_mr_zone_position", "mr_id", "position", unique=True),
        Index("ix_mr_zone_zone", "zone_id", "mr_id"),
    )
    mr_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_directory.id", ondelete="CASCADE"), primary_key=True)
    zone_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("zones.id", ondelete="RESTRICT"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    zone_name: Mapped[str] = mapped_column(String(200), nullable=False)

from app.db.directory_fields import install
install(MRDirectory)


class AccountIdentifierReservation(Base):
    __tablename__ = "account_identifier_reservations"
    __table_args__ = (
        CheckConstraint("field IN ('email','username')", name="ck_account_reservation_field"),
        CheckConstraint("identifier LIKE 'v1:%' AND identifier_index ~ '^[0-9a-f]{64}$'",
                        name="ck_account_reservation_encrypted"),
    )
    identifier_index: Mapped[str] = mapped_column(String(64), primary_key=True)
    identifier_ciphertext: Mapped[str] = mapped_column("identifier", Text, nullable=False)
    field: Mapped[str] = mapped_column(String(8), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))

    @property
    def identifier(self):
        from app.services.account_crypto import read
        return read(self.user_id, self.field, self.identifier_ciphertext, self.identifier_index)
