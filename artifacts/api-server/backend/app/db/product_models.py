"""Encrypted combo catalogue and immutable recipe/assembly business evidence."""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class ComboProduct(Base):
    __tablename__ = "combo_products"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    name_key: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(8))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class ProductRevision(Base):
    __tablename__ = "combo_product_revisions"
    __table_args__ = (UniqueConstraint("product_id", "version", name="uq_combo_revision"),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("combo_products.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_events.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class ProductMember(Base):
    __tablename__ = "combo_product_members"
    __table_args__ = (CheckConstraint("quantity > 0 AND quantity <= 1000000 AND quantity = round(quantity,3)", name="ck_combo_member_quantity"),)
    revision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("combo_product_revisions.id"), primary_key=True)
    allergen_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("allergen_products.id"), primary_key=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric())


class ProductAssembly(Base):
    __tablename__ = "product_assemblies"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("combo_products.id"), index=True)
    revision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("combo_product_revisions.id"))
    location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("storage_locations.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("audit_events.id"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class ProductRequest(Base):
    __tablename__ = "product_requests"
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    digest: Mapped[str] = mapped_column(String(64))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
