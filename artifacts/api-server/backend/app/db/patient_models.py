import uuid
from datetime import date, datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class PatientDirectory(Timestamps, Base):
    """Clinical directory extension, never promotes existing identity-only owners."""
    __tablename__ = "patient_directory"
    __table_args__ = (
        CheckConstraint("status IN ('active','inactive')", name="ck_patient_directory_status"),
        CheckConstraint("code ~ '^PAT-[A-Z0-9][A-Z0-9-]{1,59}$'", name="ck_patient_code"),
    )
    id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.id"), primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    doctorId: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor_directory.id"), index=True)
    status: Mapped[str] = mapped_column(String(8))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


from app.db.directory_fields import install
install(PatientDirectory)
