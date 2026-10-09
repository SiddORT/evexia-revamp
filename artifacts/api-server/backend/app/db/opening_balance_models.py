import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class OpeningBalance(Timestamps, Base):
    __tablename__ = "opening_balances"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_opening_balance_version"),
        CheckConstraint("status IN ('active','inactive')", name="ck_opening_balance_status"),
        CheckConstraint('"startYear" BETWEEN 1900 AND 9998 AND "endYear" = "startYear" + 1', name="ck_opening_balance_years"),
        CheckConstraint("amount BETWEEN -9999999999999.99 AND 9999999999999.99", name="ck_opening_balance_amount"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_opening_balance_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    startYear: Mapped[int] = mapped_column(Integer, nullable=False)
    endYear: Mapped[int] = mapped_column(Integer, nullable=False)
    doctorId: Mapped[uuid.UUID] = mapped_column(ForeignKey("doctor_directory.id"), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_opening_balance_live_doctor_year", OpeningBalance.doctorId, OpeningBalance.startYear,
      unique=True, postgresql_where=OpeningBalance.deleted_at.is_(None))
Index("ix_opening_balance_live_order", OpeningBalance.created_at.desc(), OpeningBalance.id.desc(),
      postgresql_where=OpeningBalance.deleted_at.is_(None))


class OpeningBalanceImportReview(Base):
    """One current, short-lived, single-use review per verified session; no bytes."""
    __tablename__ = "opening_balance_import_reviews"
    session_id: Mapped[str] = mapped_column(ForeignKey("auth_sessions.id"), primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
