"""Immutable encrypted canonical documents, not PDF bytes."""
import uuid
from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class ProcurementDocument(Base):
    __tablename__ = "procurement_documents"
    __table_args__ = (
        UniqueConstraint("po_id", "record_version"),
        UniqueConstraint("pr_id", "record_version"),
        CheckConstraint("(po_id IS NULL) <> (pr_id IS NULL)", name="ck_procurement_document_owner"),
        CheckConstraint("record_version >= 1", name="ck_procurement_document_version"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_procurement_document_ciphertext"),
    )
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_events.id"), primary_key=True)
    po_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    pr_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("purchase_receipts.id"), index=True)
    record_version: Mapped[int] = mapped_column(Integer)
    generated_at: Mapped[str] = mapped_column(String(40))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
