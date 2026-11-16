"""Append-only quota policy and permanent consumption, without personal text."""
import uuid
from datetime import date, datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class FreeKitPolicy(Base):
    __tablename__ = "free_kit_policy"
    __table_args__ = (
        CheckConstraint("version > 0 AND mr_cap >= 0 AND doctor_cap >= 0", name="ck_free_kit_caps"),
        CheckConstraint("mr_period IN ('financial_year','month') AND doctor_period IN ('financial_year','month')", name="ck_free_kit_periods"),
    )
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[uuid.UUID] = mapped_column(unique=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    mr_cap: Mapped[int] = mapped_column(Integer)
    mr_period: Mapped[str] = mapped_column(String(16))
    doctor_cap: Mapped[int] = mapped_column(Integer)
    doctor_period: Mapped[str] = mapped_column(String(16))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    request_payload: Mapped[dict] = mapped_column(JSONB)


class FreeKitUse(Base):
    __tablename__ = "free_kit_use"
    __table_args__ = (
        CheckConstraint("order_version > 1", name="ck_free_kit_order_version"),
        Index("ix_free_kit_mr_date", "mr_id", "order_date"),
        Index("ix_free_kit_doctor_date", "doctor_id", "order_date"),
    )
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("kits_orders.id"), primary_key=True)
    mr_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_directory.id"))
    doctor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor_directory.id"))
    order_date: Mapped[date] = mapped_column(Date)
    policy_version: Mapped[int] = mapped_column(ForeignKey("free_kit_policy.version"))
    order_version: Mapped[int] = mapped_column(Integer)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    marked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
