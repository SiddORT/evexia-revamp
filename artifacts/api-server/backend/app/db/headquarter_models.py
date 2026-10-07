import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps
from app.db.courier_models import normalized_name


class Headquarter(Timestamps, Base):
    __tablename__ = "headquarters"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_headquarter_version"),
        CheckConstraint("status IN ('active', 'inactive')", name="ck_headquarter_status"),
        CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_headquarter_name"),
        CheckConstraint("length(state_code) BETWEEN 1 AND 16 AND state_code = btrim(state_code) AND state_code = upper(state_code)", name="ck_headquarter_code"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_headquarter_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    state_code: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_headquarter_live_name", normalized_name(Headquarter.name), unique=True,
      postgresql_where=Headquarter.deleted_at.is_(None))
