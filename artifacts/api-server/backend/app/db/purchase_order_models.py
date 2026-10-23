"""Shared procurement records; independent of legacy browser receiving."""
import uuid
from datetime import date
from sqlalchemy import BigInteger, CheckConstraint, Date, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class PurchaseOrder(Timestamps, Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_po_version"),
        CheckConstraint("status IN ('open','deleted')", name="ck_po_status"),
        CheckConstraint("total >= 0 AND total <= 10000000000", name="ck_po_total"),
        CheckConstraint("expected_date >= po_date", name="ck_po_dates"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    number: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    vendor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vendors.id"), index=True)
    location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("storage_locations.id"))
    vendor_name: Mapped[str] = mapped_column(String(200))
    location_name: Mapped[str] = mapped_column(String(200))
    po_date: Mapped[date] = mapped_column(Date, index=True)
    expected_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(8), default="open", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    subtotal: Mapped[int] = mapped_column(BigInteger)
    gst_amount: Mapped[int] = mapped_column(BigInteger)
    total: Mapped[int] = mapped_column(BigInteger)
    tax_basis: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    tax_components: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    deleted_at: Mapped[str | None] = mapped_column(String(40))


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("allergen_products.id"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    snapshot: Mapped[dict] = mapped_column(JSON)


class PurchaseOrderAudit(Base):
    """Typed metadata attached one-to-one to the existing authoritative audit."""
    __tablename__ = "purchase_order_audit"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_events.id"), primary_key=True)
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    number: Mapped[str] = mapped_column(String(48))
    action: Mapped[str] = mapped_column(String(8))
    summary: Mapped[str] = mapped_column(String(2000))
    actor: Mapped[str] = mapped_column(String(320))
    payload_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)


class PurchaseOrderRequest(Base):
    __tablename__ = "purchase_order_requests"
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    digest: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSON)
