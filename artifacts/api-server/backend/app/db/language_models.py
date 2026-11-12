"""Shared language catalogue and retained committed changes."""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models import Timestamps


class Language(Timestamps, Base):
    __tablename__ = "languages"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_languages_version"),
        CheckConstraint("status IN ('active', 'inactive')", name="ck_languages_status"),
        CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_languages_name"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_languages_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(8), default="active", server_default="active", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


# PG17 uses its builtin; the migration supplies an ICU-root alias on PG16.
Index("uq_languages_live_name", func.lower(Language.name.collate("pg_c_utf8")), unique=True,
      postgresql_where=Language.deleted_at.is_(None))


class LanguageChange(Base):
    __tablename__ = "language_changes"
    __table_args__ = (
        UniqueConstraint("language_id", "version", name="uq_language_changes_version"),
        CheckConstraint("action IN ('create', 'edit', 'delete', 'status')", name="ck_language_changes_action"),
        CheckConstraint("version >= 1", name="ck_language_changes_version"),
        CheckConstraint("length(after_name) BETWEEN 1 AND 200", name="ck_language_changes_after"),
        CheckConstraint("(action = 'create' AND before_name IS NULL AND version = 1) OR "
                        "(action IN ('edit', 'delete', 'status') AND before_name IS NOT NULL AND version > 1)",
                        name="ck_language_changes_before"),
        CheckConstraint(
            "(action = 'status' AND before_status IS NOT NULL AND after_status IS NOT NULL "
            "AND before_status IN ('active', 'inactive') AND after_status IN ('active', 'inactive') "
            "AND before_status <> after_status AND before_name = after_name) OR "
            "(action <> 'status' AND before_status IS NULL AND after_status IS NULL)",
            name="ck_language_changes_status"),
        Index("ix_language_changes_record_version", "language_id", "version"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    language_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("languages.id", ondelete="RESTRICT"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(6), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    before_name: Mapped[str | None] = mapped_column(String(200))
    after_name: Mapped[str] = mapped_column(String(200), nullable=False)
    before_status: Mapped[str | None] = mapped_column(String(8))
    after_status: Mapped[str | None] = mapped_column(String(8))
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_events.id", ondelete="RESTRICT"),
                                               unique=True, nullable=False)
