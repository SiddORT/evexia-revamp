import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models import Timestamps


class Zone(Timestamps, Base):
    __tablename__ = "zones"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_zones_version"),
        CheckConstraint("status IN ('active', 'inactive')", name="ck_zones_status"),
        CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_zones_name"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_zones_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_zones_live_name", func.lower(Zone.name), unique=True, postgresql_where=Zone.deleted_at.is_(None))
