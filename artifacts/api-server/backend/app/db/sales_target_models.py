"""Shared financial-year budgets; no browser-local identifiers or migration."""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class SalesTarget(Timestamps, Base):
    __tablename__ = "sales_targets"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_sales_target_version"),
        CheckConstraint("status IN ('active','inactive')", name="ck_sales_target_status"),
        CheckConstraint('"startYear" BETWEEN 1 AND 9998 AND "endYear" = "startYear" + 1',
                        name="ck_sales_target_period"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_sales_target_deletion"),
        *(CheckConstraint(f'{key} >= 0 AND {key} <= 999999999999.99 AND {key} = trunc({key}, 2)',
                          name=f"ck_sales_target_{key}") for key in ("q1", "q2", "q3", "q4")),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mrId: Mapped[uuid.UUID] = mapped_column(ForeignKey("mr_directory.id"), nullable=False)
    startYear: Mapped[int] = mapped_column(Integer, nullable=False)
    endYear: Mapped[int] = mapped_column(Integer, nullable=False)
    # Unconstrained NUMERIC plus checks rejects rather than rounds direct SQL.
    q1: Mapped[Decimal] = mapped_column(Numeric(), nullable=False)
    q2: Mapped[Decimal] = mapped_column(Numeric(), nullable=False)
    q3: Mapped[Decimal] = mapped_column(Numeric(), nullable=False)
    q4: Mapped[Decimal] = mapped_column(Numeric(), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_sales_target_live_period", SalesTarget.mrId, SalesTarget.startYear, unique=True,
      postgresql_where=SalesTarget.deleted_at.is_(None))
Index("ix_sales_target_live_created", SalesTarget.created_at.desc(), SalesTarget.id.desc(),
      postgresql_where=SalesTarget.deleted_at.is_(None))
