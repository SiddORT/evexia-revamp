"""Incomplete entry documents, never operational orders."""
import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class OrderDraft(Base):
    __tablename__ = "order_drafts"
    __table_args__ = (
        CheckConstraint("kind IN ('immunotherapy','kits','lupin')", name="ck_order_draft_kind"),
        CheckConstraint("version > 0", name="ck_order_draft_version"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_order_draft_cipher"),
        CheckConstraint("(submitted_order_id IS NULL) = (submitted_version IS NULL)", name="ck_order_draft_submission"),
        Index("ix_order_draft_owner_kind", "created_by", "kind", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    mr_scope: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mr_directory.id"))
    version: Mapped[int] = mapped_column(Integer)
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    last_request: Mapped[uuid.UUID] = mapped_column()
    submitted_order_id: Mapped[uuid.UUID | None] = mapped_column()
    submitted_version: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrderDraftAttachment(Base):
    __tablename__ = "order_draft_attachments"
    draft_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("order_drafts.id"), primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), primary_key=True, unique=True)


class OrderDraftRequest(Base):
    __tablename__ = "order_draft_requests"
    __table_args__ = (CheckConstraint("response_ciphertext LIKE 'v1:%'", name="ck_order_draft_request_cipher"),)
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    draft_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("order_drafts.id"), index=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    response_ciphertext: Mapped[str] = mapped_column(Text)
