"""Only operational identifiers and lifecycle data are plaintext."""
import uuid
from datetime import date
from sqlalchemy import Date, ForeignKey, Integer, String, Text, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class PurchaseReceipt(Timestamps, Base):
    __tablename__ = "purchase_receipts"
    __table_args__ = (
        CheckConstraint("status IN ('active','deleted') AND version >= 1", name="ck_pr_lifecycle"),
        CheckConstraint("(receiver_mode = 'staff' AND staff_id IS NOT NULL) OR (receiver_mode = 'other' AND staff_id IS NULL)", name="ck_pr_receiver"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_pr_ciphertext"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(48), unique=True)
    po_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    vendor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vendors.id"))
    location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("storage_locations.id"))
    staff_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff_profiles.id"))
    receiver_mode: Mapped[str] = mapped_column(String(8))
    received_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(8))
    version: Mapped[int] = mapped_column(Integer)
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class ReceiptSource(Base):
    """Retained PO line FK blocks physical removal even after receipt deletion."""
    __tablename__ = "purchase_receipt_sources"
    receipt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_receipts.id"), primary_key=True)
    line_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_order_lines.id"), primary_key=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("allergen_products.id"))


class ReceiptHistory(Base):
    __tablename__ = "purchase_receipt_history"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_events.id"), primary_key=True)
    receipt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_receipts.id"), index=True)
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class ReceiptRetry(Base):
    __tablename__ = "purchase_receipt_requests"
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    digest: Mapped[str] = mapped_column(String(64))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
