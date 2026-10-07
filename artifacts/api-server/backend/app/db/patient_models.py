import uuid
from datetime import date
from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class PatientDirectory(Timestamps, Base):
    """Clinical directory extension, never promotes existing identity-only owners."""
    __tablename__ = "patient_directory"
    __table_args__ = (
        CheckConstraint("gender IN ('male','female','other','prefer not to say')", name="ck_patient_gender"),
        CheckConstraint("status IN ('active','inactive')", name="ck_patient_directory_status"),
        CheckConstraint('"dialCountry" IN (\'IN\',\'US\',\'GB\',\'AE\')', name="ck_patient_dial"),
        CheckConstraint("code ~ '^PAT-[A-Z0-9][A-Z0-9-]{1,59}$'", name="ck_patient_code"),
    )
    id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id"), primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    gender: Mapped[str] = mapped_column(String(17))
    phone: Mapped[str] = mapped_column(String(20))
    dialCountry: Mapped[str] = mapped_column(String(2))
    email: Mapped[str] = mapped_column(String(320))
    dateOfBirth: Mapped[date] = mapped_column(Date)
    doctorId: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor_directory.id"), index=True)
    instructionsLanguage: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(8))
    addressLine1: Mapped[str] = mapped_column(String(300))
    addressLine2: Mapped[str] = mapped_column(String(300))
    landmark: Mapped[str] = mapped_column(String(200))
    pincode: Mapped[str] = mapped_column(String(12))
    city: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(100))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))


Index("uq_patient_duplicate", func.lower(func.btrim(PatientDirectory.name)),
      PatientDirectory.dialCountry, PatientDirectory.phone, PatientDirectory.dateOfBirth, unique=True)
