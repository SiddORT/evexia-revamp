"""Encrypted shared recipient and recipient-scoped weekly terminal claims."""
from datetime import date, datetime
from uuid import UUID
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class LowStockSettings(Base):
    __tablename__ = "low_stock_settings"
    __table_args__ = (CheckConstraint("id = 1 AND version > 0", name="ck_low_stock_singleton"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)


class LowStockSettingsRequest(Base):
    __tablename__ = "low_stock_settings_requests"
    __table_args__ = (CheckConstraint("state IN ('committed','cancelled')", name="ck_low_stock_request_state"),)
    key: Mapped[UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    version: Mapped[int | None] = mapped_column(Integer)
    payload_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)


class LowStockWeek(Base):
    __tablename__ = "low_stock_weeks"
    week: Mapped[date] = mapped_column(Date, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Consumed before preparation: changing Settings can never replay a week.


class LowStockDelivery(Base):
    __tablename__ = "low_stock_deliveries"
    __table_args__ = (CheckConstraint(
        "status IN ('preparing','sending','accepted','unknown','failed','blocked','empty','duplicate')",
        name="ck_low_stock_delivery_status"),)
    week: Mapped[date] = mapped_column(ForeignKey("low_stock_weeks.week"), primary_key=True)
    recipient: Mapped[str] = mapped_column(String(16), primary_key=True)
    token: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    destination_index: Mapped[str | None] = mapped_column(String(64))
    payload_ciphertext: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(64))
    lease_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LowStockSchedule(Base):
    __tablename__ = "low_stock_schedule"
    __table_args__ = (CheckConstraint("id = 1", name="ck_low_stock_schedule_singleton"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LowStockOccurrence(Base):
    __tablename__ = "low_stock_occurrences"
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class LowStockOccurrenceDelivery(Base):
    __tablename__ = "low_stock_occurrence_deliveries"
    __table_args__ = (CheckConstraint(
        "status IN ('preparing','sending','accepted','unknown','failed','blocked','empty','duplicate')",
        name="ck_low_stock_occurrence_delivery_status"),)
    scheduled_at: Mapped[datetime] = mapped_column(ForeignKey("low_stock_occurrences.scheduled_at"), primary_key=True)
    recipient: Mapped[str] = mapped_column(String(32), primary_key=True)
    token: Mapped[UUID] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    destination_index: Mapped[str | None] = mapped_column(String(64))
    payload_ciphertext: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(64))
    lease_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
