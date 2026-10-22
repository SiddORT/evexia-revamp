"""Metadata only. No message bodies, credentials, tokens or URLs."""
import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class EmailAttempt(Base):
    __tablename__ = "email_attempts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    recipient_ciphertext: Mapped[str | None] = mapped_column(Text)
    recipient_index: Mapped[str | None] = mapped_column(String(64))
    purpose: Mapped[str] = mapped_column(String(32))
    portal: Mapped[str] = mapped_column(String(8))
    # Historical selection snapshot, not a live relationship: deleting an
    # unassigned tested template must not erase its attempt identity/version.
    template_id: Mapped[uuid.UUID | None] = mapped_column()
    template_version: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    failure_category: Mapped[str | None] = mapped_column(String(32))
    __table_args__ = (
        CheckConstraint("purpose IN ('password_recovery','account_invitation','template_test')", name="ck_email_attempt_purpose"),
        CheckConstraint("status IN ('pending','sending','smtp_accepted','failed','unknown')", name="ck_email_attempt_status"),
        CheckConstraint("portal IN ('admin','mr')", name="ck_email_attempt_portal"),
        CheckConstraint("(recipient_ciphertext IS NULL) = (recipient_index IS NULL) "
                        "AND (recipient_ciphertext IS NULL OR recipient_ciphertext LIKE 'v1:%')",
                        name="ck_email_attempt_recipient"),
        Index("ix_email_attempt_created", "created_at", "id"),
        Index("ix_email_attempt_recipient", "recipient_index", "created_at"),
    )
