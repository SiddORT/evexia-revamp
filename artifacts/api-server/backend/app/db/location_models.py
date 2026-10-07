import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class StorageLocation(Timestamps, Base):
    __tablename__ = "storage_locations"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_location_version"),
        CheckConstraint("status IN ('active', 'inactive')", name="ck_location_status"),
        CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_location_name"),
        CheckConstraint("length(address) BETWEEN 1 AND 2000 AND address = btrim(address)", name="ck_location_address"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_location_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str] = mapped_column(String(2000), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


def normalized_name(column):
    return func.lower(func.btrim(func.regexp_replace(column, r"\s+", " ", "g")))


Index("uq_location_live_name", normalized_name(StorageLocation.name), unique=True,
      postgresql_where=StorageLocation.deleted_at.is_(None))
