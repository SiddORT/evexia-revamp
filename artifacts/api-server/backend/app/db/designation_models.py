import uuid
from datetime import datetime

from decimal import Decimal
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, func, text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class Designation(Timestamps, Base):
    __tablename__ = "designations"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_designation_version"),
        CheckConstraint("status IN ('active', 'inactive')", name="ck_designation_status"),
        CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_designation_name"),
        CheckConstraint('length("shortName") BETWEEN 1 AND 50 AND "shortName" = btrim("shortName")', name="ck_designation_short_name"),
        CheckConstraint("level BETWEEN 1 AND 2147483647", name="ck_designation_level"),
        *(CheckConstraint(f'"{field}" >= 0 AND "{field}" <= 999999999.99', name=f"ck_designation_{field}")
          for field in ("basicDa", "hra", "medicalAllowance", "travellingAllowance", "specialAllowance", "professionalTax")),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_designation_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    shortName: Mapped[str] = mapped_column(String(50), nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    basicDa: Mapped[Decimal] = mapped_column(Numeric(11, 2), nullable=False)
    hra: Mapped[Decimal] = mapped_column(Numeric(11, 2), nullable=False)
    medicalAllowance: Mapped[Decimal] = mapped_column(Numeric(11, 2), nullable=False)
    travellingAllowance: Mapped[Decimal] = mapped_column(Numeric(11, 2), nullable=False)
    specialAllowance: Mapped[Decimal] = mapped_column(Numeric(11, 2), nullable=False)
    professionalTax: Mapped[Decimal] = mapped_column(Numeric(11, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


def normalized_name(column):
    return func.lower(func.btrim(func.regexp_replace(column, r"\s+", " ", "g")))


Index("uq_designation_live_name", normalized_name(Designation.name), unique=True,
      postgresql_where=Designation.deleted_at.is_(None))
