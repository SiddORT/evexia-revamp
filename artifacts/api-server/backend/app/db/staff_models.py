import uuid
from datetime import date

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models import Timestamps


class StaffProfile(Timestamps, Base):
    __tablename__ = "staff_profiles"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_staff_version"),
        CheckConstraint("status IN ('active', 'inactive')", name="ck_staff_status"),
        CheckConstraint("role IN ('Staff', 'Manager', 'Accountant', 'Back End', 'Sub Admin', 'Super Admin')", name="ck_staff_role"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    name_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    email_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    phone_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    email_index: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    dial_country: Mapped[str] = mapped_column(String(2), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    designation: Mapped[str] = mapped_column(String(200), nullable=False)
    joining_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
