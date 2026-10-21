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
        CheckConstraint("next_area_sequence BETWEEN 1 AND 2147483647", name="ck_headquarter_area_sequence"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    state_code: Mapped[str] = mapped_column(String(16), nullable=False)
    zone_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("zones.id"))
    next_area_sequence: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_headquarter_live_name", normalized_name(Headquarter.name), unique=True,
      postgresql_where=Headquarter.deleted_at.is_(None))


class HeadquarterArea(Timestamps, Base):
    __tablename__ = "headquarter_areas"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_hq_area_name"),
        CheckConstraint("length(code) BETWEEN 1 AND 32 AND code = btrim(code) AND code = upper(code)", name="ck_hq_area_code"),
        CheckConstraint("position BETWEEN 0 AND 199", name="ck_hq_area_position"),
        CheckConstraint("sequence IS NULL OR sequence BETWEEN 1 AND 2147483646", name="ck_hq_area_sequence"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_hq_area_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    headquarter_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("headquarters.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    sequence: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_hq_area_live_name", HeadquarterArea.headquarter_id, normalized_name(HeadquarterArea.name),
      unique=True, postgresql_where=HeadquarterArea.deleted_at.is_(None))
Index("uq_hq_area_live_code", HeadquarterArea.headquarter_id, normalized_name(HeadquarterArea.code),
      unique=True, postgresql_where=HeadquarterArea.deleted_at.is_(None))
