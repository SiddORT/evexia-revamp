"""Ownership evidence is separate from role assignment and operator recovery."""
import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class DomainPolicy(Timestamps, Base):
    __tablename__ = "domain_policies"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_domain_version"),
        CheckConstraint("kind IN ('primary', 'role')", name="ck_domain_kind"),
        Index("uq_single_primary_domain", "kind", unique=True, postgresql_where=text("kind = 'primary'")),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), default=uuid.uuid4, unique=True, nullable=False)
    hostname: Mapped[str] = mapped_column(String(253), primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    active: Mapped[bool] = mapped_column(default=False, nullable=False)
    challenge: Mapped[str | None] = mapped_column(String(100))
    challenge_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="unverified", nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
