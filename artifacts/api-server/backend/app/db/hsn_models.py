"""Shared HSN mappings; product tax snapshots deliberately are not foreign keys."""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class HsnMapping(Timestamps, Base):
    __tablename__ = "hsn_mappings"
    __table_args__ = (
        CheckConstraint("code ~ '^[0-9]{1,16}$'", name="ck_hsn_code"),
        CheckConstraint("gst >= 0 AND gst <= 100 AND gst = round(gst, 2)", name="ck_hsn_gst"),
        CheckConstraint("status IN ('active', 'inactive')", name="ck_hsn_status"),
        CheckConstraint("version >= 1", name="ck_hsn_version"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    gst: Mapped[Decimal] = mapped_column(Numeric(), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)


class HsnChange(Base):
    __tablename__ = "hsn_changes"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mapping_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hsn_mappings.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    before_code: Mapped[str | None] = mapped_column(String(16))
    before_gst: Mapped[Decimal | None] = mapped_column(Numeric())
    before_status: Mapped[str | None] = mapped_column(String(8))
    after_code: Mapped[str] = mapped_column(String(16), nullable=False)
    after_gst: Mapped[Decimal] = mapped_column(Numeric(), nullable=False)
    after_status: Mapped[str] = mapped_column(String(8), nullable=False)
