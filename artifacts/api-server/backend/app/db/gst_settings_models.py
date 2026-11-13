"""Legacy configuration retained unchanged, plus immutable policy revisions."""
from datetime import date
from decimal import Decimal
from sqlalchemy import CheckConstraint, Date, Integer, Numeric, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from datetime import datetime
from uuid import UUID as UUIDType
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class GSTSettings(Base):
    __tablename__ = "gst_settings"
    __table_args__ = (
        CheckConstraint("id = 1 AND version >= 1", name="ck_gst_settings_singleton"),
        # Unconstrained NUMERIC rejects excess precision instead of rounding it
        # before the CHECK (as NUMERIC(5,2) would).
        CheckConstraint("before_rate BETWEEN 0 AND 100 AND before_rate = trunc(before_rate, 2)",
                        name="ck_gst_before_rate"),
        CheckConstraint("on_after_rate BETWEEN 0 AND 100 AND on_after_rate = trunc(on_after_rate, 2)",
                        name="ck_gst_on_after_rate"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer)
    cutoff_date: Mapped[date] = mapped_column(Date)
    before_rate: Mapped[Decimal] = mapped_column(Numeric())
    on_after_rate: Mapped[Decimal] = mapped_column(Numeric())


class GSTPolicyRevision(Base):
    __tablename__ = "gst_policy_revisions"
    __table_args__ = (CheckConstraint("version BETWEEN 1 AND 2147483647", name="ck_gst_policy_version"),)
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[UUIDType] = mapped_column(UUID, nullable=False, unique=True)
    actor_id: Mapped[UUIDType] = mapped_column(ForeignKey("users.id"), nullable=False)
    actor_label: Mapped[str] = mapped_column(String(64), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
