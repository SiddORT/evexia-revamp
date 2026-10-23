import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, Index, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models import Timestamps


class StaffProfile(Timestamps, Base):
    __tablename__ = "staff_profiles"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_staff_version"),
        CheckConstraint("status IN ('active', 'inactive')", name="ck_staff_status"),
        CheckConstraint("char_length(role) BETWEEN 1 AND 100 AND char_length(btrim(role)) > 0", name="ck_staff_role"),
        CheckConstraint("employee_code IS NULL OR (char_length(employee_code) BETWEEN 1 AND 64 AND employee_code = btrim(employee_code) AND employee_code !~ '[[:cntrl:]]')", name="ck_staff_employee_code"),
        CheckConstraint("NOT login_identifiers_ready OR employee_code IS NOT NULL", name="ck_staff_ready_employee_code"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    name_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    email_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    phone_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    email_index: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    dial_country: Mapped[str] = mapped_column(String(2), nullable=False)
    role: Mapped[str] = mapped_column(String(100), nullable=False)
    employee_code: Mapped[str | None] = mapped_column(String(64))
    designation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("designations.id", ondelete="RESTRICT"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    joining_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    custom_role_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("custom_roles.id", ondelete="RESTRICT"), index=True)
    workspace_login_enabled: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="false")
    role_resolution_required: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="false")
    login_identifiers_ready: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="false")

Index("uq_staff_ready_employee_code", func.lower(StaffProfile.employee_code),
      unique=True, postgresql_where=text("login_identifiers_ready"))


class StaffLoginIdentifier(Base):
    __tablename__ = "staff_login_identifiers"
    __table_args__ = (
        CheckConstraint("identifier_index ~ '^[0-9a-f]{64}$'", name="ck_staff_login_digest"),
    )
    identifier_index: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
