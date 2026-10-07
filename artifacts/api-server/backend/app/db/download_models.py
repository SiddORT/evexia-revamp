"""Dedicated metadata-only initiation ledger, independent of general activity."""
import uuid
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class DownloadLog(Base):
    __tablename__ = "download_logs"
    __table_args__ = (
        UniqueConstraint("session_id", "initiation_id", name="uq_download_initiation"),
        Index("ix_download_created_id", "created_at", "id"),
        Index("ix_download_actor_created", "actor_id", "created_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    session_id: Mapped[str] = mapped_column(ForeignKey("auth_sessions.id"), nullable=False)
    initiation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    format: Mapped[str] = mapped_column(String(4), nullable=False)
    provenance: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
