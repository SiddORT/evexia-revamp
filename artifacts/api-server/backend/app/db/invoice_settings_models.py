"""Encrypted immutable snapshots; no banking or legal values in SQL columns."""
from datetime import datetime
from uuid import UUID
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class InvoiceSettingsRevision(Base):
    __tablename__ = "invoice_settings_revisions"
    __table_args__ = (
        CheckConstraint("version BETWEEN 1 AND 2147483647", name="ck_invoice_revision_version"),
    )
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    payload_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)


class InvoiceSettingsRequest(Base):
    __tablename__ = "invoice_settings_requests"
    __table_args__ = (
        CheckConstraint("state IN ('pending','committed','cancelled')", name="ck_invoice_request_state"),
        CheckConstraint("(state = 'committed' AND version IS NOT NULL) OR "
                        "(state <> 'committed' AND version IS NULL)", name="ck_invoice_request_result"),
        Index("ix_invoice_pending_age", "state", "created_at"),
    )
    key: Mapped[UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    version: Mapped[int | None] = mapped_column(ForeignKey("invoice_settings_revisions.version"))
    # A reservation is committed BEFORE writing a file. Even a crash leaves
    # owned reconciliation evidence, never an untracked replacement object.
    payload_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
