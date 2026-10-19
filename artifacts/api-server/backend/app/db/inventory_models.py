"""Exact operational quantities; all authored/descriptive snapshots are encrypted."""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class InventoryLot(Base):
    __tablename__ = "inventory_lots"
    __table_args__ = (UniqueConstraint("receipt_id", "line_id", name="uq_inventory_receipt_line"),
                      CheckConstraint("accepted >= 0 AND accepted <= 1000000 AND accepted = round(accepted,3)", name="ck_inventory_accepted"))
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    receipt_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("purchase_receipts.id"), index=True)
    line_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("purchase_order_lines.id"))
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("allergen_products.id"), index=True)
    combo_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("combo_products.id"), index=True)
    assembly_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("product_assemblies.id"), unique=True)
    origin_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("storage_locations.id"))
    accepted: Mapped[Decimal] = mapped_column(Numeric())
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class InventoryBalance(Base):
    __tablename__ = "inventory_balances"
    __table_args__ = (CheckConstraint("quantity >= 0 AND quantity <= 1000000 AND quantity = round(quantity,3)", name="ck_inventory_nonnegative"),)
    lot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("inventory_lots.id"), primary_key=True)
    location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("storage_locations.id"), primary_key=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric())


class InventoryReceiptState(Base):
    __tablename__ = "inventory_receipt_states"
    receipt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("purchase_receipts.id"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer)
    initialized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class InventoryMovement(Base):
    __tablename__ = "inventory_movements"
    __table_args__ = (CheckConstraint("source_id <> destination_id", name="ck_inventory_distinct_locations"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("storage_locations.id"), index=True)
    destination_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("storage_locations.id"), index=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_events.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class InventoryPosting(Base):
    __tablename__ = "inventory_postings"
    __table_args__ = (
        UniqueConstraint("source_key", "lot_id", "location_id", name="uq_inventory_posting_source"),
        CheckConstraint("delta <> 0 AND delta BETWEEN -1000000 AND 1000000 AND delta = round(delta,3)", name="ck_inventory_delta"),
        CheckConstraint("before BETWEEN 0 AND 1000000 AND after BETWEEN 0 AND 1000000 AND before = round(before,3) AND after = round(after,3) AND after = before + delta", name="ck_inventory_posting_balance"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    source_key: Mapped[str] = mapped_column(String(100))
    lot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("inventory_lots.id"), index=True)
    location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("storage_locations.id"))
    movement_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("inventory_movements.id"), index=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    delta: Mapped[Decimal] = mapped_column(Numeric())
    before: Mapped[Decimal] = mapped_column(Numeric())
    after: Mapped[Decimal] = mapped_column(Numeric())


class InventoryRequest(Base):
    __tablename__ = "inventory_requests"
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    digest: Mapped[str] = mapped_column(String(64))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
