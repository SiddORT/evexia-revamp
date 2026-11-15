import uuid
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class DoctorDirectory(Timestamps, Base):
    __tablename__ = "doctor_directory"
    __table_args__ = (
        CheckConstraint('("zoneId" IS NULL AND "hqId" IS NULL AND "areaId" IS NULL) OR '
                        '("zoneId" IS NOT NULL AND "hqId" IS NOT NULL AND "areaId" IS NOT NULL)',
                        name="ck_doctor_location_complete"),
        CheckConstraint("version >= 1", name="ck_doctor_version"),
        CheckConstraint('"areaVersion" >= 1', name="ck_doctor_area_version"),
        CheckConstraint("status IN ('active','inactive')", name="ck_doctor_status"),
        CheckConstraint("verification IN ('verified','unverified')", name="ck_doctor_verification"),
        CheckConstraint('"contactRequirement" IN (\'required\',\'optional\')', name="ck_doctor_contact"),
        CheckConstraint('"orderDiscount" BETWEEN 0 AND 100 AND "daysLimit" >= 0 AND "paymentLimit" >= 0', name="ck_doctor_limits"),
        CheckConstraint('"invoiceType" IN (\'normal\',\'gst\')', name="ck_doctor_invoice"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    doctorNumber: Mapped[str] = mapped_column(String(64), unique=True)
    contactRequirement: Mapped[str] = mapped_column(String(8))
    registrationNumber: Mapped[str] = mapped_column(String(100))
    mrId: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_directory.id"), index=True)
    zoneId: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("zones.id"), index=True)
    hqId: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("headquarters.id"), index=True)
    areaId: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("headquarter_areas.id"), index=True)
    areaVersion: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
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


class DoctorAssignmentEvent(Base):
    __tablename__ = "doctor_assignment_events"
    __table_args__ = (
        CheckConstraint("kind IN ('baseline','initial','transfer','area')", name="ck_doctor_assignment_kind"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_doctor_assignment_cipher"),
        Index("ix_doctor_assignment_timeline", "doctor_id", "recorded_at", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor_directory.id"))
    kind: Mapped[str] = mapped_column(String(10))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
