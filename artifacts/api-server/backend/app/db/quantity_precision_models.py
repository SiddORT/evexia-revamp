"""Append-only precision checkpoints; original business evidence is retained."""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class QuantityPrecisionBoundary(Base):
    __tablename__ = "quantity_precision_boundary"
    __table_args__ = (CheckConstraint("id=1", name="ck_quantity_precision_singleton"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    policy: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    evidence_digest: Mapped[str] = mapped_column(String(64))
    payload_ciphertext: Mapped[str] = mapped_column(Text)


class QuantityPrecisionLocation(Base):
    __tablename__ = "quantity_precision_locations"
    __table_args__ = (
        UniqueConstraint("kind", "owner_id", "location_key", name="uq_quantity_precision_location"),
        CheckConstraint("kind IN ('inventory','reserve','source') AND normalized=round(normalized,2) AND normalized>=0 AND normalized<=1000000 AND normalized=original+residual", name="ck_quantity_precision_location"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    owner_id: Mapped[uuid.UUID] = mapped_column()
    location_key: Mapped[str] = mapped_column(String(36))
    original: Mapped[Decimal] = mapped_column(Numeric())
    normalized: Mapped[Decimal] = mapped_column(Numeric())
    residual: Mapped[Decimal] = mapped_column(Numeric())


class QuantityPrecisionSnapshot(Base):
    __tablename__ = "quantity_precision_snapshots"
    purpose: Mapped[str] = mapped_column(String(80), primary_key=True)
    record_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    original_digest: Mapped[str] = mapped_column(String(64))
    original_ciphertext: Mapped[str] = mapped_column(Text)
    normalized_ciphertext: Mapped[str] = mapped_column(Text)


class QuantityPrecisionThreshold(Base):
    __tablename__ = "quantity_precision_thresholds"
    __table_args__ = (CheckConstraint("normalized=round(normalized,2) AND normalized=original+residual", name="ck_quantity_precision_threshold"),)
    allergen_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("allergen_products.id"), primary_key=True)
    original: Mapped[Decimal] = mapped_column(Numeric())
    normalized: Mapped[Decimal] = mapped_column(Numeric())
    residual: Mapped[Decimal] = mapped_column(Numeric())
